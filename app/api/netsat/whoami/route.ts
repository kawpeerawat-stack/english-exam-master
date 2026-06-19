// app/api/netsat/whoami/route.ts
// ─────────────────────────────────────────────────────────────
// หน้าตรวจสอบ (อ่านอย่างเดียว): ดูสถานะ "จำนวนครั้ง/วัน" ของบัญชีหนึ่ง ๆ
// เทียบกับวันที่ของเซิร์ฟเวอร์ — ไว้ยืนยันว่าตัวนับรีเซ็ตข้ามวันถูกต้อง
//
// เปิด: https://english-exam-master.vercel.app/api/netsat/whoami?email=อีเมลของคุณ
// (ไฟล์นี้ไว้ตรวจสอบ/แก้บั๊ก ลบทีหลังได้)
// ─────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/app/lib/firebaseAdmin";
import { SEASON_ID, ATTEMPTS_PER_DAY, emailToId, ymd, currentWeekId } from "@/app/lib/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const email = (req.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "ใส่ ?email=อีเมล ต่อท้าย URL ด้วยครับ" }, { status: 400 });
    }
    const db = adminDb();
    const id = emailToId(email);
    const snap = await db.collection("students").doc(id).get();
    const d = (snap.exists ? snap.data() : {}) as {
      name?: string; lastStudyDate?: string; todayCount?: number;
      netsatAttempts?: number; seasonId?: string; seasonBestPercent?: number;
    };

    const serverToday = ymd(new Date());
    const doneToday = d.lastStudyDate === serverToday ? d.todayCount ?? 0 : 0;

    return NextResponse.json({
      email: id,
      found: snap.exists,
      name: d.name ?? null,
      // ── สถานะตัวนับรายวัน ──
      stored_lastStudyDate: d.lastStudyDate ?? null,
      stored_todayCount: d.todayCount ?? 0,
      cumulative_netsatAttempts: d.netsatAttempts ?? 0,
      // ── วันที่ฝั่งเซิร์ฟเวอร์ (เวลาไทย) ──
      serverNow_ISO: new Date().toISOString(),
      serverToday_Thai: serverToday,
      serverWeekId: currentWeekId(new Date()),
      // ── ผลการคำนวณที่ระบบใช้จริง ──
      doneToday_computed: doneToday,
      attemptsPerDay: ATTEMPTS_PER_DAY,
      capReached: doneToday >= ATTEMPTS_PER_DAY,
      canStartNow: doneToday < ATTEMPTS_PER_DAY,
      seasonMatches: d.seasonId === SEASON_ID,
      seasonBestPercent: d.seasonBestPercent ?? 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
