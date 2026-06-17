import { db } from "./firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";

const COLLECTION = "students";

export function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

export function currentWeekId(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

export interface StudentProfile {
  name: string;
  email: string;
  weeklyXp: number;
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
      streak?: number; bestStreak?: number;
    };
    const thisWeek = currentWeekId();
    return {
      name: d.name || "",
      email: (d.email || email).toLowerCase(),
      weeklyXp: d.weekId === thisWeek ? (d.weeklyXp ?? 0) : 0,
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
        entries.push({
          email: (d.email || s.id).toLowerCase(),
          name: d.name || "(ไม่มีชื่อ)",
          weeklyXp,
        });
      }
    });
    entries.sort((a, b) => b.weeklyXp - a.weeklyXp);
    return entries;
  } catch (e) {
    console.error("loadWeeklyLeaderboard error:", e);
    return [];
  }
}
