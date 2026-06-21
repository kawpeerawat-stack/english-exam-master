"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  fmtTime,
  EXAM_SECONDS,
  MIN_SUBMIT_SECONDS,
  SECTION_LABEL,
  type MockResult,
  type Section,
} from "../lib/netsat";
import { ATTEMPTS_PER_DAY } from "../lib/season";

type Phase = "intro" | "loading" | "taking" | "result";

// โจทย์ฉบับไม่มีเฉลย (รับมาจาก API /start)
interface PublicQuestion {
  uid: string;
  section: Section;
  passageId?: string;
  stem: string;
  options: string[];
  points: number;
}
interface Passage {
  id: string;
  title: string;
  passage: string;
  wordCount: number;
}
interface ReviewEntry {
  correctIndex: number;
  explanation_th: string;
}

type RenderItem =
  | { kind: "section"; section: Section }
  | { kind: "passage"; passageId: string }
  | { kind: "question"; q: PublicQuestion; number: number };

function buildRenderItems(questions: PublicQuestion[]): RenderItem[] {
  const items: RenderItem[] = [];
  const shown = new Set<string>();
  let lastSection: Section | null = null;
  let number = 0;
  for (const q of questions) {
    if (q.section !== lastSection) {
      items.push({ kind: "section", section: q.section });
      lastSection = q.section;
    }
    if (q.passageId && !shown.has(q.passageId)) {
      items.push({ kind: "passage", passageId: q.passageId });
      shown.add(q.passageId);
    }
    number += 1;
    items.push({ kind: "question", q, number });
  }
  return items;
}

const LETTERS = ["A", "B", "C", "D", "E"];

// แสดงโจทย์ Error Identification แบบ "ขีดเส้นใต้ส่วนที่เลือก + เลขกำกับ (1)(2)(3)(4)"
// รองรับ 2 รูปแบบในคลัง:  (A)[วลี]   และ   (A)วลี ...(B)วลี (วลีกินถึง marker ตัวถัดไป)
function renderErrorStem(stem: string): ReactNode {
  const nodes: ReactNode[] = [];
  let key = 0;
  const addPlain = (t: string) => {
    if (t) nodes.push(<span key={key++}>{t}</span>);
  };
  const addUnderlined = (raw: string, num: number) => {
    const mm = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const lead = mm?.[1] ?? "";
    const content = mm?.[2] ?? raw;
    const trail = mm?.[3] ?? "";
    addPlain(lead);
    nodes.push(
      <span key={key++} className="font-semibold">
        <span className="underline decoration-2 underline-offset-2 decoration-gray-500">{content}</span>
        <span className="text-[#003399] text-[0.8em]">({num})</span>
      </span>
    );
    addPlain(trail);
  };

  if (/\([A-E]\)\[/.test(stem)) {
    const re = /\(([A-E])\)\[([^\]]*)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stem)) !== null) {
      addPlain(stem.slice(last, m.index));
      addUnderlined(m[2], m[1].charCodeAt(0) - 64);
      last = re.lastIndex;
    }
    addPlain(stem.slice(last));
  } else {
    const re = /\(([A-E])\)/g;
    const marks: { letter: string; end: number; start: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(stem)) !== null) marks.push({ letter: m[1], start: m.index, end: re.lastIndex });
    if (marks.length === 0) {
      addPlain(stem);
    } else {
      addPlain(stem.slice(0, marks[0].start));
      for (let i = 0; i < marks.length; i++) {
        const end = i + 1 < marks.length ? marks[i + 1].start : stem.length;
        addUnderlined(stem.slice(marks[i].end, end), marks[i].letter.charCodeAt(0) - 64);
      }
    }
  }
  return <span className="whitespace-pre-line">{nodes}</span>;
}

// ตัด "(A) " นำหน้าตัวเลือก Error ID (เราแสดงเป็นเลขกำกับแทน)
function stripOptPrefix(opt: string): string {
  return opt.replace(/^\([A-E]\)\s*/, "");
}

