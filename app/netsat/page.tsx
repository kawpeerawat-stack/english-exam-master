"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  loadBank,
  assembleMock,
  scoreMock,
  fmtTime,
  EXAM_SECONDS,
  SECTION_LABEL,
  type AssembledMock,
  type MockQuestion,
  type MockResult,
  type Section,
} from "../lib/netsat";
import { saveMockResult, loadHiddenItemIds } from "../lib/cloud";

type Phase = "intro" | "loading" | "taking" | "result";

type RenderItem =
  | { kind: "section"; section: Section }
  | { kind: "passage"; passageId: string }
  | { kind: "question"; q: MockQuestion; number: number };

function buildRenderItems(mock: AssembledMock): RenderItem[] {
  const items: RenderItem[] = [];
  const shown = new Set<string>();
  let lastSection: Section | null = null;
  let number = 0;
  for (const q of mock.questions) {
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

export default function NetsatPage() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [mock, setMock] = useState<AssembledMock | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const [result, setResult] = useState<MockResult | null>(null);
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const start = useCallback(async () => {
    setError("");
    setPhase("loading");
    try {
      const [bank, hidden] = await Promise.all([loadBank(), loadHiddenItemIds()]);
      const m = assembleMock(bank, new Set(hidden));
      setMock(m);
      setAnswers({});
      setSecondsLeft(EXAM_SECONDS);
      setResult(null);
      setSaveMsg("");
      setPhase("taking");
      window.scrollTo(0, 0);
    } catch {
      setError("โหลดคลังข้อไม่สำเร็จ — ตรวจว่าไฟล์ public/netsat-bank.json อยู่ใน repo แล้ว");
      setPhase("intro");
    }
  }, []);

  const submit = useCallback(() => {
    if (!mock) return;
    const r = scoreMock(mock, answers);
    setResult(r);
    setPhase("result");
    window.scrollTo(0, 0);

    let email = "";
    let name = "";
    try {
      email = window.localStorage.getItem("exam_user_email") || "";
      name = window.localStorage.getItem("exam_user_name") || "";
    } catch {
      /* ignore */
    }
    if (!email) {
      setSaveMsg("ℹ️ ทำแบบไม่ล็อกอิน — ผลไม่ถูกบันทึก (เข้าสู่ระบบจากหน้าหลักเพื่อเก็บแต้ม)");
      return;
    }
    setSaveMsg("กำลังบันทึกผล…");
    saveMockResult(email, name, {
      earnedPoints: r.earnedPoints,
      totalPoints: r.totalPoints,
      percent: r.percent,
      correctCount: r.correctCount,
      totalQuestions: r.totalQuestions,
      bySection: r.bySection,
    })
      .then((res) =>
        setSaveMsg(res ? `บันทึกผลแล้ว ✓ +${res.xpGained} XP` : "บันทึกไม่สำเร็จ — เช็กการเชื่อมต่อ/โดเมน reCAPTCHA")
      )
      .catch(() => setSaveMsg("บันทึกไม่สำเร็จ"));
  }, [mock, answers]);

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

  const items = useMemo(() => (mock ? buildRenderItems(mock) : []), [mock]);
  const answeredCount = Object.keys(answers).length;

  function choose(uid: string, idx: number) {
    setAnswers((a) => ({ ...a, [uid]: idx }));
  }

  function handleSubmitClick() {
    if (!mock) return;
    const left = mock.totalQuestions - answeredCount;
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
            <p className="text-gray-500 pt-1">คะแนนถ่วงน้ำหนัก 2/3/4 ตามความยาก · สุ่มข้อใหม่ทุกครั้ง · จับเวลา 50 นาที (หมดเวลาส่งอัตโนมัติ)</p>
          </div>
          {error && <p className="mt-4 text-sm text-red-600 font-bold">{error}</p>}
          <button
            onClick={start}
            disabled={phase === "loading"}
            className="mt-6 w-full rounded-xl bg-[#003399] text-white font-black py-3 text-lg hover:bg-[#002266] transition disabled:opacity-60"
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
  if (phase === "result" && result && mock) {
    const sectionsOrder: Section[] = ["WRITING_ERROR", "WRITING_SC", "READING_SHORT", "READING_LONG"];
    return (
      <main className="flex-1 bg-[#f4f6fb]">
        <div className="max-w-3xl mx-auto px-4 py-8">
          {/* สรุปคะแนน */}
          <div className="rounded-3xl bg-white border-2 border-[#FFD700] shadow-lg p-6 text-center">
            <p className="text-gray-500 font-bold">คะแนนสอบจำลอง NETSAT</p>
            <p className="text-5xl font-black text-[#003399] my-2">
              {result.earnedPoints}
              <span className="text-2xl text-gray-400"> / {result.totalPoints}</span>
            </p>
            <p className="text-gray-600 font-bold">
              ตอบถูก {result.correctCount}/{result.totalQuestions} ข้อ · {result.percent}%
            </p>
            {saveMsg && <p className="mt-2 text-sm font-bold text-[#003399]">{saveMsg}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2 text-left text-sm">
              {sectionsOrder.map((sec) => {
                const s = result.bySection[sec];
                if (!s) return null;
                return (
                  <div key={sec} className="rounded-lg bg-[#003399]/5 px-3 py-2">
                    <div className="font-bold text-[#003399]">{SECTION_LABEL[sec].split("—")[1]?.trim() ?? SECTION_LABEL[sec]}</div>
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
            <p className="text-[11px] text-gray-400 mt-4">เร็ว ๆ นี้: บันทึกผลขึ้นระบบ + นับแต้มเข้าอันดับรายสัปดาห์</p>
          </div>

          {/* ทบทวนเฉลย */}
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
                const p = mock.passages[it.passageId];
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
              const showLetters = q.section.startsWith("READING");
              const correct = picked === q.correctIndex;
              return (
                <div key={q.uid} className="rounded-xl bg-white border border-gray-200 p-4">
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-black text-white ${correct ? "bg-green-600" : "bg-red-500"}`}>
                      {it.number}
                    </span>
                    <p className="font-bold text-gray-800 whitespace-pre-line">{q.stem}</p>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {q.options.map((opt, oi) => {
                      const isCorrect = oi === q.correctIndex;
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
                          {showLetters && <span className="font-bold mr-1">{LETTERS[oi]}.</span>}
                          {opt}
                          {isCorrect && <span className="ml-2 text-xs">✓ เฉลย</span>}
                          {isPicked && !isCorrect && <span className="ml-2 text-xs">← คุณตอบ</span>}
                        </div>
                      );
                    })}
                  </div>
                  {q.explanation_th && (
                    <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">💡 {q.explanation_th}</p>
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
      {/* แถบจับเวลา (ติดบน) */}
      <div className="sticky top-0 z-10 bg-white border-b-2 border-[#003399]/10 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className={`font-black text-lg ${lowTime ? "text-red-600" : "text-[#003399]"}`}>
            ⏱ {fmtTime(secondsLeft)}
          </div>
          <div className="text-sm text-gray-500 font-bold">
            ตอบแล้ว {answeredCount}/{mock?.totalQuestions ?? 0}
          </div>
          <button onClick={handleSubmitClick} className="rounded-xl bg-[#FFD700] text-[#003399] font-black px-4 py-2 hover:brightness-95 transition">
            ส่งคำตอบ
          </button>
        </div>
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
            const p = mock!.passages[it.passageId];
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
          return (
            <div key={q.uid} className="rounded-xl bg-white border border-gray-200 p-4">
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-black text-white bg-[#003399]">
                  {it.number}
                </span>
                <p className="font-bold text-gray-800 whitespace-pre-line">{q.stem}</p>
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
                      {showLetters && <span className="font-bold mr-1">{LETTERS[oi]}.</span>}
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
          className="w-full rounded-xl bg-[#003399] text-white font-black py-3 text-lg hover:bg-[#002266] transition"
        >
          ส่งคำตอบ
        </button>
      </div>
    </main>
  );
}
