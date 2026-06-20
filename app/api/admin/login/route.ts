// app/api/admin/login/route.ts
// POST { password } → ตรวจกับ ADMIN_PASSWORD บนเซิร์ฟเวอร์
//   ถูก   → แจก cookie ล็อกอิน (HttpOnly) อายุ 7 วัน
//   ผิด   → 401
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, expectedToken } from "@/app/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AGE = 60 * 60 * 24 * 7; // 7 วัน (วินาที)

export async function POST(req: NextRequest) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้งค่า ADMIN_PASSWORD บน Vercel" },
      { status: 500 }
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  }

  const submitted = (body.password || "").trim();
  if (!submitted || submitted !== pw) {
    return NextResponse.json({ ok: false, error: "รหัสผ่านไม่ถูกต้อง" }, { status: 401 });
  }

  const token = expectedToken();
  if (!token) {
    return NextResponse.json({ ok: false, error: "เซิร์ฟเวอร์ตั้งค่าไม่ครบ" }, { status: 500 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
