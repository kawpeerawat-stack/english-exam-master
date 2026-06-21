// app/lib/tgat-season.ts
// ─────────────────────────────────────────────────────────────
// ค่าคงที่การแข่งขัน TGAT — "แยกจาก NETSAT" (คนละซีซั่น คนละกระดานคะแนน)
// ใช้ตัวช่วยวันที่ (emailToId/ymd/daysBetween) ร่วมจาก season.ts → ไม่ต้องแก้ season.ts
//
// ⭐ รีเซ็ตซีซั่น TGAT: เปลี่ยน TGAT_SEASON_ID ที่นี่ → ทุกคนกลับเป็น 0
// ─────────────────────────────────────────────────────────────

export const TGAT_SEASON_ID = "tgat-2026";

// ── ช่วงแข่งขันจริง (นับอันดับเฉพาะในช่วงนี้) ──────────────────────
// เริ่ม: จันทร์ที่ 17 สิงหาคม 2569 · สิ้นสุด: ศุกร์ที่ 25 กันยายน 2569
export const TGAT_SEASON_START = new Date("2026-08-17T00:00:00+07:00");
export const TGAT_SEASON_END = new Date("2026-09-25T23:59:59+07:00");

// เริ่มแข่งแล้วหรือยัง (ก่อนวันเริ่ม = ซ้อมได้ แต่ยังไม่นับอันดับ)
export function isTgatSeasonStarted(now: Date = new Date()): boolean {
  return now.getTime() >= TGAT_SEASON_START.getTime();
}
// ปิดรอบแล้วหรือยัง
export function isTgatSeasonOver(now: Date = new Date()): boolean {
  return now.getTime() > TGAT_SEASON_END.getTime();
}
// อยู่ในช่วงแข่งจริง (เริ่มแล้ว + ยังไม่ปิด) → ผลถึงจะนับอันดับ
export function isTgatInWindow(now: Date = new Date()): boolean {
  return isTgatSeasonStarted(now) && !isTgatSeasonOver(now);
}

// จำนวนครั้งที่ทำสอบ TGAT ได้ต่อวัน (นับแยกจาก NETSAT)
export const TGAT_ATTEMPTS_PER_DAY = 3;
