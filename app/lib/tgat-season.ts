// app/lib/tgat-season.ts
// ─────────────────────────────────────────────────────────────
// ค่าคงที่การแข่งขัน TGAT — "แยกจาก NETSAT" (คนละซีซั่น คนละกระดานคะแนน)
// ใช้ตัวช่วยวันที่ (emailToId/ymd/daysBetween) ร่วมจาก season.ts → ไม่ต้องแก้ season.ts
//
// ⭐ รีเซ็ตซีซั่น TGAT: เปลี่ยน TGAT_SEASON_ID ที่นี่ → ทุกคนกลับเป็น 0
// ─────────────────────────────────────────────────────────────

export const TGAT_SEASON_ID = "tgat-2026";
// วันสิ้นสุดการแข่ง (ปรับได้ — ใส่ค่าชั่วคราวไว้ก่อน รอคุณครูยืนยันวันสอบจริง TGAT)
export const TGAT_SEASON_END = new Date("2026-12-31T23:59:59+07:00");
export function isTgatSeasonOver(now: Date = new Date()): boolean {
  return now.getTime() > TGAT_SEASON_END.getTime();
}

// จำนวนครั้งที่ทำสอบ TGAT ได้ต่อวัน (นับแยกจาก NETSAT)
export const TGAT_ATTEMPTS_PER_DAY = 3;
