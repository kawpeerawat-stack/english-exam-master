// app/api/admin/me/route.ts
// GET → { authed: boolean } : ตรวจว่า cookie ที่ส่งมาเป็นของจริงไหม
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, tokenMatches } from "@/app/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authed = tokenMatches(req.cookies.get(ADMIN_COOKIE)?.value);
  return NextResponse.json({ authed });
}
