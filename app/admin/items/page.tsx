"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadHiddenItemIds, setItemHidden } from "../../lib/cloud";
import { type BankWritingItem } from "../../lib/netsat";

const LETTERS = ["A", "B", "C", "D", "E"];
const PAGE_SIZE = 25;

type Row = BankWritingItem & { section: "Error" | "SC" };

export default function AdminItemsPage() {
  // null = ตรวจสถานะ, false = ยังไม่ล็อกอิน, true = ล็อกอินแล้ว
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");

  const [q, setQ] = useState("");
  const [sec, setSec] = useState<"ALL" | "Error" | "SC">("ALL");
  const [onlyHidden, setOnlyHidden] = useState(false);
  const [page, setPage] = useState(0);

  // ตรวจ cookie ล็อกอินครู (จุดล็อกอินจริงอยู่ที่ /admin)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/me");
        const j = await r.json();
        setAuthed(!!j.authed);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (authed !== true) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // ดึงคลัง "ฉบับมีเฉลย" จากเซิร์ฟเวอร์ (ปลดล็อกด้วย cookie ครู)
        const [bankRes, h] = await Promise.all([fetch("/api/admin/bank"), loadHiddenItemIds()]);
        const bank = (await bankRes.json()) as {
          writingError?: BankWritingItem[];
          writingSC?: BankWritingItem[];
        };
        if (!alive) return;
        const rows: Row[] = [
          ...(bank.writingError ?? []).map((x) => ({ ...x, section: "Error" as const })),
          ...(bank.writingSC ?? []).map((x) => ({ ...x, section: "SC" as const })),
        ];
        setItems(rows);
        setHidden(new Set(h));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authed]);

  useEffect(() => {
    setPage(0);
  }, [q, sec, onlyHidden]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      if (sec !== "ALL" && it.section !== sec) return false;
      if (onlyHidden && !hidden.has(it.id)) return false;
      if (qq && !it.stem.toLowerCase().includes(qq) && !it.id.toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [items, q, sec, onlyHidden, hidden]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function toggle(it: Row) {
    const willHide = !hidden.has(it.id);
    setBusy(it.id);
    const ok = await setItemHidden(it.id, willHide);
    if (ok) {
      setHidden((prev) => {
        const n = new Set(prev);
        if (willHide) n.add(it.id);
        else n.delete(it.id);
        return n;
      });
    } else {
      alert("บันทึกไม่สำเร็จ — ตรวจว่า Firestore Rules อนุญาตเขียน collection 'config' แล้ว");
    }
    setBusy("");
  }

  if (authed === null) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <p className="text-gray-400">กำลังตรวจสอบ…</p>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-16 bg-[#f4f6fb]">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-3">🛡️</div>
          <p className="font-black text-lg text-[#003399]">ต้องเข้าสู่ระบบโหมดครูก่อน</p>
          <p className="text-sm text-gray-500 mt-2">เข้าสู่ระบบที่หน้าโหมดครู แล้วกลับมาหน้านี้ได้เลย</p>
          <Link
            href="/admin"
            className="mt-4 inline-block rounded-lg bg-[#003399] text-white px-4 py-2 font-black hover:brightness-110 transition"
          >
            ไปหน้าเข้าสู่ระบบครู →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-[#f4f6fb]">
      <header className="bg-[#003399] text-white">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📝</span>
            <span className="text-lg sm:text-xl font-black">ตรวจ / ซ่อนข้อสอบ</span>
          </div>
          <Link href="/admin" className="text-sm text-white/80 underline hover:text-white">
            ← โหมดครู
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600 mb-3">
          ข้อที่กด <b>ซ่อน</b> จะไม่ถูกสุ่มเข้าชุดสอบของนักเรียนอีก (ของในคลังไม่ถูกลบ — เปิดคืนได้ทุกเมื่อ) ·
          ซ่อนอยู่ตอนนี้ <b className="text-red-600">{hidden.size}</b> ข้อ
        </p>

        {/* ตัวกรอง */}
        <div className="rounded-2xl bg-white border-2 border-gray-200 p-4 mb-4 flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาจากเนื้อโจทย์ หรือรหัสข้อ…"
            className="flex-1 min-w-[200px] rounded-xl border-2 border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#003399]"
          />
          <select
            value={sec}
            onChange={(e) => setSec(e.target.value as "ALL" | "Error" | "SC")}
            className="rounded-xl border-2 border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-[#003399]"
          >
            <option value="ALL">ทุกพาร์ต</option>
            <option value="Error">Error Identification</option>
            <option value="SC">Sentence Completion</option>
          </select>
          <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer">
            <input type="checkbox" checked={onlyHidden} onChange={(e) => setOnlyHidden(e.target.checked)} />
            เฉพาะที่ซ่อน
          </label>
        </div>

        <p className="text-xs text-gray-400 mb-3">
          {loading ? "กำลังโหลดคลังข้อ…" : `พบ ${filtered.length} ข้อ · หน้า ${page + 1}/${pages}`}
        </p>

        {/* รายการข้อ */}
        <div className="space-y-3">
          {pageItems.map((it) => {
            const isHidden = hidden.has(it.id);
            return (
              <div
                key={it.id}
                className={`rounded-xl border-2 p-4 ${isHidden ? "border-red-300 bg-red-50/40" : "border-gray-200 bg-white"}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px] font-bold">
                  <span className="rounded-full bg-[#003399]/10 text-[#003399] px-2 py-0.5">
                    {it.section === "Error" ? "Error ID" : "Sentence Completion"}
                  </span>
                  <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5">{it.exam_type}</span>
                  <span className="text-gray-300">{it.id}</span>
                  {isHidden && (
                    <span className="rounded-full bg-red-600 text-white px-2 py-0.5">🚫 ซ่อนอยู่</span>
                  )}
                </div>

                <p className="font-bold text-gray-800 whitespace-pre-line">{it.stem}</p>

                <div className="mt-2 space-y-1">
                  {it.options.map((opt, oi) => {
                    const correct = oi === it.answerIndex;
                    return (
                      <div
                        key={oi}
                        className={`text-sm rounded-lg px-3 py-1.5 border ${
                          correct ? "border-green-500 bg-green-50 text-green-800 font-bold" : "border-gray-200 text-gray-700"
                        }`}
                      >
                        <span className="font-bold mr-1">{LETTERS[oi]}.</span>
                        {opt}
                        {correct && <span className="ml-2 text-xs">✓ เฉลย</span>}
                      </div>
                    );
                  })}
                </div>

                {it.explanation_th && (
                  <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">💡 {it.explanation_th}</p>
                )}

                <div className="mt-3 text-right">
                  <button
                    onClick={() => toggle(it)}
                    disabled={busy === it.id}
                    className={`rounded-lg px-4 py-2 text-sm font-black transition disabled:opacity-50 ${
                      isHidden
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "bg-red-500 text-white hover:bg-red-600"
                    }`}
                  >
                    {busy === it.id ? "กำลังบันทึก…" : isHidden ? "↩ เปิดใช้ข้อนี้" : "🚫 ซ่อนข้อนี้"}
                  </button>
                </div>
              </div>
            );
          })}
          {!loading && pageItems.length === 0 && (
            <p className="text-center text-gray-400 py-8">ไม่พบข้อที่ตรงกับเงื่อนไข</p>
          )}
        </div>

        {/* แบ่งหน้า */}
        {pages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg bg-white border-2 border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              ← ก่อนหน้า
            </button>
            <span className="text-sm font-bold text-gray-600">
              {page + 1} / {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="rounded-lg bg-white border-2 border-gray-200 px-4 py-2 text-sm font-bold disabled:opacity-40"
            >
              ถัดไป →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
