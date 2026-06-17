import Link from "next/link";

export default function NetsatPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
      <div className="w-full max-w-lg text-center rounded-3xl bg-white border-2 border-[#FFD700] shadow-lg p-8">
        <div className="text-4xl mb-3">📖 📊</div>
        <h1 className="text-2xl font-black text-[#003399]">NETSAT — สอบจำลองภาษาอังกฤษ (มข.)</h1>
        <p className="text-gray-600 mt-2">40 ข้อ / 90 นาที · Reading + Writing/Structure</p>
        <div className="mt-6 rounded-xl bg-[#003399]/5 p-4 text-sm text-gray-600">
          คลังข้อพร้อมแล้ว ✅ — หน้าจอทำข้อสอบจับเวลากำลังจะมาในขั้นต่อไป
        </div>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-[#003399] text-white font-black px-6 py-2.5 hover:bg-[#002266] transition"
        >
          ← กลับหน้าหลัก
        </Link>
      </div>
    </main>
  );
}
