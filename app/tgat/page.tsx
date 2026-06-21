"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  fmtTime,
  TGAT_EXAM_SECONDS,
  TGAT_MIN_SUBMIT_SECONDS,
  TGAT_SECTION_LABEL,
  type TgatSection,
} from "../lib/tgat";
import { TGAT_ATTEMPTS_PER_DAY, isTgatSeasonStarted, isTgatSeasonOver } from "../lib/tgat-season";

type Phase = "intro" | "loading" | "taking" | "result";

interface PublicQuestion {
  uid: string;
  section: TgatSection;
  groupId?: string;
  stem: string;
  options: string[];
}
interface Group {
  id: string;
  title: string;
  text: string;
  kind: "dialogue" | "cloze" | "reading";
}
interface ReviewEntry {
  correctIndex: number;
  explanation_th: string;
}
interface TgatResultData {
  score: number;
  percent: number;
  speakingScore: number;
  speakingCorrect: number;
  speakingTotal: number;
  readingScore: number;
  readingCorrect: number;
  readingTotal: number;
  correctCount: number;
  totalQuestions: number;
  bySection: Partial<Record<TgatSection, { correct: number; total: number }>>;
  timeSec: number;
}

const LETTERS = ["A", "B", "C", "D", "E"];

// ช่องที่เป็น "เติมคำ/เติมบทสนทนา" → โจทย์คือป้ายช่อง "(n)" (ไม่ใช่คำถามเต็ม)
function isBlankSection(s: TgatSection): boolean {
  return s === "SPEAKING_SHORT_CONV" || s === "SPEAKING_LONG_CONV" || s === "READING_CLOZE";
}

type RenderItem =
  | { kind: "section"; section: TgatSection }
  | { kind: "group"; groupId: string }
  | { kind: "question"; q: PublicQuestion; number: number };

function buildRenderItems(questions: PublicQuestion[]): RenderItem[] {
  const items: RenderItem[] = [];
  const shown = new Set<string>();
  let lastSection: TgatSection | null = null;
  let number = 0;
  for (const q of questions) {
    if (q.section !== lastSection) {
      items.push({ kind: "section", section: q.section });
      lastSection = q.section;
    }
    if (q.groupId && !shown.has(q.groupId)) {
      items.push({ kind: "group", groupId: q.groupId });
      shown.add(q.groupId);
    }
    number += 1;
    items.push({ kind: "question", q, number });
  }
  return items;
}

// แสดงบทสนทนา/บทความ — แทนเครื่องหมาย __(n)__ ด้วยช่องว่างไฮไลต์
function renderTextWithBlanks(text: string): ReactNode {
  const parts = text.split(/__\((\d+)\)__/g);
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) nodes.push(<span key={i}>{part}</span>);
    } else {
      nodes.push(
        <span
          key={i}
          className="inline-block font-black text-[#7c3aed] border-b-2 border-[#7c3aed] px-1.5 mx-0.5"
        >
          ({part})
        </span>
      );
    }
  });
  return <span className="whitespace-pre-line leading-relaxed">{nodes}</span>;
}

function groupBadge(kind: Group["kind"]): string {
  if (kind === "dialogue") return "💬 บทสนทนา";
  if (kind === "cloze") return "📝 เติมข้อความในบทความ";
  return "📄 บทความ";
}

