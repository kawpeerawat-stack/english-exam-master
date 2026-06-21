// app/api/tgat/grade/route.ts
// ─────────────────────────────────────────────────────────────
// ส่งคำตอบ TGAT → ตรวจคะแนนฝั่งเซิร์ฟเวอร์ (จากเฉลยใน session):
//   - กันตรวจซ้ำ + บังคับเวลาขั้นต่ำ 45 นาที (อิงเวลาเซิร์ฟเวอร์)
//   - คะแนน Speaking 50 + Reading 50 (รวม 100)
//   - เก็บผลลง mockResults (seasonId = TGAT) → กระดานคะแนน TGAT แยกจาก NETSAT
//   - อัปเดตโปรไฟล์เฉพาะฟิลด์ tgat* (merge) → ไม่แตะแต้ม/อันดับ NETSAT
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firebaseAdmin";
import {
  scoreTgatFromKey,
  TGAT_EXAM_SECONDS,
  TGAT_MIN_SUBMIT_SECONDS,
  type TgatAnswerKeyEntry,
} from "@/app/lib/tgat";
import { TGAT_SEASON_ID, isTgatSeasonOver } from "@/app/lib/tgat-season";
import { ymd } from "@/app/lib/season";

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
    const sessRef = db.collection("tgatSessions").doc(sessionId);
    const sessSnap = await sessRef.get();
    if (!sessSnap.exists) {
      return NextResponse.json({ error: "ไม่พบรอบสอบนี้ (อาจหมดอายุ) — กรุณาเริ่มใหม่" }, { status: 404 });
    }
    const sess = sessSnap.data() as {
      email: string;
      name?: string;
      graded?: boolean;
      seasonId?: string;
      answerKey: Record<string, TgatAnswerKeyEntry>;
      createdAt?: { toMillis?: () => number };
    };

    if (sess.email !== email) {
      return NextResponse.json({ error: "รอบสอบนี้ไม่ใช่ของบัญชีนี้" }, { status: 403 });
    }
    if (sess.graded) {
      return NextResponse.json({ error: "รอบสอบนี้ส่งไปแล้ว" }, { status: 409 });
    }

    // บังคับเวลาขั้นต่ำ 45 นาที (อิงเวลาเซิร์ฟเวอร์ จาก createdAt)
    const startedMs = sess.createdAt?.toMillis?.() ?? 0;
    const elapsedSec = startedMs > 0 ? Math.round((Date.now() - startedMs) / 1000) : TGAT_EXAM_SECONDS;
    if (elapsedSec < TGAT_MIN_SUBMIT_SECONDS - TIME_TOLERANCE_SEC) {
      const wait = TGAT_MIN_SUBMIT_SECONDS - elapsedSec;
      return NextResponse.json(
        { error: `ยังส่งไม่ได้ ต้องทำอย่างน้อย 45 นาที (เหลืออีกประมาณ ${Math.ceil(wait / 60)} นาที)`, tooEarly: true },
        { status: 425 }
      );
    }
    const timeSec = Math.min(TGAT_EXAM_SECONDS, Math.max(0, elapsedSec));

    // ── ตรวจคะแนนจากเฉลยใน session ──
    const result = scoreTgatFromKey(sess.answerKey, answers);
    const inSeason = !isTgatSeasonOver();

    // mark graded ก่อน เพื่อกันยิงซ้ำ
    await sessRef.update({ graded: true, gradedAt: FieldValue.serverTimestamp() });

    const id = sess.email;
    const name = sess.name || "";

    // ── อัปเดตโปรไฟล์: เฉพาะฟิลด์ TGAT (merge → ไม่กระทบ NETSAT/vocab) ──
    const stuRef = db.collection("students").doc(id);
    const stuSnap = await stuRef.get();
    const cur = (stuSnap.exists ? stuSnap.data() : {}) as {
      name?: string;
      tgatSeasonId?: string;
      tgatBestScore?: number;
      tgatBestTimeSec?: number;
      tgatAttempts?: number;
      tgatLastDate?: string;
      tgatTodayCount?: number;
    };

    const today = ymd(new Date());
    const tgatTodayCount = cur.tgatLastDate === today ? (cur.tgatTodayCount ?? 0) + 1 : 1;

    // คะแนนชิงรางวัล = ครั้งที่ดีที่สุด (score สูงสุด; เสมอกันเวลาน้อยกว่า) — เฉพาะช่วงแข่ง
    const sameSeason = cur.tgatSeasonId === TGAT_SEASON_ID;
    const prevBest = sameSeason ? (cur.tgatBestScore ?? -1) : -1;
    const prevBestTime = sameSeason ? (cur.tgatBestTimeSec ?? 0) : 0;
    let tgatBestScore = prevBest < 0 ? 0 : prevBest;
    let tgatBestTimeSec = prevBestTime;
    if (inSeason) {
      const isBetter =
        prevBest < 0 ||
        result.score > prevBest ||
        (result.score === prevBest && (prevBestTime <= 0 || timeSec < prevBestTime));
      if (isBetter) {
        tgatBestScore = result.score;
        tgatBestTimeSec = timeSec;
      }
    }

    // 1) เก็บผลลง mockResults (seasonId = TGAT) — กระดานคะแนน TGAT อ่านจากตรงนี้
    await db.collection("mockResults").add({
      email: id,
      name: name || cur.name || "",
      exam: "TGAT1",
      percent: result.score, // ใช้ field percent เก็บคะแนน /100 เพื่อให้ตรรกะกระดานคะแนนเหมือนกัน
      score: result.score,
      speakingScore: result.speakingScore,
      readingScore: result.readingScore,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      bySection: result.bySection,
      timeSec,
      tabSwitches,
      awaySec,
      seasonId: TGAT_SEASON_ID,
      sessionId,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 2) อัปเดตโปรไฟล์ (เฉพาะ TGAT)
    await stuRef.set(
      {
        email: id,
        name: name || cur.name || "",
        tgatSeasonId: TGAT_SEASON_ID,
        tgatBestScore,
        tgatBestTimeSec,
        tgatAttempts: (cur.tgatAttempts ?? 0) + 1,
        tgatLastScore: result.score,
        tgatLastDate: today,
        tgatTodayCount,
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
        score: result.score,
        percent: result.percent,
        speakingScore: result.speakingScore,
        speakingCorrect: result.speakingCorrect,
        speakingTotal: result.speakingTotal,
        readingScore: result.readingScore,
        readingCorrect: result.readingCorrect,
        readingTotal: result.readingTotal,
        correctCount: result.correctCount,
        totalQuestions: result.totalQuestions,
        bySection: result.bySection,
        timeSec,
      },
      review,
      scoreGained: result.score,
    });
  } catch (e) {
    console.error("tgat/grade error:", e);
    return NextResponse.json({ error: "ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
