// app/api/tgat/start/route.ts
// ─────────────────────────────────────────────────────────────
// เริ่มทำข้อสอบ TGAT (ฝั่งเซิร์ฟเวอร์):
//   1) เช็กลิมิตจำนวนครั้ง/วัน (นับแยกจาก NETSAT — ฟิลด์ tgatTodayCount)
//   2) ประกอบชุดจากคลังฉบับเต็ม (มีเฉลย) ฝั่งเซิร์ฟเวอร์เท่านั้น
//   3) เก็บเฉลย (answerKey) ลง session "tgatSessions" (เด็กอ่านไม่ได้)
//   4) ส่งกลับเฉพาะ "โจทย์ไม่มีเฉลย" + บทสนทนา/บทความ (groups) + เวลาสอบ
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firebaseAdmin";
import { assembleTgat, splitTgat, TGAT_EXAM_SECONDS, type TgatBank } from "@/app/lib/tgat";
import { TGAT_SEASON_ID, TGAT_ATTEMPTS_PER_DAY, isTgatSeasonOver } from "@/app/lib/tgat-season";
import { emailToId, ymd } from "@/app/lib/season";
import bankData from "@/app/lib/tgat-bank-full.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bank = bankData as unknown as TgatBank;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; name?: string };
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อนเริ่มสอบ" }, { status: 400 });
    }

    const db = adminDb();
    const id = emailToId(email);

    // 1) ลิมิตจำนวนครั้ง/วัน (ตัวนับเฉพาะ TGAT)
    const stuRef = db.collection("students").doc(id);
    const stuSnap = await stuRef.get();
    const stu = (stuSnap.exists ? stuSnap.data() : {}) as { tgatLastDate?: string; tgatTodayCount?: number };
    const today = ymd(new Date());
    const doneToday = stu.tgatLastDate === today ? stu.tgatTodayCount ?? 0 : 0;
    if (doneToday >= TGAT_ATTEMPTS_PER_DAY) {
      return NextResponse.json(
        { error: `วันนี้ทำสอบ TGAT ครบ ${TGAT_ATTEMPTS_PER_DAY} ครั้งแล้ว 🎯 พรุ่งนี้ค่อยมาต่อนะครับ` },
        { status: 429 }
      );
    }

    // 2) ข้อที่ครูซ่อน (config แยกของ TGAT — ว่างเป็นค่าเริ่มต้น)
    let hidden = new Set<string>();
    try {
      const cfg = await db.collection("config").doc("tgatHiddenItems").get();
      const ids = (cfg.exists ? (cfg.data() as { ids?: string[] }).ids : []) || [];
      hidden = new Set(ids);
    } catch {
      /* ไม่มี config ก็ไม่เป็นไร */
    }

    // 3) ประกอบชุด + แยกเฉลยเก็บฝั่งเซิร์ฟเวอร์
    const mock = assembleTgat(bank, hidden);
    const split = splitTgat(mock);

    const sessionRef = await db.collection("tgatSessions").add({
      email: id,
      name,
      seasonId: TGAT_SEASON_ID,
      graded: false,
      countsForSeason: !isTgatSeasonOver(),
      answerKey: split.answerKey, // เฉลย — เก็บฝั่งเซิร์ฟเวอร์เท่านั้น
      totalQuestions: split.totalQuestions,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4) ส่งกลับเฉพาะโจทย์ (ไม่มีเฉลย) + บทสนทนา/บทความ
    return NextResponse.json({
      sessionId: sessionRef.id,
      questions: split.publicQuestions,
      groups: split.groups,
      totalQuestions: split.totalQuestions,
      examSeconds: TGAT_EXAM_SECONDS,
    });
  } catch (e) {
    console.error("tgat/start error:", e);
    return NextResponse.json({ error: "เริ่มสอบไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
