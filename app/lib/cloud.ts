// app/lib/cloud.ts
// ─────────────────────────────────────────────────────────────
//   - collection "students" ใช้ร่วมกับแอป vocab → ล็อกอิน/แต้ม/streak เป็นระบบเดียวกัน
//   - ผลสอบจำลองเขียนลง collection ใหม่ "mockResults"
//   - แต้มสะสม (seasonXp/weeklyXp/streak) ยังบวกทุกครั้งเพื่อจูงใจให้ฝึกบ่อย
//   - การแข่งขัน NETSAT Challenge จัดอันดับจาก "เปอร์เซ็นต์สอบครั้งที่ดีที่สุด" (เสมอกันตัดที่เวลาน้อยกว่า)
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
  arrayUnion,
  arrayRemove,
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

// ── จำกัดจำนวนครั้งที่ทำสอบได้ต่อวัน (กันการฟาร์มแต้ม) — แก้ตัวเลขได้ ──
export const ATTEMPTS_PER_DAY = 3;

// ── อีเมลที่เป็น "ครู" (เข้าหน้า /admin ได้) — เพิ่มอีเมลในวงเล็บได้ ──
export const TEACHER_EMAILS = ["kawpeerawat@gmail.com"];
export function isTeacher(email: string): boolean {
  return TEACHER_EMAILS.includes(email.trim().toLowerCase());
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
  seasonBestPercent: number;
  seasonBestTimeSec: number;
  streak: number;
  bestStreak: number;
  todayAttempts: number;
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
      seasonBestPercent?: number; seasonBestTimeSec?: number;
      streak?: number; bestStreak?: number;
      lastStudyDate?: string; todayCount?: number;
    };
    const thisWeek = currentWeekId();
    const sameSeason = d.seasonId === SEASON_ID;
    return {
      name: d.name || "",
      email: (d.email || email).toLowerCase(),
      weeklyXp: d.weekId === thisWeek ? (d.weeklyXp ?? 0) : 0,
      seasonXp: sameSeason ? (d.seasonXp ?? 0) : 0,
      seasonBestPercent: sameSeason ? (d.seasonBestPercent ?? 0) : 0,
      seasonBestTimeSec: sameSeason ? (d.seasonBestTimeSec ?? 0) : 0,
      streak: d.streak ?? 0,
      bestStreak: d.bestStreak ?? 0,
      todayAttempts: d.lastStudyDate === ymd(new Date()) ? (d.todayCount ?? 0) : 0,
    };
  } catch (e) {
    console.error("loadStudent error:", e);
    return null;
  }
}

// นับจำนวนครั้งที่ "ทำสอบสำเร็จ" ในวันนี้ (ใช้บังคับลิมิตต่อวัน)
export async function countTodayAttempts(email: string): Promise<number> {
  if (!email || !db) return 0;
  try {
    const snap = await getDoc(doc(db, COLLECTION, emailToId(email)));
    if (!snap.exists()) return 0;
    const d = snap.data() as { lastStudyDate?: string; todayCount?: number };
    return d.lastStudyDate === ymd(new Date()) ? (d.todayCount ?? 0) : 0;
  } catch {
    return 0;
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

// ── อันดับการแข่งขัน NETSAT (จัดอันดับจากเปอร์เซ็นต์ครั้งที่ดีที่สุด เสมอกันตัดที่เวลาน้อยกว่า) ──
export interface SeasonRankEntry {
  email: string;
  name: string;
  seasonXp: number;
  bestPercent: number;
  timeSec: number; // เวลาที่ใช้ในรอบที่ดีที่สุด (วินาที)
}

export async function loadSeasonLeaderboard(): Promise<SeasonRankEntry[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, COLLECTION));
    const entries: SeasonRankEntry[] = [];
    snap.forEach((s) => {
      const d = s.data() as {
        email?: string; name?: string; seasonId?: string;
        seasonXp?: number; seasonBestPercent?: number; seasonBestTimeSec?: number;
      };
      if (d.seasonId !== SEASON_ID) return;
      const seasonXp = d.seasonXp ?? 0;
      const timeSec = d.seasonBestTimeSec ?? 0;
      // เก็บเฉพาะคนที่มีผลในรอบนี้ (มีแต้มสะสม หรือ มีสถิติครั้งดีสุด)
      if (seasonXp <= 0 && timeSec <= 0) return;
      entries.push({
        email: (d.email || s.id).toLowerCase(),
        name: d.name || "(ไม่มีชื่อ)",
        seasonXp,
        bestPercent: d.seasonBestPercent ?? 0,
        timeSec,
      });
    });
    // เปอร์เซ็นต์มากก่อน, เสมอกันใช้เวลาน้อยกว่า (timeSec 0 = ยังไม่มีสถิติ → ไปท้าย)
    entries.sort(
      (a, b) =>
        b.bestPercent - a.bestPercent ||
        (a.timeSec || Number.MAX_SAFE_INTEGER) - (b.timeSec || Number.MAX_SAFE_INTEGER)
    );
    return entries;
  } catch (e) {
    console.error("loadSeasonLeaderboard error:", e);
    return [];
  }
}

