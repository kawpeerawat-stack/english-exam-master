// app/lib/tgat-cloud.ts
// ─────────────────────────────────────────────────────────────
// โหลดข้อมูล TGAT ฝั่งเบราว์เซอร์ — กระดานคะแนน "แยก" จาก NETSAT
//   - อ่าน mockResults เฉพาะ seasonId = TGAT แล้วจัดอันดับจากคะแนนครั้งที่ดีที่สุด
//   - ไม่แตะ cloud.ts (ของ NETSAT) เลย
// ─────────────────────────────────────────────────────────────
import { db } from "./firebase";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { emailToId, ymd } from "./season";
import { TGAT_SEASON_ID, TGAT_ATTEMPTS_PER_DAY, TGAT_SEASON_START, TGAT_SEASON_END } from "./tgat-season";

const MOCK_COLLECTION = "mockResults";
const STUDENTS = "students";

// ช่วงแข่งจริง (มิลลิวินาที) — นับอันดับเฉพาะผลที่ทำในช่วงนี้
const WINDOW_START = TGAT_SEASON_START.getTime();
const WINDOW_END = TGAT_SEASON_END.getTime();

export interface TgatRankEntry {
  email: string;
  name: string;
  bestScore: number; // /100
  timeSec: number;   // เวลาในรอบที่ดีที่สุด
}

// อันดับ TGAT: คะแนนครั้งที่ดีที่สุด (เสมอกันตัดที่เวลาน้อยกว่า)
export async function loadTgatLeaderboard(): Promise<TgatRankEntry[]> {
  if (!db) return [];
  try {
    const snap = await getDocs(collection(db, MOCK_COLLECTION));
    const byEmail = new Map<string, { name: string; nameAtMs: number; bestScore: number; bestTimeSec: number }>();
    snap.forEach((s) => {
      const d = s.data() as {
        email?: string; name?: string; seasonId?: string;
        percent?: number; score?: number; timeSec?: number;
        createdAt?: { toMillis?: () => number };
      };
      if (d.seasonId !== TGAT_SEASON_ID) return; // เฉพาะผล TGAT
      const email = (d.email || "").toLowerCase();
      if (!email) return;
      const score = d.score ?? d.percent ?? 0;
      const timeSec = d.timeSec ?? 0;
      const ms = d.createdAt?.toMillis?.() ?? 0;
      // นับเฉพาะผลที่ทำในช่วงแข่งจริง (17 ส.ค. – 25 ก.ย. 2569)
      // ก่อนเริ่ม = ซ้อม (ไม่นับ) · หลังปิด = แช่อันดับสุดท้ายไว้ (ผลใหม่ไม่นับ)
      if (ms < WINDOW_START || ms > WINDOW_END) return;
      const cur = byEmail.get(email);
      if (!cur) {
        byEmail.set(email, { name: d.name || "(ไม่มีชื่อ)", nameAtMs: ms, bestScore: score, bestTimeSec: timeSec });
      } else {
        const better =
          score > cur.bestScore ||
          (score === cur.bestScore && timeSec > 0 && (cur.bestTimeSec <= 0 || timeSec < cur.bestTimeSec));
        if (better) {
          cur.bestScore = score;
          cur.bestTimeSec = timeSec;
        }
        if (ms >= cur.nameAtMs && d.name) {
          cur.name = d.name;
          cur.nameAtMs = ms;
        }
      }
    });
    const entries: TgatRankEntry[] = [];
    byEmail.forEach((v, email) => entries.push({ email, name: v.name, bestScore: v.bestScore, timeSec: v.bestTimeSec }));
    entries.sort(
      (a, b) =>
        b.bestScore - a.bestScore ||
        (a.timeSec || Number.MAX_SAFE_INTEGER) - (b.timeSec || Number.MAX_SAFE_INTEGER)
    );
    return entries;
  } catch (e) {
    console.error("loadTgatLeaderboard error:", e);
    return [];
  }
}

export interface TgatProfile {
  bestScore: number;
  lastScore: number;
  attempts: number;
  todayAttempts: number;
  attemptsPerDay: number;
}

export async function loadTgatProfile(email: string): Promise<TgatProfile | null> {
  if (!email || !db) return null;
  try {
    const snap = await getDoc(doc(db, STUDENTS, emailToId(email)));
    if (!snap.exists()) {
      return { bestScore: 0, lastScore: 0, attempts: 0, todayAttempts: 0, attemptsPerDay: TGAT_ATTEMPTS_PER_DAY };
    }
    const d = snap.data() as {
      tgatSeasonId?: string; tgatBestScore?: number; tgatLastScore?: number;
      tgatAttempts?: number; tgatLastDate?: string; tgatTodayCount?: number;
    };
    const sameSeason = d.tgatSeasonId === TGAT_SEASON_ID;
    return {
      bestScore: sameSeason ? (d.tgatBestScore ?? 0) : 0,
      lastScore: d.tgatLastScore ?? 0,
      attempts: d.tgatAttempts ?? 0,
      todayAttempts: d.tgatLastDate === ymd(new Date()) ? (d.tgatTodayCount ?? 0) : 0,
      attemptsPerDay: TGAT_ATTEMPTS_PER_DAY,
    };
  } catch (e) {
    console.error("loadTgatProfile error:", e);
    return null;
  }
}