export default function TgatPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(TGAT_EXAM_SECONDS);
  const [result, setResult] = useState<TgatResultData | null>(null);
  const [review, setReview] = useState<Record<string, ReviewEntry>>({});
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const secondsLeftRef = useRef(TGAT_EXAM_SECONDS);
  const tabSwitchesRef = useRef(0);
  const awayMsRef = useRef(0);
  const awayStartRef = useRef(0);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  const start = useCallback(async () => {
    setError("");
    let email = "";
    let name = "";
    try {
      email = window.localStorage.getItem("exam_user_email") || "";
      name = window.localStorage.getItem("exam_user_name") || "";
    } catch {
      /* ignore */
    }
    if (!email) {
      setError("กรุณาเข้าสู่ระบบจากหน้าหลักก่อนเริ่มสอบ");
      return;
    }
    setPhase("loading");
    try {
      const res = await fetch("/api/tgat/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "เริ่มสอบไม่สำเร็จ");
        setPhase("intro");
        return;
      }
      setSessionId(data.sessionId);
      setQuestions(data.questions || []);
      setGroups(data.groups || {});
      setAnswers({});
      const secs = data.examSeconds || TGAT_EXAM_SECONDS;
      setSecondsLeft(secs);
      secondsLeftRef.current = secs;
      tabSwitchesRef.current = 0;
      awayMsRef.current = 0;
      awayStartRef.current = 0;
      setTabSwitches(0);
      setResult(null);
      setReview({});
      setSaveMsg("");
      setSubmitting(false);
      setPhase("taking");
      window.scrollTo(0, 0);
    } catch {
      setError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ลองใหม่อีกครั้ง");
      setPhase("intro");
    }
  }, []);

  const submit = useCallback(async () => {
    if (!sessionId || submitting) return;
    if (awayStartRef.current > 0) {
      awayMsRef.current += Date.now() - awayStartRef.current;
      awayStartRef.current = 0;
    }
    let email = "";
    try {
      email = window.localStorage.getItem("exam_user_email") || "";
    } catch {
      /* ignore */
    }
    const tabSw = tabSwitchesRef.current;
    const awaySec = Math.round(awayMsRef.current / 1000);
    setSubmitting(true);
    setSaveMsg("กำลังส่งและตรวจคำตอบ…");
    try {
      const res = await fetch("/api/tgat/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, email, answers, tabSwitches: tabSw, awaySec }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMsg(data.error || "ส่งไม่สำเร็จ ลองใหม่");
        setSubmitting(false);
        return;
      }
      setResult(data.result as TgatResultData);
      setReview((data.review || {}) as Record<string, ReviewEntry>);
      setSaveMsg(`บันทึกผลแล้ว ✓ ${data.scoreGained}/100 คะแนน`);
      setPhase("result");
      window.scrollTo(0, 0);
    } catch {
      setSaveMsg("เชื่อมต่อไม่สำเร็จ ลองส่งใหม่อีกครั้ง");
      setSubmitting(false);
    }
  }, [sessionId, answers, submitting]);

  // นาฬิกาจับเวลา
  useEffect(() => {
    if (phase !== "taking") return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // หมดเวลา → ส่งอัตโนมัติ
  useEffect(() => {
    if (phase === "taking" && secondsLeft === 0) submit();
  }, [phase, secondsLeft, submit]);

  // จับการออกจากหน้าจอ/สลับแท็บ
  useEffect(() => {
    if (phase !== "taking") return;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (awayStartRef.current === 0) awayStartRef.current = Date.now();
        tabSwitchesRef.current += 1;
        setTabSwitches(tabSwitchesRef.current);
      } else if (awayStartRef.current > 0) {
        awayMsRef.current += Date.now() - awayStartRef.current;
        awayStartRef.current = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [phase]);

  const items = useMemo(() => buildRenderItems(questions), [questions]);
  const answeredCount = Object.keys(answers).length;
  const elapsed = TGAT_EXAM_SECONDS - secondsLeft;
  const canSubmit = elapsed >= TGAT_MIN_SUBMIT_SECONDS;
  const submitCountdown = Math.max(0, TGAT_MIN_SUBMIT_SECONDS - elapsed);
  const totalQuestions = questions.length;

  function choose(uid: string, idx: number) {
    setAnswers((a) => ({ ...a, [uid]: idx }));
  }

  function handleSubmitClick() {
    if (!sessionId || !canSubmit || submitting) return;
    const left = totalQuestions - answeredCount;
    if (left > 0 && !window.confirm(`ยังมีข้อที่ยังไม่ตอบ ${left} ข้อ ต้องการส่งคำตอบเลยไหม?`)) return;
    submit();
  }

  // ───────────────── intro ─────────────────
  if (phase === "intro" || phase === "loading") {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-12 bg-[#f5f3ff]">
        <div className="w-full max-w-lg rounded-3xl bg-white border-2 border-[#7c3aed] shadow-lg p-8">
          <div className="text-center">
            <div className="text-4xl mb-2">🗣️ 📖</div>
            <h1 className="text-2xl font-black text-[#5b21b6]">TGAT1 — สอบจำลองการสื่อสารภาษาอังกฤษ</h1>
            <p className="text-gray-600 mt-1 font-bold">60 ข้อ / 60 นาที / 100 คะแนน</p>
          </div>
          <div className="mt-5 rounded-xl bg-[#5b21b6]/5 p-4 text-sm text-gray-700 space-y-1">
            <p className="font-black text-[#5b21b6]">🗣️ Speaking (50 คะแนน)</p>
            <p>• Question–Response 10 ข้อ</p>
            <p>• Short conversations 10 ข้อ (3 บท)</p>
            <p>• Long conversations 10 ข้อ (2 บท)</p>
            <p className="font-black text-[#5b21b6] pt-1">📖 Reading (50 คะแนน)</p>
            <p>• Text completion 15 ข้อ (2 บท)</p>
            <p>• Reading comprehension 15 ข้อ (3 บท)</p>
          </div>
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-1">
            <p className="font-black">📋 กติกาการแข่งขัน</p>
            <p>⏳ ส่งคำตอบได้หลังทำครบ <b>45 นาที</b> (ก่อนหน้านั้นทบทวน/แก้คำตอบได้)</p>
            <p>🔁 ทำได้ <b>{TGAT_ATTEMPTS_PER_DAY} ครั้ง/วัน</b> · จัดอันดับจาก <b>คะแนนครั้งที่ดีที่สุด</b></p>
            <p>
              🏆 ช่วงแข่ง <b>17 ส.ค. – 25 ก.ย. 2569</b>{" "}
              {isTgatSeasonOver() ? (
                <b className="text-red-600">· ปิดรอบแล้ว</b>
              ) : !isTgatSeasonStarted() ? (
                <b className="text-amber-700">· ตอนนี้ซ้อมได้ (ยังไม่นับอันดับ)</b>
              ) : (
                <b className="text-green-700">· กำลังแข่ง!</b>
              )}
            </p>
            <p>👀 อยู่ในหน้าจอตลอดการสอบ — ระบบบันทึกการออกจากหน้าจอ</p>
          </div>
          {error && <p className="mt-4 text-sm text-red-600 font-bold">{error}</p>}
          <button
            onClick={start}
            disabled={phase === "loading"}
            className="mt-6 w-full rounded-xl bg-[#5b21b6] text-white font-black py-3 text-lg hover:bg-[#4c1d95] transition disabled:opacity-60"
          >
            {phase === "loading" ? "กำลังเตรียมข้อสอบ…" : "เริ่มทำข้อสอบ"}
          </button>
          <Link href="/" className="mt-3 block text-center text-sm text-gray-500 underline">
            ← กลับหน้าหลัก
          </Link>
        </div>
      </main>
    );
  }

  // ───────────────── result ─────────────────
  if (phase === "result" && result) {
    const sectionsOrder: TgatSection[] = [
      "SPEAKING_QR",
      "SPEAKING_SHORT_CONV",
      "SPEAKING_LONG_CONV",
      "READING_CLOZE",
      "READING_COMP",
    ];
    return (
      <main className="flex-1 bg-[#f5f3ff]">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="rounded-3xl bg-white border-2 border-[#7c3aed] shadow-lg p-6 text-center">
            <p className="text-gray-500 font-bold">คะแนนสอบจำลอง TGAT1</p>
            <p className="text-5xl font-black text-[#5b21b6] my-2">{result.score}/100</p>
            <p className="text-gray-600 font-bold">
              ตอบถูก {result.correctCount}/{result.totalQuestions} ข้อ · ใช้เวลา {fmtTime(result.timeSec)}
            </p>
            {saveMsg && <p className="mt-2 text-sm font-bold text-[#5b21b6]">{saveMsg}</p>}
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              <div className="rounded-xl bg-[#5b21b6]/5 px-4 py-3">
                <div className="font-black text-[#5b21b6]">🗣️ Speaking</div>
                <div className="text-2xl font-black text-gray-800">{result.speakingScore}/50</div>
                <div className="text-xs text-gray-500">ถูก {result.speakingCorrect}/{result.speakingTotal} ข้อ</div>
              </div>
              <div className="rounded-xl bg-[#5b21b6]/5 px-4 py-3">
                <div className="font-black text-[#5b21b6]">📖 Reading</div>
                <div className="text-2xl font-black text-gray-800">{result.readingScore}/50</div>
                <div className="text-xs text-gray-500">ถูก {result.readingCorrect}/{result.readingTotal} ข้อ</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-left text-sm">
              {sectionsOrder.map((sec) => {
                const s = result.bySection[sec];
                if (!s) return null;
                return (
                  <div key={sec} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <span className="font-bold text-gray-700">
                      {TGAT_SECTION_LABEL[sec].split("—")[1]?.trim() ?? TGAT_SECTION_LABEL[sec]}
                    </span>
                    <span className="text-gray-600">ถูก {s.correct}/{s.total}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3 justify-center">
              <button onClick={start} className="rounded-xl bg-[#5b21b6] text-white font-black px-5 py-2.5 hover:bg-[#4c1d95] transition">
                ทำชุดใหม่
              </button>
              <Link href="/" className="rounded-xl bg-gray-100 text-gray-700 font-black px-5 py-2.5 hover:bg-gray-200 transition">
                กลับหน้าหลัก
              </Link>
            </div>
            <p className="text-[11px] text-gray-400 mt-4">อันดับนับจากคะแนนครั้งที่ดีที่สุด · ทำซ้ำเพื่อพัฒนาคะแนนได้</p>
          </div>

          <h2 className="text-lg font-black text-[#5b21b6] mt-8 mb-3">ทบทวนเฉลยทุกข้อ</h2>
          <div className="space-y-4">
            {items.map((it, i) => {
              if (it.kind === "section") {
                return (
                  <h3 key={`s${i}`} className="text-sm font-black text-white bg-[#5b21b6] rounded-lg px-3 py-2 mt-4">
                    {TGAT_SECTION_LABEL[it.section]}
                  </h3>
                );
              }
              if (it.kind === "group") {
                const g = groups[it.groupId];
                if (!g) return null;
                return (
                  <div key={`g${i}`} className="rounded-xl bg-white border border-gray-200 p-4">
                    <p className="font-bold text-[#5b21b6] mb-2 text-sm">
                      {groupBadge(g.kind)} — {g.title}
                    </p>
                    <div className="text-sm text-gray-700">{renderTextWithBlanks(g.text)}</div>
                  </div>
                );
              }
              const q = it.q;
              const picked = answers[q.uid];
              const rv = review[q.uid];
              const correctIndex = rv ? rv.correctIndex : -1;
              const correct = picked === correctIndex;
              const blank = isBlankSection(q.section);
              return (
                <div key={q.uid} className="rounded-xl bg-white border border-gray-200 p-4">
                  <div className="flex items-start gap-2">
                    <span
                      className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-black text-white ${
                        correct ? "bg-green-600" : "bg-red-500"
                      }`}
                    >
                      {it.number}
                    </span>
                    <p className="font-bold text-gray-800 whitespace-pre-line">
                      {blank ? `เติมช่อง ${q.stem}` : q.stem}
                    </p>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const isCorrect = oi === correctIndex;
                      const isPicked = oi === picked;
                      return (
                        <div
                          key={oi}
                          className={`rounded-lg px-3 py-2 text-sm border ${
                            isCorrect
                              ? "border-green-500 bg-green-50 text-green-800 font-bold"
                              : isPicked
                              ? "border-red-400 bg-red-50 text-red-700"
                              : "border-gray-200 text-gray-700"
                          }`}
                        >
                          <span className="font-bold mr-1">{LETTERS[oi]}.</span>
                          {opt}
                          {isCorrect && <span className="ml-2 text-xs">✓ เฉลย</span>}
                          {isPicked && !isCorrect && <span className="ml-2 text-xs">← คุณตอบ</span>}
                        </div>
                      );
                    })}
                  </div>
                  {rv?.explanation_th && (
                    <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">💡 {rv.explanation_th}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex gap-3 justify-center">
            <button onClick={start} className="rounded-xl bg-[#5b21b6] text-white font-black px-5 py-2.5 hover:bg-[#4c1d95] transition">
              ทำชุดใหม่
            </button>
            <Link href="/" className="rounded-xl bg-gray-100 text-gray-700 font-black px-5 py-2.5 hover:bg-gray-200 transition">
              กลับหน้าหลัก
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ───────────────── taking ─────────────────
  const lowTime = secondsLeft <= 5 * 60;
  return (
    <main className="flex-1 bg-[#f5f3ff] pb-24">
      <div className="sticky top-0 z-10 bg-white border-b-2 border-[#5b21b6]/10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className={`font-black text-lg ${lowTime ? "text-red-600" : "text-[#5b21b6]"}`}>⏱ {fmtTime(secondsLeft)}</div>
          <div className="text-sm text-gray-500 font-bold">
            ตอบแล้ว {answeredCount}/{totalQuestions}
          </div>
          <button
            onClick={handleSubmitClick}
            disabled={!canSubmit || submitting}
            className={`rounded-xl font-black px-4 py-2 transition ${
              canSubmit && !submitting
                ? "bg-[#FFD700] text-[#5b21b6] hover:brightness-95"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {submitting ? "กำลังส่ง…" : canSubmit ? "ส่งคำตอบ" : `ส่งได้ใน ${fmtTime(submitCountdown)}`}
          </button>
        </div>
        {!canSubmit && (
          <div className="bg-[#5b21b6]/5 text-[#5b21b6] text-xs text-center py-1.5 font-bold">
            ⏳ ส่งคำตอบได้หลังทำครบ 45 นาที — ระหว่างนี้ทบทวน/แก้คำตอบได้
          </div>
        )}
        {tabSwitches > 0 && (
          <div className="bg-amber-50 border-t border-amber-200 text-amber-800 text-xs text-center py-1.5 font-bold">
            ⚠️ ออกจากหน้าสอบแล้ว {tabSwitches} ครั้ง — ระบบบันทึกไว้เพื่อความยุติธรรม กรุณาอยู่ในหน้าจอ
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {items.map((it, i) => {
          if (it.kind === "section") {
            return (
              <h3 key={`s${i}`} className="text-sm font-black text-white bg-[#5b21b6] rounded-lg px-3 py-2 mt-4">
                {TGAT_SECTION_LABEL[it.section]}
              </h3>
            );
          }
          if (it.kind === "group") {
            const g = groups[it.groupId];
            if (!g) return null;
            return (
              <div key={`g${i}`} className="rounded-xl bg-white border-2 border-[#5b21b6]/15 p-4">
                <p className="font-black text-[#5b21b6] mb-2 text-sm">
                  {groupBadge(g.kind)} — {g.title}
                </p>
                <div className="text-sm text-gray-800">{renderTextWithBlanks(g.text)}</div>
              </div>
            );
          }
          const q = it.q;
          const picked = answers[q.uid];
          const blank = isBlankSection(q.section);
          return (
            <div key={q.uid} className="rounded-xl bg-white border border-gray-200 p-4">
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-black text-white bg-[#5b21b6]">
                  {it.number}
                </span>
                <p className="font-bold text-gray-800 whitespace-pre-line">
                  {blank ? `เติมช่อง ${q.stem}` : q.stem}
                </p>
              </div>
              <div className="mt-3 space-y-1.5">
                {q.options.map((opt, oi) => {
                  const isPicked = oi === picked;
                  return (
                    <button
                      key={oi}
                      onClick={() => choose(q.uid, oi)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm border transition ${
                        isPicked
                          ? "border-[#5b21b6] bg-[#5b21b6]/10 font-bold text-[#5b21b6]"
                          : "border-gray-200 text-gray-700 hover:border-[#5b21b6]/40"
                      }`}
                    >
                      <span className="font-bold mr-1">{LETTERS[oi]}.</span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button
          onClick={handleSubmitClick}
          disabled={!canSubmit || submitting}
          className={`w-full rounded-xl font-black py-3 text-lg transition ${
            canSubmit && !submitting
              ? "bg-[#5b21b6] text-white hover:bg-[#4c1d95]"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          {submitting ? "กำลังส่ง…" : canSubmit ? "ส่งคำตอบ" : `ส่งได้หลังทำครบ 45 นาที (อีก ${fmtTime(submitCountdown)})`}
        </button>
      </div>
    </main>
  );
}
