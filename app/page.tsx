"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  loadStudent,
  loadSeasonLeaderboard,
  isSeasonOver,
  type StudentProfile,
  type SeasonRankEntry,
} from "./lib/cloud";
import { fmtTime } from "./lib/netsat";

// ── คีย์เก็บตัวตนผู้ใช้ใน localStorage (ใช้อีเมลเป็นกุญแจ เหมือนแอป vocab) ──
const LS_EMAIL = "exam_user_email";
const LS_NAME = "exam_user_name";

// ── ข้อมูลสนามสอบ (ตาม blueprint) ──
interface ExamCard {
  key: string;
  title: string;
  subtitle: string;
  icons: string;
  items: string;
  time: string;
  parts: string;
  href: string | null; // null = ยังไม่เปิด
  accent: string; // สีหัวการ์ด
}

const EXAMS: ExamCard[] = [
  {
    key: "TGAT",
    title: "TGAT 1",
    subtitle: "English Communication",
    icons: "🎙️ 📖",
    items: "60 ข้อ",
    time: "60 นาที",
    parts: "Speaking 30 · Reading 30",
    href: null,
    accent: "#003399",
  },
  {
    key: "ALEVEL",
    title: "A-Level 82",
    subtitle: "ภาษาอังกฤษ",
    icons: "🎧 📖 ✏️",
    items: "80 ข้อ",
    time: "90 นาที",
    parts: "Listening-Speaking · Reading · Writing",
    href: null,
    accent: "#b91c1c",
  },
  {
    key: "NETSAT",
    title: "NETSAT",
    subtitle: "ภาษาอังกฤษ (มข.)",
    icons: "📖 📊",
    items: "40 ข้อ",
    time: "50 นาที",
    parts: "Reading · Writing / Structure",
    href: "/netsat",
    accent: "#003399",
  },
];

function greetingByHour(): string {
  const h = new Date().getHours();
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 18) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนค่ำ";
}

