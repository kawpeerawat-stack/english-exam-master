// app/lib/adminAuth.ts
// ─────────────────────────────────────────────────────────────
// ตัวช่วยตรวจสิทธิ์ "โหมดครู" (ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น)
//
// หลักการ:
//   - รหัสผ่านจริงเก็บใน Vercel env: ADMIN_PASSWORD (เด็กดูโค้ดไม่เห็น)
//   - เมื่อล็อกอินถูก → แจก cookie ที่เป็น "ลายเซ็น (HMAC)" ของข้อความคงที่
//     โดยใช้รหัสผ่านเป็นกุญแจ → ใครไม่รู้รหัสก็ปลอม cookie ไม่ได้
//   - cookie เป็น HttpOnly → JavaScript ฝั่งเบราว์เซอร์อ่าน/ก๊อปไม่ได้
//   - ถ้าเปลี่ยน ADMIN_PASSWORD → cookie เก่าใช้ไม่ได้ทันที (ลายเซ็นเปลี่ยน)
// ─────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE = "admin_session";
const SESSION_MESSAGE = "eem-admin-session-v1";

// ลายเซ็นที่ "ถูกต้อง" สำหรับรหัสผ่านปัจจุบัน (null = ยังไม่ได้ตั้ง ADMIN_PASSWORD)
export function expectedToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  return createHmac("sha256", pw).update(SESSION_MESSAGE).digest("hex");
}

// เทียบค่า cookie ที่ส่งมา กับลายเซ็นที่ถูกต้อง (เทียบแบบ constant-time)
export function tokenMatches(cookieValue: string | undefined | null): boolean {
  const expected = expectedToken();
  if (!expected || !cookieValue) return false;
  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
