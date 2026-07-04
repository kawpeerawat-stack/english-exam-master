// app/api/netsat/start/route.ts
// ─────────────────────────────────────────────────────────────
// เริ่มทำข้อสอบ (ฝั่งเซิร์ฟเวอร์):
//   1) เช็กลิมิตจำนวนครั้ง/วัน
//   2) ประกอบชุดข้อสอบจากคลัง "ฉบับเต็ม" (มีเฉลย) ที่อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
//   3) เก็บเฉลย (answerKey) ลง session ใน Firestore (เด็กอ่านไม่ได้)
//   4) ส่งกลับเฉพาะ "โจทย์ไม่มีเฉลย" + เวลาสอบ
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firebaseAdmin";
import { assembleMock, splitAssembled, EXAM_SECONDS, type NetsatBank, type NetsatLevel } from "@/app/lib/netsat";
import { SEASON_ID, ATTEMPTS_PER_DAY, emailToId, ymd, isSeasonOver } from "@/app/lib/season";
import bankData from "@/app/lib/netsat-bank-full.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bank = bankData as unknown as NetsatBank;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; name?: string; level?: string };
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อนเริ่มสอบ" }, { status: 400 });
    }
    const level: NetsatLevel | undefined =
      body.level === "B1-B2" || body.level === "B2-C1" ? body.level : undefined;
    if (!level) {
      return NextResponse.json({ error: "กรุณาเลือกระดับความยากก่อนเริ่มสอบ" }, { status: 400 });
    }

    const db = adminDb();
    const id = emailToId(email);

    // 1) ลิมิตจำนวนครั้ง/วัน — นับแยกต่อระดับ (B1-B2 และ B2-C1 คนละโควตา คนละ ATTEMPTS_PER_DAY ครั้ง)
    const stuRef = db.collection("students").doc(id);
    const stuSnap = await stuRef.get();
    const stu = (stuSnap.exists ? stuSnap.data() : {}) as {
      netsatB1B2Date?: string; netsatB1B2Count?: number;
      netsatB2C1Date?: string; netsatB2C1Count?: number;
    };
    const today = ymd(new Date());
    const dateField = level === "B1-B2" ? "netsatB1B2Date" : "netsatB2C1Date";
    const countField = level === "B1-B2" ? "netsatB1B2Count" : "netsatB2C1Count";
    const doneToday = stu[dateField] === today ? stu[countField] ?? 0 : 0;
    if (doneToday >= ATTEMPTS_PER_DAY) {
      return NextResponse.json(
        { error: `วันนี้ทำสอบระดับ ${level} ครบ ${ATTEMPTS_PER_DAY} ครั้งแล้ว 🎯 พรุ่งนี้ค่อยมาต่อ หรือลองอีกระดับได้ครับ` },
        { status: 429 }
      );
    }

    // 2) ข้อที่ครูซ่อน
    let hidden = new Set<string>();
    try {
      const cfg = await db.collection("config").doc("hiddenItems").get();
      const ids = (cfg.exists ? (cfg.data() as { ids?: string[] }).ids : []) || [];
      hidden = new Set(ids);
    } catch {
      /* ไม่มี config ก็ไม่เป็นไร */
    }

    // 3) ประกอบชุด + แยกเฉลยเก็บฝั่งเซิร์ฟเวอร์
    const mock = assembleMock(bank, hidden, level);
    const split = splitAssembled(mock);

    const sessionRef = await db.collection("mockSessions").add({
      email: id,
      name,
      level,
      seasonId: SEASON_ID,
      graded: false,
      countsForSeason: !isSeasonOver(),
      answerKey: split.answerKey, // เฉลย — เก็บฝั่งเซิร์ฟเวอร์เท่านั้น
      totalPoints: split.totalPoints,
      totalQuestions: split.totalQuestions,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4) ส่งกลับเฉพาะโจทย์ (ไม่มีเฉลย)
    return NextResponse.json({
      sessionId: sessionRef.id,
      questions: split.publicQuestions,
      passages: split.passages,
      totalQuestions: split.totalQuestions,
      examSeconds: EXAM_SECONDS,
    });
  } catch (e) {
    console.error("netsat/start error:", e);
    return NextResponse.json({ error: "เริ่มสอบไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
