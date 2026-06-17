"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isTeacher,
  loadAllMockResults,
  loadSeasonLeaderboard,
  ATTEMPTS_PER_DAY,
  type MockResultRow,
  type SeasonRankEntry,
} from "../lib/cloud";
import { fmtTime } from "../lib/netsat";

const LS_EMAIL = "exam_user_email";
// จำนวนครั้งที่ออกจากหน้าจอที่ถือว่า "น่าสงสัย"
const SUSPICIOUS_SWITCHES = 5;

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

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [rows, setRows] = useState<MockResultRow[]>([]);
  const [board, setBoard] = useState<SeasonRankEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      setEmail(window.localStorage.getItem(LS_EMAIL) || "");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const allowed = isTeacher(email);

  async function reload() {
    setLoading(true);
    const [r, b] = await Promise.all([loadAllMockResults(), loadSeasonLeaderboard()]);
    setRows(r);
    setBoard(b);
    setLoading(false);
  }

  useEffect(() => {
    if (!allowed) return;
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
  }, [allowed]);

  // แต้มสะสม (seasonXp) ต่อคน
  const seasonByEmail = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of board) m.set(e.email, e.seasonXp);
    return m;
  }, [board]);

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

  if (!ready) return null;

  // ── ยังไม่ได้ล็อกอิน ──
  if (!email) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-gray-700">กรุณาเข้าสู่ระบบจากหน้าหลักก่อน</p>
          <Link href="/" className="mt-4 inline-block text-[#003399] underline font-bold">
            ← ไปหน้าหลัก
          </Link>
        </div>
      </main>
    );
  }

  // ── ล็อกอินแล้วแต่ไม่ใช่ครู ──
  if (!allowed) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-black text-lg text-[#003399]">หน้านี้สำหรับครูเท่านั้น</p>
          <p className="text-sm text-gray-500 mt-2">บัญชี {email} ไม่มีสิทธิ์เข้าถึงโหมดครู</p>
          <Link href="/" className="mt-4 inline-block text-[#003399] underline font-bold">
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
                      <span className="text-xs font-black bg-[#FFD700] text-[#003399] rounded-full px-2 py-0.5">
                        {prize}
                      </span>
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
          <h2 className="text-lg font-black text-[#003399] mb-3">👥 รายชื่อนักเรียน (เรียงตามคะแนนแข่งขัน)</h2>
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
                      return (
                        <tr key={s.email} className="border-t border-gray-100">
                          <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-gray-800">{s.name}</div>
                            <div className="text-[11px] text-gray-400">{s.email}</div>
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
                          <td className="px-3 py-2 text-center text-gray-600">
                            {r.timeSec > 0 ? fmtTime(r.timeSec) : "—"}
                          </td>
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
