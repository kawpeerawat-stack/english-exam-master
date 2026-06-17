// app/lib/cloud.ts
// ─────────────────────────────────────────────────────────────
//   - collection "students" ใช้ร่วมกับแอป vocab → ล็อกอิน/แต้ม/streak เป็นระบบเดียวกัน
//   - ผลสอบจำลองเขียนลง collection ใหม่ "mockResults"
//   - การแข่งขัน NETSAT Challenge นับจาก seasonXp (เฉพาะคะแนนสอบจำลอง)
// ─────────────────────────────────────────────────────────────

import { db } from "./firebase";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

const COLLECTION = "students";
const MOCK_COLLECTION = "mockResults";

// ── ฤดูกาลแข่งขัน NETSAT ──
// เปลี่ยน SEASON_ID เมื่อต้องการ "รีเซ็ตอันดับใหม่ทั้งหมด" → ทุกคนกลับเป็น 0 อัตโนมัติ
export const SEASON_ID = "netsat-2026";
// วันตัดรอบ (เวลาไทย) — หลังจากนี้การทำสอบจะไม่บวกแต้มเข้าอันดับอีก (อันดับล็อกผลสุดท้าย)
export const SEASON_END = new Date("2026-08-10T23:59:59+07:00");
export function isSeasonOver(now: Date = new Date()): boolean {
  return now.getTime() > SEASON_END.getTime();
}

export function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

// รหัสสัปดาห์ = วันจันทร์ของสัปดาห์นั้น (ใช้กับ weeklyXp ที่แชร์กับแอป vocab)
export function currentWeekId(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return ymd(x);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const dbb = new Date(b + "T00:00:00");
  return Math.round((dbb.getTime() - da.getTime()) / 86400000);
}

export interface StudentProfile {
  name: string;
  email: string;
  weeklyXp: number;
  seasonXp: number;
  streak: number;
  bestStreak: number;
}

export async function loadStudent(email: string): Promise<StudentProfile | null> {
  if (!email || !db) return null;
  try {
    const ref = doc(db, COLLECTION, emailToId(email));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data() as {
      name?: string; email?: string;
      weeklyXp?: number; weekId?: string;
      seasonXp?: number; seasonId?: string;
      streak?: number; bestStreak?: number;
    };
    const thisWeek = currentWeekId();
    return {
      name: d.name || "",
      email: (d.email || email).toLowerCase(),
      weeklyXp: d.weekId === thisWeek ? (d.weeklyXp ?? 0) : 0,
      seasonXp: d.seasonId === SEASON_ID ? (d.seasonXp ?? 0) : 0,
      streak: d.streak ?? 0,
      bestStreak: d.bestStreak ?? 0,
    };
  } catch (e) {
    console.error("loadStudent error:", e);
    return null;
  }
}

export interface WeeklyRankEntry {
  email: string;
  name: string;
  weeklyXp: number;
}

export async function loadWeeklyLeaderboard(): Promise<WeeklyRankEntry[]> {
  if (!db) return [];
  try {
    const thisWeek = currentWeekId();
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: WeeklyRankEntry[] = [];
    snap.forEach((s) => {
      const d = s.data() as { email?: string; name?: string; weeklyXp?: number; weekId?: string };
      const weeklyXp = d.weekId === thisWeek ? (d.weeklyXp ?? 0) : 0;
      if (weeklyXp > 0) {
        entries.push({ email: (d.email || s.id).toLowerCase(), name: d.name || "(ไม่มีชื่อ)", weeklyXp });
      }
    });
    entries.sort((a, b) => b.weeklyXp - a.weeklyXp);
    return entries;
  } catch (e) {
    console.error("loadWeeklyLeaderboard error:", e);
    return [];
  }
}

// ── อันดับการแข่งขัน NETSAT (นับเฉพาะคะแนนสอบจำลอง สะสมจนถึงวันตัดรอบ) ──
export interface SeasonRankEntry {
  email: string;
  name: string;
  seasonXp: number;
}