export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // ฟอร์มล็อกอิน
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [board, setBoard] = useState<SeasonRankEntry[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // โหลดตัวตนจาก localStorage ตอนเปิดหน้า
  useEffect(() => {
    try {
      const e = window.localStorage.getItem(LS_EMAIL) || "";
      const n = window.localStorage.getItem(LS_NAME) || "";
      setEmail(e);
      setName(n);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // เมื่อมีอีเมลแล้ว → โหลดโปรไฟล์ + อันดับจากคลาวด์
  useEffect(() => {
    if (!email) return;
    let alive = true;
    setLoadingData(true);
    (async () => {
      const [p, b] = await Promise.all([loadStudent(email), loadSeasonLeaderboard()]);
      if (!alive) return;
      setProfile(p);
      setBoard(b);
      if (p?.name && !name) {
        setName(p.name);
        try {
          window.localStorage.setItem(LS_NAME, p.name);
        } catch {
          /* ignore */
        }
      }
      setLoadingData(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  function handleLogin() {
    const e = emailInput.trim().toLowerCase();
    if (!e || !e.includes("@")) {
      alert("กรุณากรอกอีเมลให้ถูกต้อง");
      return;
    }
    const n = nameInput.trim();
    try {
      window.localStorage.setItem(LS_EMAIL, e);
      if (n) window.localStorage.setItem(LS_NAME, n);
    } catch {
      /* ignore */
    }
    setEmail(e);
    setName(n);
  }

  function handleLogout() {
    try {
      window.localStorage.removeItem(LS_EMAIL);
      window.localStorage.removeItem(LS_NAME);
    } catch {
      /* ignore */
    }
    setEmail("");
    setName("");
    setProfile(null);
    setBoard([]);
    setEmailInput("");
    setNameInput("");
  }

  if (!ready) return null;

  // ───────────────────────── หน้าล็อกอิน ─────────────────────────
  if (!email) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-10 bg-[#f4f6fb]">
        <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border-2 border-[#003399]/10 p-8">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">📘</div>
            <h1 className="text-2xl font-black text-[#003399]">English Exam Master</h1>
            <p className="text-sm text-gray-500 mt-1">ศูนย์สอบจำลอง NETSAT · TGAT · A-Level</p>
          </div>
          <label className="block text-sm font-bold text-gray-700 mb-1">อีเมล</label>
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="you@example.com"
            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 mb-4 outline-none focus:border-[#003399]"
          />
          <label className="block text-sm font-bold text-gray-700 mb-1">ชื่อที่แสดง (ถ้ามีในระบบแล้วเว้นว่างได้)</label>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="เช่น น้องสมชาย"
            className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 mb-6 outline-none focus:border-[#003399]"
          />
          <button
            onClick={handleLogin}
            className="w-full rounded-xl bg-[#003399] text-white font-black py-3 text-lg hover:bg-[#002266] transition"
          >
            เข้าสู่ระบบ
          </button>
          <p className="text-xs text-gray-400 text-center mt-4">
            ใช้อีเมลเดียวกับแอปคำศัพท์ เพื่อให้แต้มและสถิติเชื่อมกัน
          </p>
        </div>
      </main>
    );
  }

  // ───────────────────────── หน้า hub ─────────────────────────
  const displayName = name || profile?.name || email.split("@")[0];
  const seasonXp = profile?.seasonXp ?? 0;
  const streak = profile?.streak ?? 0;
  const level = Math.floor(seasonXp / 100) + 1;
  const intoLevel = seasonXp % 100;
  const seasonOver = isSeasonOver();
  const myBest = profile?.seasonBestPercent ?? 0;
  const myBestTime = profile?.seasonBestTimeSec ?? 0;

  // อันดับ: แสดงทุกคนที่มีคะแนนในซีซั่นนี้ เรียงตาม % (เวลาเป็นแค่ตัวตัดเสมอ)
  // หมายเหตุ: ไม่กรอง timeSec อีกแล้ว — เดิมกรอง timeSec>0 ทำให้คนที่ "คะแนนดีสุด"
  // เป็นครั้งที่ไม่มีเวลาบันทึก (ข้อมูลเก่า) หายไปทั้งคน
  const ranked = board.filter((r) => r.bestPercent > 0);

  return (
    <main className="flex-1 bg-[#f4f6fb]">
      {/* แถบหัว */}
      <header className="bg-[#003399] text-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📘</span>
            <span className="text-xl font-black">English Exam Master</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right leading-tight">
              <div className="font-bold text-sm">{displayName}</div>
              <div className="text-[11px] text-white/70">{email}</div>
            </div>
            <div className="hidden sm:block min-w-[140px]">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-bold text-[#FFD700]">Level {level}</span>
                <span className="text-white/70">{intoLevel}/100 XP</span>
              </div>
              <div className="h-2 rounded-full bg-white/20 overflow-hidden">
                <div className="h-full bg-[#FFD700]" style={{ width: `${intoLevel}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-1 font-bold">
              <span>🔥</span>
              <span>{streak}</span>
              <span className="text-[11px] text-white/70">วัน</span>
            </div>
            <button onClick={handleLogout} className="text-[11px] text-white/70 underline hover:text-white">
              ออกจากระบบ
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 grid lg:grid-cols-[1fr_300px] gap-6">
        {/* คอลัมน์หลัก */}
        <section>
          {/* คำทักทาย */}
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-black text-[#003399]">
              {greetingByHour()}, {displayName}! 🔥 ลุยสอบจำลองกันเถอะ
            </h1>
            <p className="text-gray-500 mt-1">ความสม่ำเสมอ คือกุญแจสู่มหาวิทยาลัยในฝัน</p>
            {myBest > 0 && (
              <p className="text-sm font-bold text-[#003399] mt-2">
                🏅 คะแนนสอบ NETSAT ดีที่สุดของคุณรอบนี้: {myBest}%{" "}
                <span className="text-gray-400 font-normal">(ใช้เวลา {fmtTime(myBestTime)})</span>
              </p>
            )}
          </div>

          <h2 className="text-lg font-black text-[#003399] mb-3">🎯 ศูนย์รวมข้อสอบจำลอง (Mock Exams)</h2>

          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {EXAMS.map((ex) => {
              const active = !!ex.href;
              return (
                <div
                  key={ex.key}
                  className={`rounded-2xl bg-white border-2 p-5 flex flex-col ${
                    active ? "border-[#FFD700] shadow-lg" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black" style={{ color: ex.accent }}>
                      {ex.title}
                    </h3>
                    {!active && (
                      <span className="text-[10px] font-bold bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                        เร็ว ๆ นี้
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-gray-600">{ex.subtitle}</p>
                  <div className="text-2xl my-3">{ex.icons}</div>
                  <p className="font-black text-gray-800">
                    {ex.items} / {ex.time}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 flex-1">{ex.parts}</p>
                  {active ? (
                    <Link
                      href={ex.href!}
                      className="mt-4 block text-center rounded-xl bg-[#003399] text-white font-black py-2.5 hover:bg-[#002266] transition"
                    >
                      เริ่มสอบจำลอง
                    </Link>
                  ) : (
                    <button
                      disabled
                      className="mt-4 rounded-xl bg-gray-100 text-gray-400 font-black py-2.5 cursor-not-allowed"
                    >
                      เร็ว ๆ นี้
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* คอลัมน์ข้าง — อันดับการแข่งขัน NETSAT */}
        <aside>
          <div className="rounded-2xl bg-white border-2 border-gray-200 p-5">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-black text-[#003399]">🏆 NETSAT Challenge</h2>
              {seasonOver && (
                <span className="text-[10px] font-bold bg-gray-800 text-white rounded-full px-2 py-0.5">
                  ปิดรอบแล้ว
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              {seasonOver ? "🏁 อันดับสุดท้าย" : "จัดอันดับจากเปอร์เซ็นต์ดีที่สุด · ตัดรอบ 10 ส.ค. 2569"}
            </p>
            {loadingData ? (
              <p className="text-sm text-gray-400">กำลังโหลด…</p>
            ) : ranked.length === 0 ? (
              <p className="text-sm text-gray-400">ยังไม่มีใครทำคะแนน — ทำสอบจำลองให้จบเพื่อขึ้นอันดับ!</p>
            ) : (
              <ol className="space-y-2">
                {ranked.slice(0, 10).map((row, i) => {
                  const me = row.email === email.toLowerCase();
                  const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
                  return (
                    <li
                      key={row.email}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                        me ? "bg-[#FFD700]/20 font-black" : "bg-gray-50"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="w-6 text-center">{medal}</span>
                        <span className="truncate">{me ? "คุณ" : row.name}</span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="font-bold text-[#003399]">{row.bestPercent}%</span>
                        <span className="block text-[10px] text-gray-400">{fmtTime(row.timeSec)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="text-[11px] text-gray-400 mt-3">
              จัดอันดับจาก &quot;เปอร์เซ็นต์ครั้งที่ดีที่สุด&quot; เสมอกันตัดที่เวลาน้อยกว่า — ทำซ้ำได้ นับเฉพาะรอบที่ดีสุด
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
