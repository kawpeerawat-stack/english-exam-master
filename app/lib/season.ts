// app/lib/season.ts
// ─────────────────────────────────────────────────────────────
// ค่าคงที่ + ตัวช่วยวันที่ ที่ "ไม่พึ่ง Firebase" → ใช้ได้ทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์
// (cloud.ts ฝั่งเบราว์เซอร์ และ API routes ฝั่งเซิร์ฟเวอร์ import จากที่นี่ที่เดียว)
//
// ⭐ จุดรีเซ็ตซีซั่น: เปลี่ยน SEASON_ID ที่ "ไฟล์นี้ที่เดียว" → ทุกคนกลับเป็น 0 อัตโนมัติ
// ─────────────────────────────────────────────────────────────

export const SEASON_ID = "netsat-2026";
export const SEASON_END = new Date("2026-08-10T23:59:59+07:00");
export function isSeasonOver(now: Date = new Date()): boolean {
  return now.getTime() > SEASON_END.getTime();
}

// จำนวนครั้งที่ทำสอบได้ต่อวัน (กันการฟาร์มแต้ม)
export const ATTEMPTS_PER_DAY = 3;

export function emailToId(email: string): string {
  return email.trim().toLowerCase().replace(/\//g, "_");
}

// ── วัน/สัปดาห์ อิงเวลาไทย (UTC+7) เสมอ — ให้ผลตรงกันไม่ว่าจะรันบนเครื่องเด็ก (ไทย) หรือเซิร์ฟเวอร์ (UTC) ──
function thaiWallClock(d: Date): Date {
  // เลื่อนเวลาสัมบูรณ์ +7 ชม. แล้วค่อยอ่านด้วย getUTC* → ได้ "เวลานาฬิกาไทย" โดยไม่ขึ้นกับ timezone ของเครื่อง
  return new Date(d.getTime() + 7 * 3600 * 1000);
}

export function ymd(d: Date = new Date()): string {
  const t = thaiWallClock(d);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function currentWeekId(d: Date = new Date()): string {
  const t = thaiWallClock(d);
  const day = (t.getUTCDay() + 6) % 7; // จันทร์ = 0
  const monday = new Date(t.getTime() - day * 86400000);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z");
  const dbb = new Date(b + "T00:00:00Z");
  return Math.round((dbb.getTime() - da.getTime()) / 86400000);
}