export async function loadSeasonLeaderboard(): Promise<SeasonRankEntry[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: SeasonRankEntry[] = [];
    snap.forEach((s) => {
      const d = s.data() as { email?: string; name?: string; seasonXp?: number; seasonId?: string };
      const seasonXp = d.seasonId === SEASON_ID ? (d.seasonXp ?? 0) : 0;
      if (seasonXp > 0) {
        entries.push({ email: (d.email || s.id).toLowerCase(), name: d.name || "(ไม่มีชื่อ)", seasonXp });
      }
    });
    entries.sort((a, b) => b.seasonXp - a.seasonXp);
    return entries;
  } catch (e) {
    console.error("loadSeasonLeaderboard error:", e);
    return [];
  }
}

export interface MockSavePayload {
  earnedPoints: number;
  totalPoints: number;
  percent: number;
  correctCount: number;
  totalQuestions: number;
  bySection: object;
}

export async function saveMockResult(
  email: string,
  name: string,
  payload: MockSavePayload
): Promise<{ xpGained: number } | null> {
  if (!email || !db) return null;
  try {
    const id = emailToId(email);
    const ref = doc(db, COLLECTION, id);
    const snap = await getDoc(ref);
    const cur = (snap.exists() ? snap.data() : {}) as {
      name?: string; weeklyXp?: number; weekId?: string;
      seasonXp?: number; seasonId?: string;
      streak?: number; bestStreak?: number; lastStudyDate?: string;
      todayCount?: number; netsatAttempts?: number; netsatBestPercent?: number;
    };

    // streak รายวัน
    const today = ymd(new Date());
    const last = cur.lastStudyDate || "";
    let streak = cur.streak ?? 0;
    if (last === today) {
      // ทำกิจกรรมวันนี้ไปแล้ว
    } else if (last && daysBetween(last, today) === 1) {
      streak += 1;
    } else {
      streak = 1;
    }
    const bestStreak = Math.max(cur.bestStreak ?? 0, streak);
    const todayCount = last === today ? (cur.todayCount ?? 0) + 1 : 1;

    // แต้มรายสัปดาห์ (แชร์กับแอปคำศัพท์ — บวกตามปกติ)
    const thisWeek = currentWeekId();
    const prevWeekly = cur.weekId === thisWeek ? (cur.weeklyXp ?? 0) : 0;
    const weeklyXp = prevWeekly + payload.earnedPoints;

    // แต้มฤดูกาลแข่งขัน NETSAT (สะสมเฉพาะช่วงแข่ง; รีเซ็ตเมื่อ SEASON_ID เปลี่ยน)
    const inSeason = !isSeasonOver();
    let seasonXp: number;
    if (cur.seasonId === SEASON_ID) {
      seasonXp = (cur.seasonXp ?? 0) + (inSeason ? payload.earnedPoints : 0);
    } else {
      seasonXp = inSeason ? payload.earnedPoints : 0;
    }

    // 1) เก็บผลสอบเต็ม ๆ ลง collection ใหม่
    await addDoc(collection(db, MOCK_COLLECTION), {
      email: id,
      name: name || cur.name || "",
      exam: "NETSAT",
      earnedPoints: payload.earnedPoints,
      totalPoints: payload.totalPoints,
      percent: payload.percent,
      correctCount: payload.correctCount,
      totalQuestions: payload.totalQuestions,
      bySection: payload.bySection,
      weekId: thisWeek,
      seasonId: SEASON_ID,
      createdAt: serverTimestamp(),
    });

    // 2) อัปเดตโปรไฟล์นักเรียน
    await setDoc(
      ref,
      {
        email: id,
        name: name || cur.name || "",
        weeklyXp,
        weekId: thisWeek,
        seasonXp,
        seasonId: SEASON_ID,
        streak,
        bestStreak,
        lastStudyDate: today,
        todayCount,
        netsatAttempts: (cur.netsatAttempts ?? 0) + 1,
        netsatBestPercent: Math.max(cur.netsatBestPercent ?? 0, payload.percent),
        netsatLastPercent: payload.percent,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { xpGained: payload.earnedPoints };
  } catch (e) {
    console.error("saveMockResult error:", e);
    return null;
  }
}
