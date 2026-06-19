// app/api/netsat/ping/route.ts
// ─────────────────────────────────────────────────────────────
// จุดทดสอบ: เช็กว่าเซิร์ฟเวอร์ (Vercel) เชื่อม Firebase ด้วย service account ได้จริง
// เปิด: https://english-exam-master.vercel.app/api/netsat/ping
//   สำเร็จ → {"ok":true,...}   |   ยังไม่สำเร็จ → {"ok":false,"error":"..."}
// (ไฟล์นี้ไว้ทดสอบ เดี๋ยวค่อยลบทีหลังได้)
// ─────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { adminDb } from "@/app/lib/firebaseAdmin";

// Admin SDK ต้องรันบน Node runtime (ไม่ใช่ Edge)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = adminDb();
    // อ่านแบบเบาที่สุด เพื่อยืนยันว่าเชื่อม Firestore ได้
    const snap = await db.collection("students").limit(1).get();
    return NextResponse.json({
      ok: true,
      message: "เซิร์ฟเวอร์เชื่อม Firebase สำเร็จ พร้อมทำ Layer B ต่อได้เลย",
      canReadFirestore: true,
      sampleDocsFound: snap.size,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "ตรวจว่าตั้ง ENV ชื่อ FIREBASE_SERVICE_ACCOUNT_KEY บน Vercel และ redeploy แล้ว",
      },
      { status: 500 }
    );
  }
}