export default function NetsatPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<PublicQuestion[]>([]);
  const [passages, setPassages] = useState<Record<string, Passage>>({});
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const [result, setResult] = useState<MockResult | null>(null);
  const [review, setReview] = useState<Record<string, ReviewEntry>>({});
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [oath, setOath] = useState(false);
  const [userName, setUserName] = useState("");

  const secondsLeftRef = useRef(EXAM_SECONDS);
  const tabSwitchesRef = useRef(0);
  const awayMsRef = useRef(0);
  const awayStartRef = useRef(0);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  useEffect(() => {
    try {
      setUserName(window.localStorage.getItem("exam_user_name") || "");
    } catch {
      /* ignore */
    }
  }, []);

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
      const res = await fetch("/api/netsat/start", {
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
      setPassages(data.passages || {});
      setAnswers({});
      const secs = data.examSeconds || EXAM_SECONDS;
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
      const res = await fetch("/api/netsat/grade", {
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
      setResult(data.result as MockResult);
      setReview((data.review || {}) as Record<string, ReviewEntry>);
      setSaveMsg(`บันทึกผลแล้ว ✓ +${data.xpGained} XP`);
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
  const elapsed = EXAM_SECONDS - secondsLeft;
  const canSubmit = elapsed >= MIN_SUBMIT_SECONDS;
  const submitCountdown = Math.max(0, MIN_SUBMIT_SECONDS - elapsed);
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
      <main className="flex-1 flex items-center justify-center px-4 py-12 bg-[#f4f6fb]">
        <div className="w-full max-w-lg rounded-3xl bg-white border-2 border-[#FFD700] shadow-lg p-8">
          <div className="text-center">
            <div className="text-4xl mb-2">📖 📊</div>
            <h1 className="text-2xl font-black text-[#003399]">NETSAT — สอบจำลองภาษาอังกฤษ (มข.)</h1>
            <p className="text-gray-600 mt-1 font-bold">40 ข้อ / 50 นาที</p>
          </div>
          <div className="mt-5 rounded-xl bg-[#003399]/5 p-4 text-sm text-gray-700 space-y-1">
            <p>• Error Identification 10 ข้อ</p>
            <p>• Sentence Completion 10 ข้อ</p>
            <p>• Reading (สั้น + ยาว) 20 ข้อ</p>
            <p className="text-gray-500 pt-1">
              คะแนนถ่วงน้ำหนัก 2/3/4 ตามความยาก · สุ่มข้อใหม่ทุกครั้ง · หมดเวลา 50 นาทีส่งอัตโนมัติ
            </p>
          </div>
          <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-1">
            <p className="font-black">📋 กติกาการแข่งขัน</p>
            <p>⏳ ส่งคำตอบได้หลังทำครบ <b>40 นาที</b> (ก่อนหน้านั้นทบทวน/แก้คำตอบได้)</p>
            <p>🔁 ทำได้ <b>{ATTEMPTS_PER_DAY} ครั้ง/วัน</b> · จัดอันดับจาก <b>เปอร์เซ็นต์ครั้งที่ดีที่สุด</b></p>
            <p>👀 อยู่ในหน้าจอตลอดการสอบ — ระบบบันทึกการออกจากหน้าจอ</p>
          </div>
          <div className="mt-3 rounded-xl border-2 border-[#003399]/30 bg-[#003399]/[0.04] p-4">
            <p className="font-black text-[#003399] text-center mb-2">📜 คำปฏิญาณก่อนเริ่มสอบ</p>
            <div className="text-[13px] leading-relaxed text-gray-700 space-y-1 text-center">
              <p>
                ข้าพเจ้า
                {userName ? <b className="text-[#003399]"> {userName} </b> : " ___________ "}
                ขอปฏิญาณต่อหน้าตัวเองว่า
              </p>
              <p>ข้าพเจ้าจะสู้ด้วย<b>สมองและสองมือของข้าพเจ้าเอง</b> ไม่พึ่ง AI ไม่หาทางลัด</p>
              <p>
                ทุกครั้งที่ข้าพเจ้า<b>ซื่อสัตย์</b> ข้าพเจ้ากำลังสร้าง “ตัวจริง” ที่แข็งแกร่งขึ้น
                และเดินเข้าใกล้<b className="text-[#003399]">มหาวิทยาลัยในฝัน</b>ทีละก้าว
              </p>
              <p>
                แต่หากข้าพเจ้าเลือกโกง ข้าพเจ้ายอมรับว่ากำลังขโมยโอกาสของตัวเอง
                และในวันสอบจริง ข้าพเจ้าจะต้องเผชิญมันเพียงลำพังอย่างไม่พร้อม
              </p>
              <p className="font-bold text-[#003399] pt-1">
                ข้าพเจ้าจึงขอเลือกความซื่อสัตย์ — เพื่อข้าพเจ้าในวันข้างหน้า
              </p>
            </div>
            <label className="mt-3 flex items-start gap-2 cursor-pointer select-none rounded-lg bg-white border border-[#003399]/30 p-3">
              <input
                type="checkbox"
                checked={oath}
                onChange={(e) => setOath(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[#003399]"
              />
              <span className="text-sm font-bold text-gray-800">
                ข้าพเจ้าขอปฏิญาณตามข้อความข้างต้น และจะทำข้อสอบนี้ด้วยตนเอง
              </span>
            </label>
          </div>
          {error && <p className="mt-4 text-sm text-red-600 font-bold">{error}</p>}
          <button
            onClick={start}
            disabled={phase === "loading" || !oath}
            className="mt-4 w-full rounded-xl bg-[#003399] text-white font-black py-3 text-lg hover:bg-[#002266] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {phase === "loading" ? "กำลังเตรียมข้อสอบ…" : oath ? "เริ่มทำข้อสอบ" : "กรุณายอมรับคำปฏิญาณก่อน"}
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
    const sectionsOrder: Section[] = ["WRITING_ERROR", "WRITING_SC", "READING_SHORT", "READING_LONG"];
    return (
      <main className="flex-1 bg-[#f4f6fb]">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="rounded-3xl bg-white border-2 border-[#FFD700] shadow-lg p-6 text-center">
            <p className="text-gray-500 font-bold">คะแนนสอบจำลอง NETSAT</p>
            <p className="text-5xl font-black text-[#003399] my-2">{result.percent}%</p>
            <p className="text-gray-600 font-bold">
              ได้ {result.earnedPoints}/{result.totalPoints} คะแนน · ตอบถูก {result.correctCount}/{result.totalQuestions} ข้อ
            </p>
            {saveMsg && <p className="mt-2 text-sm font-bold text-[#003399]">{saveMsg}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2 text-left text-sm">
              {sectionsOrder.map((sec) => {
                const s = result.bySection[sec];
                if (!s) return null;
                return (
                  <div key={sec} className="rounded-lg bg-[#003399]/5 px-3 py-2">
                    <div className="font-bold text-[#003399]">
                      {SECTION_LABEL[sec].split("—")[1]?.trim() ?? SECTION_LABEL[sec]}
                    </div>
                    <div className="text-gray-600">
                      ถูก {s.correct}/{s.total} · {s.earned}/{s.points} คะแนน
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex gap-3 justify-center">
              <button onClick={start} className="rounded-xl bg-[#003399] text-white font-black px-5 py-2.5 hover:bg-[#002266] transition">
                ทำชุดใหม่
              </button>
              <Link href="/" className="rounded-xl bg-gray-100 text-gray-700 font-black px-5 py-2.5 hover:bg-gray-200 transition">
                กลับหน้าหลัก
              </Link>
            </div>
            <p className="text-[11px] text-gray-400 mt-4">อันดับนับจากเปอร์เซ็นต์ครั้งที่ดีที่สุด · ทำซ้ำเพื่อพัฒนาคะแนนได้</p>
          </div>

          <h2 className="text-lg font-black text-[#003399] mt-8 mb-3">ทบทวนเฉลยทุกข้อ</h2>
          <div className="space-y-4">
            {items.map((it, i) => {
              if (it.kind === "section") {
                return (
                  <h3 key={`s${i}`} className="text-sm font-black text-white bg-[#003399] rounded-lg px-3 py-2 mt-4">
                    {SECTION_LABEL[it.section]}
                  </h3>
                );
              }
              if (it.kind === "passage") {
                const p = passages[it.passageId];
                if (!p) return null;
                return (
                  <details key={`p${i}`} className="rounded-xl bg-white border border-gray-200 p-4">
                    <summary className="font-bold text-[#003399] cursor-pointer">
                      📄 {p.title} <span className="text-xs text-gray-400 font-normal">({p.wordCount} คำ)</span>
                    </summary>
                    <p className="mt-3 text-sm text-gray-700 whitespace-pre-line leading-relaxed">{p.passage}</p>
                  </details>
                );
              }
              const q = it.q;
              const picked = answers[q.uid];
              const rv = review[q.uid];
              const correctIndex = rv ? rv.correctIndex : -1;
              const showLetters = q.section.startsWith("READING");
              const isError = q.section === "WRITING_ERROR";
              const correct = picked === correctIndex;
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
                    <p className="font-bold text-gray-800 whitespace-pre-line">{isError ? renderErrorStem(q.stem) : q.stem}</p>
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
                          {isError ? (
                            <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[#003399]/10 text-[#003399] text-xs font-black mr-1.5 align-middle">
                              {oi + 1}
                            </span>
                          ) : (
                            showLetters && <span className="font-bold mr-1">{LETTERS[oi]}.</span>
                          )}
                          {isError ? stripOptPrefix(opt) : opt}
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
            <button onClick={start} className="rounded-xl bg-[#003399] text-white font-black px-5 py-2.5 hover:bg-[#002266] transition">
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
    <main className="flex-1 bg-[#f4f6fb] pb-24">
      <div className="sticky top-0 z-10 bg-white border-b-2 border-[#003399]/10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className={`font-black text-lg ${lowTime ? "text-red-600" : "text-[#003399]"}`}>⏱ {fmtTime(secondsLeft)}</div>
          <div className="text-sm text-gray-500 font-bold">
            ตอบแล้ว {answeredCount}/{totalQuestions}
          </div>
          <button
            onClick={handleSubmitClick}
            disabled={!canSubmit || submitting}
            className={`rounded-xl font-black px-4 py-2 transition ${
              canSubmit && !submitting
                ? "bg-[#FFD700] text-[#003399] hover:brightness-95"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {submitting ? "กำลังส่ง…" : canSubmit ? "ส่งคำตอบ" : `ส่งได้ใน ${fmtTime(submitCountdown)}`}
          </button>
        </div>
        {!canSubmit && (
          <div className="bg-[#003399]/5 text-[#003399] text-xs text-center py-1.5 font-bold">
            ⏳ ส่งคำตอบได้หลังทำครบ 40 นาที — ระหว่างนี้ทบทวน/แก้คำตอบได้
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
              <h3 key={`s${i}`} className="text-sm font-black text-white bg-[#003399] rounded-lg px-3 py-2 mt-4">
                {SECTION_LABEL[it.section]}
              </h3>
            );
          }
          if (it.kind === "passage") {
            const p = passages[it.passageId];
            if (!p) return null;
            return (
              <div key={`p${i}`} className="rounded-xl bg-white border-2 border-[#003399]/15 p-4">
                <p className="font-black text-[#003399] mb-2">
                  📄 {p.title} <span className="text-xs text-gray-400 font-normal">({p.wordCount} คำ)</span>
                </p>
                <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">{p.passage}</p>
              </div>
            );
          }
          const q = it.q;
          const picked = answers[q.uid];
          const showLetters = q.section.startsWith("READING");
          const isError = q.section === "WRITING_ERROR";
          return (
            <div key={q.uid} className="rounded-xl bg-white border border-gray-200 p-4">
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-black text-white bg-[#003399]">
                  {it.number}
                </span>
                <p className="font-bold text-gray-800 whitespace-pre-line">{isError ? renderErrorStem(q.stem) : q.stem}</p>
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
                          ? "border-[#003399] bg-[#003399]/10 font-bold text-[#003399]"
                          : "border-gray-200 text-gray-700 hover:border-[#003399]/40"
                      }`}
                    >
                      {isError ? (
                        <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[#003399]/10 text-[#003399] text-xs font-black mr-2 align-middle">
                          {oi + 1}
                        </span>
                      ) : (
                        showLetters && <span className="font-bold mr-1">{LETTERS[oi]}.</span>
                      )}
                      {isError ? stripOptPrefix(opt) : opt}
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
              ? "bg-[#003399] text-white hover:bg-[#002266]"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          {submitting ? "กำลังส่ง…" : canSubmit ? "ส่งคำตอบ" : `ส่งได้หลังทำครบ 40 นาที (อีก ${fmtTime(submitCountdown)})`}
        </button>
      </div>
    </main>
  );
}
