// app/api/admin/logout/route.ts
// POST → ล้าง cookie ล็อกอิน (ออกจากระบบ)
import { NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/app/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
