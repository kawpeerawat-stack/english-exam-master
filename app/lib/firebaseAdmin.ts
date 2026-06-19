// app/lib/firebaseAdmin.ts
// ─────────────────────────────────────────────────────────────
// ตัวเชื่อม Firebase ฝั่งเซิร์ฟเวอร์ (Admin SDK) — ใช้เฉพาะใน API routes เท่านั้น
// ห้าม import ไฟล์นี้ในโค้ดฝั่งเบราว์เซอร์ (page/component) เด็ดขาด
//
// ต้องตั้ง ENV VAR บน Vercel ชื่อ: FIREBASE_SERVICE_ACCOUNT_KEY
//   = เนื้อหา JSON ของ service account (วางทั้งก้อน) หรือเวอร์ชัน base64 ก็ได้
// ─────────────────────────────────────────────────────────────
import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

function readServiceAccount(): ServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw || !raw.trim()) {
    throw new Error("ยังไม่ได้ตั้งค่า FIREBASE_SERVICE_ACCOUNT_KEY บน Vercel");
  }
  const text = raw.trim().startsWith("{") ? raw.trim() : Buffer.from(raw.trim(), "base64").toString("utf8");
  const parsed = JSON.parse(text) as Record<string, string>;
  // env var มักทำให้ขึ้นบรรทัดใหม่ใน private_key กลายเป็น \n ตัวอักษร — แปลงกลับ
  if (parsed.private_key && parsed.private_key.includes("\\n")) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

let cached: App | undefined;

export function adminApp(): App {
  if (cached) return cached;
  cached = getApps()[0] ?? initializeApp({ credential: cert(readServiceAccount()) });
  return cached;
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
