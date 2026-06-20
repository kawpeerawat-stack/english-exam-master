// app/api/admin/bank/route.ts
// GET (ต้องล็อกอินครูเท่านั้น) → คลังข้อสอบ "ฉบับเต็มมีเฉลย" เฉพาะส่วน writing
//   ใช้โดยหน้า /admin/items เพื่อโชว์เฉลย + คำอธิบาย
//   เฉลยไม่เคยถูกส่งให้ผู้ที่ไม่มี cookie ล็อกอิน
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, tokenMatches } from "@/app/lib/adminAuth";
import bankData from "@/app/lib/netsat-bank-full.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!tokenMatches(req.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bank = bankData as unknown as {
    writingError?: unknown[];
    writingSC?: unknown[];
  };

  return NextResponse.json({
    ok: true,
    writingError: bank.writingError ?? [],
    writingSC: bank.writingSC ?? [],
  });
}
