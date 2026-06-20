"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  loadAllMockResults,
  loadSeasonLeaderboard,
  ATTEMPTS_PER_DAY,
  type MockResultRow,
  type SeasonRankEntry,
} from "../lib/cloud";
import { fmtTime } from "../lib/netsat";

// จำนวนครั้งที่ออกจากหน้าจอที่ถือว่า "น่าสงสัย"
const SUSPICIOUS_SWITCHES = 5;

const SECTION_SHORT: Record<string, string> = {
  WRITING_ERROR: "Error Identification",
  WRITING_SC: "Sentence Completion",
  READING_SHORT: "Reading สั้น",
  READING_LONG: "Reading ยาว",
};
const SECTION_ORDER = ["WRITING_ERROR", "WRITING_SC", "READING_SHORT", "READING_LONG"];

function fmtDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface StudentAgg {
  email: string;
  name: string;
  attempts: number;
  bestPercent: number;
  bestTimeSec: number;
  lastPercent: number;
  lastMs: number;
  maxSwitches: number;
}

// ── กราฟ/สรุปพัฒนาการของนักเรียนหนึ่งคน (attempts เรียงเก่า→ใหม่) ──
function StudentProgress({ attempts }: { attempts: MockResultRow[] }) {
  if (attempts.length === 0) return <p className="text-sm text-gray-400">ยังไม่มีข้อมูล</p>;
  const pcts = attempts.map((a) => a.percent);
  const first = pcts[0];
  const last = pcts[pcts.length - 1];
  const delta = last - first;
  const best = Math.max(...pcts);
  const avg = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
  const times = attempts.map((a) => a.timeSec).filter((t) => t > 0);
  const avgTime = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : 0;

  // รวมคะแนนรายพาร์ททุกครั้ง → ดูว่าพาร์ทไหนแม่น/อ่อน
  const secAgg: Record<string, { correct: number; total: number }> = {};
  for (const a of attempts) {
    for (const [k, v] of Object.entries(a.bySection || {})) {
      const s = (secAgg[k] ??= { correct: 0, total: 0 });
      s.correct += v.correct || 0;
      s.total += v.total || 0;
    }
  }

  // เส้นกราฟ %
  const W = 280;
  const H = 80;
  const pad = 8;
  const n = pcts.length;
  const px = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const py = (p: number) => H - pad - (p / 100) * (H - pad * 2);
  const line = pcts.map((p, i) => `${px(i).toFixed(1)},${py(p).toFixed(1)}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-black text-[#003399]">ทำไปแล้ว {n} ครั้ง</span>
        <span className="text-gray-600">
          ครั้งแรก <b>{first}%</b> → ล่าสุด <b>{last}%</b>{" "}
          <span
            className={delta > 0 ? "text-green-600 font-bold" : delta < 0 ? "text-red-500 font-bold" : "text-gray-400"}
          >
            ({delta > 0 ? "+" : ""}
            {delta}%)
          </span>
        </span>
        <span className="text-gray-600">
          ดีสุด <b className="text-green-600">{best}%</b>
        </span>
        <span className="text-gray-600">
          เฉลี่ย <b>{avg}%</b>
        </span>
        {avgTime > 0 && (
          <span className="text-gray-600">
            เวลาเฉลี่ย <b>{fmtTime(avgTime)}</b>
          </span>
        )}
      </div>

      <div className="grid md:grid-cols-[280px_1fr] gap-4 items-start">
        {/* กราฟเส้นแนวโน้ม % */}
        <div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-white rounded-lg border border-gray-200">
            {[0, 50, 100].map((g) => (
              <line key={g} x1={pad} x2={W - pad} y1={py(g)} y2={py(g)} stroke="#eee" strokeWidth="1" />
            ))}
            {n > 1 && <polyline points={line} fill="none" stroke="#003399" strokeWidth="2" />}
            {pcts.map((p, i) => (
              <circle key={i} cx={px(i)} cy={py(p)} r="3.5" fill="#FFD700" stroke="#003399" strokeWidth="1.5">
                <title>{`ครั้งที่ ${i + 1}: ${p}%`}</title>
              </circle>
            ))}
          </svg>
          <p className="text-[10px] text-gray-400 text-center mt-1">แนวโน้มเปอร์เซ็นต์ (ซ้าย=เก่าสุด → ขวา=ล่าสุด)</p>
        </div>

        {/* ความแม่นรายพาร์ท (เฉลี่ยทุกครั้ง) */}
        <div className="space-y-2">
          <p className="text-xs font-black text-gray-500">ความแม่นรายพาร์ท (รวมทุกครั้ง)</p>
          {SECTION_ORDER.filter((k) => secAgg[k]?.total).map((k) => {
            const s = secAgg[k];
            const pct = Math.round((s.correct / s.total) * 100);
            const weak = pct < 50;
            return (
              <div key={k} className="text-xs">
                <div className="flex justify-between mb-0.5">
                  <span className="font-bold text-gray-700">{SECTION_SHORT[k] || k}</span>
                  <span className={weak ? "text-red-500 font-bold" : "text-gray-500"}>
                    {pct}% ({s.correct}/{s.total})
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${weak ? "bg-red-400" : "bg-[#003399]"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ตารางทุกครั้ง */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 text-left">
              <th className="px-2 py-1">ครั้งที่</th>
              <th className="px-2 py-1">วันที่</th>
              <th className="px-2 py-1 text-center">%</th>
              <th className="px-2 py-1 text-center">ถูก</th>
              <th className="px-2 py-1 text-center">เวลา</th>
              <th className="px-2 py-1 text-center">ออกจอ</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a, i) => (
              <tr key={a.id} className="border-t border-gray-100">
                <td className="px-2 py-1 text-gray-400">{i + 1}</td>
                <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{fmtDate(a.createdAtMs)}</td>
                <td className="px-2 py-1 text-center font-bold text-[#003399]">{a.percent}%</td>
                <td className="px-2 py-1 text-center text-gray-600">
                  {a.correctCount}/{a.totalQuestions}
                </td>
                <td className="px-2 py-1 text-center text-gray-600">{a.timeSec > 0 ? fmtTime(a.timeSec) : "—"}</td>
                <td
                  className={`px-2 py-1 text-center ${
                    a.tabSwitches >= SUSPICIOUS_SWITCHES ? "text-red-600 font-bold" : "text-gray-500"
                  }`}
                >
                  {a.tabSwitches}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminPage() {
  // null = กำลังตรวจสถานะล็อกอิน, false = ยังไม่ล็อกอิน, true = ล็อกอินแล้ว
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [rows, setRows] = useState<MockResultRow[]>([]);
  const [board, setBoard] = useState<SeasonRankEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // ตรวจ cookie ล็อกอินจากเซิร์ฟเวอร์
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/me");
        const j = await r.json();
        setAuthed(!!j.authed);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  async function reload() {
    setLoading(true);
    const [r, b] = await Promise.all([loadAllMockResults(), loadSeasonLeaderboard()]);
    setRows(r);
    setBoard(b);
    setLoading(false);
  }

  // โหลดข้อมูลเมื่อยืนยันว่าล็อกอินแล้ว
  useEffect(() => {
    if (authed !== true) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const [r, b] = await Promise.all([loadAllMockResults(), loadSeasonLeaderboard()]);
      if (!alive) return;
      setRows(r);
      setBoard(b);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [authed]);

  async function doLogin() {
    setLoginErr("");
    const password = pw.trim();
    if (!password) return;
    setLoggingIn(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const j = await r.json();
      if (r.ok && j.ok) {
        setPw("");
        setAuthed(true);
      } else {
        setLoginErr(j.error || "รหัสผ่านไม่ถูกต้อง");
      }
    } catch {
      setLoginErr("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setLoggingIn(false);
    }
  }

  async function doLogout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setRows([]);
    setBoard([]);
    setAuthed(false);
  }

  // แต้มสะสม (seasonXp) ต่อคน
  const seasonByEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of board) m.set(e.email, e.seasonXp);
    return m;
  }, [board]);

  // ผลรายครั้งของแต่ละคน เรียงเก่า→ใหม่ (สำหรับกราฟพัฒนาการ)
  const attemptsByEmail = useMemo(() => {
    const m = new Map<string, MockResultRow[]>();
    for (const r of rows) {
      const arr = m.get(r.email) ?? [];
      arr.push(r);
      m.set(r.email, arr);
    }
    m.forEach((arr) => arr.sort((a, b) => a.createdAtMs - b.createdAtMs));
    return m;
  }, [rows]);

  // สรุปผลรายคน — best = เปอร์เซ็นต์สูงสุด, เสมอกันใช้เวลาน้อยกว่า
  const students = useMemo<StudentAgg[]>(() => {
    const map = new Map<string, StudentAgg>();
    for (const r of rows) {
      const cur = map.get(r.email);
      if (!cur) {
        map.set(r.email, {
          email: r.email,
          name: r.name || r.email.split("@")[0],
          attempts: 1,
          bestPercent: r.percent,
          bestTimeSec: r.timeSec,
          lastPercent: r.percent,
          lastMs: r.createdAtMs,
          maxSwitches: r.tabSwitches,
        });
      } else {
        cur.attempts += 1;
        const better =
          r.percent > cur.bestPercent ||
          (r.percent === cur.bestPercent && r.timeSec > 0 && (cur.bestTimeSec <= 0 || r.timeSec < cur.bestTimeSec));
        if (better) {
          cur.bestPercent = r.percent;
          cur.bestTimeSec = r.timeSec;
        }
        if (r.createdAtMs > cur.lastMs) {
          cur.lastMs = r.createdAtMs;
          cur.lastPercent = r.percent;
        }
        cur.maxSwitches = Math.max(cur.maxSwitches, r.tabSwitches);
        if (r.name && !cur.name) cur.name = r.name;
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        b.bestPercent - a.bestPercent ||
        (a.bestTimeSec || Number.MAX_SAFE_INTEGER) - (b.bestTimeSec || Number.MAX_SAFE_INTEGER) ||
        b.attempts - a.attempts
    );
  }, [rows]);

  const winners = students.slice(0, 3);
  const totalAttempts = rows.length;
  const avgPercent = rows.length ? Math.round(rows.reduce((s, r) => s + r.percent, 0) / rows.length) : 0;

  // ── กำลังตรวจสถานะ ──
  if (authed === null) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <p className="text-gray-400">กำลังตรวจสอบ…</p>
      </main>
    );
  }

  // ── ยังไม่ล็อกอิน → ฟอร์มใส่รหัสผ่าน ──
  if (!authed) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <div className="w-full max-w-sm rounded-2xl bg-white border-2 border-gray-200 p-6">
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">🛡️</div>
            <h1 className="font-black text-lg text-[#003399]">โหมดครู</h1>
            <p className="text-sm text-gray-500 mt-1">ใส่รหัสผ่านเพื่อเข้าดูข้อมูล</p>
          </div>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doLogin();
            }}
            placeholder="รหัสผ่านครู"
            autoFocus
            className="w-full rounded-lg border-2 border-gray-200 px-3 py-2 focus:border-[#003399] outline-none"
          />
          {loginErr && <p className="text-sm text-red-500 mt-2">{loginErr}</p>}
          <button
            onClick={doLogin}
            disabled={loggingIn || !pw.trim()}
            className="mt-3 w-full rounded-lg bg-[#003399] text-white font-black py-2.5 hover:brightness-110 transition disabled:opacity-50"
          >
            {loggingIn ? "กำลังเข้า…" : "เข้าสู่ระบบ"}
          </button>
          <Link href="/" className="mt-4 block text-center text-sm text-gray-400 underline hover:text-gray-600">
            ← กลับหน้าหลัก
          </Link>
        </div>
      </main>
    );
  }

  // ── หน้าครู ──
  return (
    <main className="flex-1 bg-[#f4f6fb]">
      <header className="bg-[#003399] text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🛡️</span>
            <span className="text-xl font-black">โหมดครู — English Exam Master</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/items"
              className="text-sm rounded-lg bg-[#FFD700] text-[#003399] px-3 py-1.5 font-black hover:brightness-95 transition"
            >
              📝 ตรวจ/ซ่อนข้อสอบ
            </Link>
            <Link href="/" className="text-sm text-white/80 underline hover:text-white">
              ← หน้าหลัก
            </Link>
            <button
              onClick={doLogout}
              className="text-sm rounded-lg bg-white/15 px-3 py-1.5 font-bold hover:bg-white/25 transition"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* ภาพรวม */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-black text-[#003399]">📊 ภาพรวมห้อง</h2>
            <button
              onClick={reload}
              disabled={loading}
              className="text-sm rounded-lg bg-white border-2 border-[#003399]/20 px-3 py-1.5 font-bold text-[#003399] hover:border-[#003399] transition disabled:opacity-50"
            >
              {loading ? "กำลังโหลด…" : "↻ รีเฟรช"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white border-2 border-gray-200 p-4 text-center">
              <div className="text-3xl font-black text-[#003399]">{students.length}</div>
              <div className="text-xs text-gray-500 font-bold mt-1">นักเรียนที่ทำสอบ</div>
            </div>
            <div className="rounded-2xl bg-white border-2 border-gray-200 p-4 text-center">
              <div className="text-3xl font-black text-[#003399]">{totalAttempts}</div>
              <div className="text-xs text-gray-500 font-bold mt-1">ทำสอบทั้งหมด (ครั้ง)</div>
            </div>
            <div className="rounded-2xl bg-white border-2 border-gray-200 p-4 text-center">
              <div className="text-3xl font-black text-[#003399]">{avgPercent}%</div>
              <div className="text-xs text-gray-500 font-bold mt-1">คะแนนเฉลี่ย</div>
            </div>
          </div>
        </section>

        {/* ผู้ชนะ (ตรวจสอบก่อนแจกรางวัล) */}
        <section>
          <h2 className="text-lg font-black text-[#003399] mb-1">🏅 ผู้นำ 3 อันดับ (ชิงรางวัล)</h2>
          <p className="text-[11px] text-gray-500 mb-3">
            จัดอันดับจากเปอร์เซ็นต์ครั้งที่ดีที่สุด เสมอกันตัดที่เวลาน้อยกว่า —
            <b className="text-[#003399]"> ก่อนแจกเงินรางวัล แนะนำให้เรียก 3 คนนี้มาทำสดแบบคุมสอบ 1 รอบเพื่อยืนยันฝีมือ</b>
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            {winners.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มีผู้ทำสอบ</p>
            ) : (
              winners.map((w, i) => {
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
                const prize = i === 0 ? "700฿" : i === 1 ? "300฿" : "100฿";
                const flagged = w.maxSwitches >= SUSPICIOUS_SWITCHES;
                return (
                  <div
                    key={w.email}
                    className={`rounded-2xl border-2 p-4 ${flagged ? "border-red-300 bg-red-50" : "border-[#FFD700] bg-white"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{medal}</span>
                      <span className="text-xs font-black bg-[#FFD700] text-[#003399] rounded-full px-2 py-0.5">{prize}</span>
                    </div>
                    <div className="font-black text-gray-800 mt-1 truncate">{w.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{w.email}</div>
                    <div className="mt-2 text-2xl font-black text-[#003399]">{w.bestPercent}%</div>
                    <div className="text-xs text-gray-500">
                      เวลา {fmtTime(w.bestTimeSec)} · ทำ {w.attempts} ครั้ง
                    </div>
                    {flagged && (
                      <div className="mt-2 text-[11px] font-bold text-red-600">
                        ⚠️ ออกจากหน้าจอสูงสุด {w.maxSwitches} ครั้ง — ควรตรวจสอบ
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* รายชื่อนักเรียน */}
        <section>
          <h2 className="text-lg font-black text-[#003399] mb-1">👥 รายชื่อนักเรียน (เรียงตามคะแนนแข่งขัน)</h2>
          <p className="text-[11px] text-gray-500 mb-3">👉 คลิกชื่อนักเรียนเพื่อดูกราฟพัฒนาการรายคน</p>
          <div className="rounded-2xl bg-white border-2 border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#003399]/5 text-[#003399] text-left">
                    <th className="px-3 py-2 font-black">#</th>
                    <th className="px-3 py-2 font-black">ชื่อ</th>
                    <th className="px-3 py-2 font-black text-center">ครั้ง</th>
                    <th className="px-3 py-2 font-black text-center">ดีสุด</th>
                    <th className="px-3 py-2 font-black text-center">เวลา</th>
                    <th className="px-3 py-2 font-black text-center">ออกจอ</th>
                    <th className="px-3 py-2 font-black text-center">ล่าสุด</th>
                    <th className="px-3 py-2 font-black text-center">XP</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                        {loading ? "กำลังโหลด…" : "ยังไม่มีนักเรียนทำสอบ"}
                      </td>
                    </tr>
                  ) : (
                    students.map((s, i) => {
                      const flagged = s.maxSwitches >= SUSPICIOUS_SWITCHES;
                      const isOpen = expanded === s.email;
                      return (
                        <Fragment key={s.email}>
                          <tr
                            className={`border-t border-gray-100 cursor-pointer hover:bg-[#003399]/[0.03] ${isOpen ? "bg-[#003399]/[0.03]" : ""}`}
                            onClick={() => setExpanded(isOpen ? null : s.email)}
                          >
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2">
                              <div className="font-bold text-[#003399] flex items-center gap-1">
                                <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                                {s.name}
                              </div>
                              <div className="text-[11px] text-gray-400 pl-4">{s.email}</div>
                            </td>
                            <td className="px-3 py-2 text-center font-bold">{s.attempts}</td>
                            <td className="px-3 py-2 text-center font-bold text-green-600">{s.bestPercent}%</td>
                            <td className="px-3 py-2 text-center text-gray-600">
                              {s.bestTimeSec > 0 ? fmtTime(s.bestTimeSec) : "—"}
                            </td>
                            <td className={`px-3 py-2 text-center font-bold ${flagged ? "text-red-600" : "text-gray-500"}`}>
                              {flagged ? `⚠️ ${s.maxSwitches}` : s.maxSwitches}
                            </td>
                            <td className="px-3 py-2 text-center text-gray-600">{s.lastPercent}%</td>
                            <td className="px-3 py-2 text-center font-black text-[#003399]">
                              {seasonByEmail.get(s.email) ?? 0}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="bg-[#f4f6fb]">
                              <td colSpan={8} className="px-4 py-4">
                                <StudentProgress attempts={attemptsByEmail.get(s.email) ?? []} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            &quot;ออกจอ&quot; = จำนวนครั้งสูงสุดที่ออกจากหน้าสอบในรอบใดรอบหนึ่ง (≥ {SUSPICIOUS_SWITCHES} ครั้ง = น่าสงสัย) ·
            จำกัด {ATTEMPTS_PER_DAY} ครั้ง/วัน
          </p>
        </section>

        {/* ผลสอบล่าสุด */}
        <section>
          <h2 className="text-lg font-black text-[#003399] mb-3">🕒 ผลสอบล่าสุด</h2>
          <div className="rounded-2xl bg-white border-2 border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#003399]/5 text-[#003399] text-left">
                    <th className="px-3 py-2 font-black">เวลา</th>
                    <th className="px-3 py-2 font-black">ชื่อ</th>
                    <th className="px-3 py-2 font-black text-center">%</th>
                    <th className="px-3 py-2 font-black text-center">ถูก</th>
                    <th className="px-3 py-2 font-black text-center">ใช้เวลา</th>
                    <th className="px-3 py-2 font-black text-center">ออกจอ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                        {loading ? "กำลังโหลด…" : "ยังไม่มีผลสอบ"}
                      </td>
                    </tr>
                  ) : (
                    rows.slice(0, 50).map((r) => {
                      const flagged = r.tabSwitches >= SUSPICIOUS_SWITCHES;
                      return (
                        <tr key={r.id} className={`border-t border-gray-100 ${flagged ? "bg-red-50" : ""}`}>
                          <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtDate(r.createdAtMs)}</td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-gray-800">{r.name || r.email.split("@")[0]}</div>
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-[#003399]">{r.percent}%</td>
                          <td className="px-3 py-2 text-center text-gray-600">
                            {r.correctCount}/{r.totalQuestions}
                          </td>
                          <td className="px-3 py-2 text-center text-gray-600">{r.timeSec > 0 ? fmtTime(r.timeSec) : "—"}</td>
                          <td className={`px-3 py-2 text-center font-bold ${flagged ? "text-red-600" : "text-gray-500"}`}>
                            {flagged ? `⚠️ ${r.tabSwitches}` : r.tabSwitches}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-2">แสดงผลสอบล่าสุดสูงสุด 50 รายการ · แถวสีแดง = ออกจากหน้าจอบ่อยผิดปกติ</p>
        </section>
      </div>
    </main>
  );
}
