// app/api/netsat/grade/route.ts
// ─────────────────────────────────────────────────────────────
// ส่งคำตอบ → ตรวจคะแนนฝั่งเซิร์ฟเวอร์ (จากเฉลยใน session):
//   - กันตรวจซ้ำ (session ใช้ครั้งเดียว) + บังคับเวลาขั้นต่ำ 40 นาที (อิงเวลาเซิร์ฟเวอร์)
//   - เขียนผล + อัปเดตแต้ม/สถิติ ด้วย Admin SDK (เด็กปลอมคะแนนไม่ได้)
//   - ส่งกลับเฉลย+คำอธิบายเพื่อให้หน้าทบทวนแสดงผล
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firebaseAdmin";
import { scoreFromKey, EXAM_SECONDS, MIN_SUBMIT_SECONDS, type AnswerKeyEntry } from "@/app/lib/netsat";
import { SEASON_ID, isSeasonOver, currentWeekId, ymd, daysBetween } from "@/app/lib/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIME_TOLERANCE_SEC = 60; // เผื่อความหน่วงเครือข่ายตอนกด "เริ่ม"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      sessionId?: string;
      email?: string;
      answers?: Record<string, number>;
      tabSwitches?: number;
      awaySec?: number;
    };
    const sessionId = (body.sessionId || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const answers = body.answers || {};
    const tabSwitches = Number(body.tabSwitches ?? 0);
    const awaySec = Number(body.awaySec ?? 0);
    if (!sessionId || !email) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }

    const db = adminDb();
    const sessRef = db.collection("mockSessions").doc(sessionId);
    const sessSnap = await sessRef.get();
    if (!sessSnap.exists) {
      return NextResponse.json({ error: "ไม่พบรอบสอบนี้ (อาจหมดอายุ) — กรุณาเริ่มใหม่" }, { status: 404 });
    }
    const sess = sessSnap.data() as {
      email: string;
      name?: string;
      graded?: boolean;
      seasonId?: string;
      answerKey: Record<string, AnswerKeyEntry>;
      createdAt?: { toMillis?: () => number };
    };

    // เจ้าของรอบต้องตรงกัน
    if (sess.email !== email) {
      return NextResponse.json({ error: "รอบสอบนี้ไม่ใช่ของบัญชีนี้" }, { status: 403 });
    }
    // กันส่งซ้ำ/ตรวจซ้ำ (กันยิงซ้ำเพื่อไล่หาเฉลย)
    if (sess.graded) {
      return NextResponse.json({ error: "รอบสอบนี้ส่งไปแล้ว" }, { status: 409 });
    }

    // บังคับเวลาขั้นต่ำ 40 นาที (อิงเวลาเซิร์ฟเวอร์ จาก createdAt)
    const startedMs = sess.createdAt?.toMillis?.() ?? 0;
    const elapsedSec = startedMs > 0 ? Math.round((Date.now() - startedMs) / 1000) : EXAM_SECONDS;
    if (elapsedSec < MIN_SUBMIT_SECONDS - TIME_TOLERANCE_SEC) {
      const wait = MIN_SUBMIT_SECONDS - elapsedSec;
      return NextResponse.json(
        { error: `ยังส่งไม่ได้ ต้องทำอย่างน้อย 40 นาที (เหลืออีกประมาณ ${Math.ceil(wait / 60)} นาที)`, tooEarly: true },
        { status: 425 }
      );
    }
    const timeSec = Math.min(EXAM_SECONDS, Math.max(0, elapsedSec));

    // ── ตรวจคะแนนจากเฉลยใน session ──
    const result = scoreFromKey(sess.answerKey, answers);
    const inSeason = !isSeasonOver();

    // mark graded ก่อน เพื่อกันยิงซ้ำ
    await sessRef.update({ graded: true, gradedAt: FieldValue.serverTimestamp() });

    const id = sess.email;
    const name = sess.name || "";

    // ── อัปเดตโปรไฟล์นักเรียน (ตรรกะเดียวกับของเดิม แต่ทำฝั่งเซิร์ฟเวอร์) ──
    const stuRef = db.collection("students").doc(id);
    const stuSnap = await stuRef.get();
    const cur = (stuSnap.exists ? stuSnap.data() : {}) as {
      name?: string; weeklyXp?: number; weekId?: string;
      seasonXp?: number; seasonId?: string;
      seasonBestPercent?: number; seasonBestTimeSec?: number;
      streak?: number; bestStreak?: number; lastStudyDate?: string;
      todayCount?: number; netsatAttempts?: number; netsatBestPercent?: number;
    };

    const today = ymd(new Date());
    const last = cur.lastStudyDate || "";
    let streak = cur.streak ?? 0;
    if (last === today) {
      /* ทำวันนี้ไปแล้ว — คงเดิม */
    } else if (last && daysBetween(last, today) === 1) {
      streak += 1;
    } else {
      streak = 1;
    }
    const bestStreak = Math.max(cur.bestStreak ?? 0, streak);
    const todayCount = last === today ? (cur.todayCount ?? 0) + 1 : 1;

    const thisWeek = currentWeekId();
    const prevWeekly = cur.weekId === thisWeek ? (cur.weeklyXp ?? 0) : 0;
    const weeklyXp = prevWeekly + result.earnedPoints;

    let seasonXp: number;
    if (cur.seasonId === SEASON_ID) {
      seasonXp = (cur.seasonXp ?? 0) + (inSeason ? result.earnedPoints : 0);
    } else {
      seasonXp = inSeason ? result.earnedPoints : 0;
    }

    // คะแนนชิงรางวัล = ครั้งดีสุด (เปอร์เซ็นต์สูงสุด; เสมอกันเวลาน้อยกว่า)
    const sameSeason = cur.seasonId === SEASON_ID;
    const prevBestPct = sameSeason ? (cur.seasonBestPercent ?? -1) : -1;
    const prevBestTime = sameSeason ? (cur.seasonBestTimeSec ?? 0) : 0;
    let seasonBestPercent = prevBestPct < 0 ? 0 : prevBestPct;
    let seasonBestTimeSec = prevBestTime;
    if (inSeason) {
      const isBetter =
        prevBestPct < 0 ||
        result.percent > prevBestPct ||
        (result.percent === prevBestPct && (prevBestTime <= 0 || timeSec < prevBestTime));
      if (isBetter) {
        seasonBestPercent = result.percent;
        seasonBestTimeSec = timeSec;
      }
    }

    // 1) เก็บผลสอบเต็ม ๆ (เขียนโดยเซิร์ฟเวอร์เท่านั้น)
    await db.collection("mockResults").add({
      email: id,
      name: name || cur.name || "",
      exam: "NETSAT",
      earnedPoints: result.earnedPoints,
      totalPoints: result.totalPoints,
      percent: result.percent,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      bySection: result.bySection,
      timeSec,
      tabSwitches,
      awaySec,
      weekId: thisWeek,
      seasonId: SEASON_ID,
      sessionId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 2) อัปเดตโปรไฟล์
    await stuRef.set(
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
        netsatBestPercent: Math.max(cur.netsatBestPercent ?? 0, result.percent),
        netsatLastPercent: result.percent,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ── ส่งกลับ: ผล + เฉลย/คำอธิบาย (สำหรับหน้าทบทวน) ──
    const review: Record<string, { correctIndex: number; explanation_th: string }> = {};
    for (const uid of Object.keys(sess.answerKey)) {
      review[uid] = {
        correctIndex: sess.answerKey[uid].correctIndex,
        explanation_th: sess.answerKey[uid].explanation_th,
      };
    }

    return NextResponse.json({
      result: {
        earnedPoints: result.earnedPoints,
        totalPoints: result.totalPoints,
        percent: result.percent,
        correctCount: result.correctCount,
        totalQuestions: result.totalQuestions,
        bySection: result.bySection,
        timeSec,
      },
      review,
      xpGained: result.earnedPoints,
    });
  } catch (e) {
    console.error("netsat/grade error:", e);
    return NextResponse.json({ error: "ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