// ── อ่านผลสอบทั้งหมด (สำหรับหน้าครู /admin) ──
export type SectionStat = { correct: number; total: number; earned: number; points: number };
export interface MockResultRow {
  id: string;
  email: string;
  name: string;
  earnedPoints: number;
  totalPoints: number;
  percent: number;
  correctCount: number;
  totalQuestions: number;
  timeSec: number;
  tabSwitches: number;
  awaySec: number;
  bySection: Record<string, SectionStat>;
  createdAtMs: number;
}

export async function loadAllMockResults(max = 500): Promise<MockResultRow[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, MOCK_COLLECTION));
    const rows: MockResultRow[] = [];
    snap.forEach((s) => {
      const d = s.data() as Record<string, unknown>;
      const ts = d.createdAt as { toMillis?: () => number } | undefined;
      rows.push({
        id: s.id,
        email: String(d.email ?? ""),
        name: String(d.name ?? ""),
        earnedPoints: Number(d.earnedPoints ?? 0),
        totalPoints: Number(d.totalPoints ?? 0),
        percent: Number(d.percent ?? 0),
        correctCount: Number(d.correctCount ?? 0),
        totalQuestions: Number(d.totalQuestions ?? 0),
        timeSec: Number(d.timeSec ?? 0),
        tabSwitches: Number(d.tabSwitches ?? 0),
        awaySec: Number(d.awaySec ?? 0),
        bySection:
          d.bySection && typeof d.bySection === "object"
            ? (d.bySection as Record<string, SectionStat>)
            : {},
        createdAtMs: ts?.toMillis?.() ?? 0,
      });
    });
    rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return rows.slice(0, max);
  } catch (e) {
    console.error("loadAllMockResults error:", e);
    return [];
  }
}

// ── ข้อที่ครู "ซ่อน" (เก็บ id ไว้ใน config/hiddenItems → engine กรองออกตอนสุ่ม) ──
export async function loadHiddenItemIds(): Promise<string[]> {
  if (!db) return [];
  try {
    const ref = doc(db, "config", "hiddenItems");
    const snap = await getDoc(ref);
    if (!snap.exists()) return [];
    const d = snap.data() as { ids?: string[] };
    return Array.isArray(d.ids) ? d.ids : [];
  } catch (e) {
    console.error("loadHiddenItemIds error:", e);
    return [];
  }
}

export async function setItemHidden(itemId: string, hidden: boolean): Promise<boolean> {
  if (!db) return false;
  try {
    const ref = doc(db, "config", "hiddenItems");
    await setDoc(ref, { ids: hidden ? arrayUnion(itemId) : arrayRemove(itemId) }, { merge: true });
    return true;
  } catch (e) {
    console.error("setItemHidden error:", e);
    return false;
  }
}

export interface MockSavePayload {
  earnedPoints: number;
  totalPoints: number;
  percent: number;
  correctCount: number;
  totalQuestions: number;
  bySection: object;
  timeSec: number;      // เวลาที่ใช้สอบ (วินาที)
  tabSwitches: number;  // จำนวนครั้งที่ออกจากหน้าจอ
  awaySec: number;      // เวลารวมที่ออกจากหน้าจอ (วินาที)
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
      seasonBestPercent?: number; seasonBestTimeSec?: number;
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

    // คะแนนชิงรางวัล = "ครั้งที่ดีที่สุด" (เปอร์เซ็นต์สูงสุด; เสมอกันเก็บเวลาที่น้อยกว่า) — เฉพาะช่วงแข่ง
    const sameSeason = cur.seasonId === SEASON_ID;
    const prevBestPct = sameSeason ? (cur.seasonBestPercent ?? -1) : -1;
    const prevBestTime = sameSeason ? (cur.seasonBestTimeSec ?? 0) : 0;
    let seasonBestPercent = prevBestPct < 0 ? 0 : prevBestPct;
    let seasonBestTimeSec = prevBestTime;
    if (inSeason) {
      const isBetter =
        prevBestPct < 0 ||
        payload.percent > prevBestPct ||
        (payload.percent === prevBestPct && (prevBestTime <= 0 || payload.timeSec < prevBestTime));
      if (isBetter) {
        seasonBestPercent = payload.percent;
        seasonBestTimeSec = payload.timeSec;
      }
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
      timeSec: payload.timeSec,
      tabSwitches: payload.tabSwitches,
      awaySec: payload.awaySec,
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
        seasonBestPercent,
        seasonBestTimeSec,
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
