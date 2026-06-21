// app/api/tgat/start/route.ts  — 🐞 DEBUG VERSION (ชั่วคราว เพื่อหา error จริง)
// ต่างจากตัวจริงแค่บรรทัด catch ท้ายสุด: จะส่งข้อความ error จริงกลับมาโชว์บนหน้าจอ
// เมื่อแก้ปัญหาเสร็จ ผมจะส่งตัวสะอาด (ไม่โชว์ error) กลับให้ทับอีกที
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
  // ป้ายบอกว่าพังตรงขั้นไหน
  let step = "init";
  try {
    step = "parse-body";
    const body = (await req.json()) as { email?: string; name?: string };
    const email = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "กรุณาเข้าสู่ระบบก่อนเริ่มสอบ" }, { status: 400 });
    }

    step = "adminDb()";
    const db = adminDb();
    const id = emailToId(email);

    step = "read-students";
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

    step = "read-config";
    let hidden = new Set<string>();
    try {
      const cfg = await db.collection("config").doc("tgatHiddenItems").get();
      const ids = (cfg.exists ? (cfg.data() as { ids?: string[] }).ids : []) || [];
      hidden = new Set(ids);
    } catch {
      /* ไม่มี config ก็ไม่เป็นไร */
    }

    step = "assemble";
    const mock = assembleTgat(bank, hidden);
    const split = splitTgat(mock);

    step = "write-session";
    const sessionRef = await db.collection("tgatSessions").add({
      email: id,
      name,
      seasonId: TGAT_SEASON_ID,
      graded: false,
      countsForSeason: !isTgatSeasonOver(),
      answerKey: split.answerKey,
      totalQuestions: split.totalQuestions,
      createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      sessionId: sessionRef.id,
      questions: split.publicQuestions,
      groups: split.groups,
      totalQuestions: split.totalQuestions,
      examSeconds: TGAT_EXAM_SECONDS,
    });
  } catch (e) {
    console.error("tgat/start error:", e);
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // 🐞 DEBUG: โชว์ขั้นที่พัง + ข้อความ error จริง
    return NextResponse.json({ error: `🐞 [${step}] ${msg}` }, { status: 500 });
  }
}
