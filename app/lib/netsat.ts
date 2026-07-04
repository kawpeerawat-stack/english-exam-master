// app/lib/netsat.ts
// ─────────────────────────────────────────────────────────────
// เครื่องประกอบ "ชุดสอบจำลอง NETSAT" จากคลังข้อฉบับเต็ม (app/lib/netsat-bank-full.json) ฝั่งเซิร์ฟเวอร์
//   - สุ่มข้อทุกครั้งตาม blueprint: Error 10 + Sentence Completion 10 + Reading 20 (รวม 40 ข้อ)
//   - Writing: สลับตำแหน่งตัวเลือกทุกครั้ง (กันลอก) — เฉลยตามไปด้วย
//   - Reading: ไม่สลับตัวเลือก (คำเฉลยไทยอ้าง "ตอบข้อ X") แต่สุ่มว่าได้บท/ข้อไหน
//   - ให้คะแนนถ่วงน้ำหนัก (2/3/4) ตามที่ฝังในคลังข้อ
// ─────────────────────────────────────────────────────────────

export type Section = "WRITING_ERROR" | "WRITING_SC" | "READING_SHORT" | "READING_LONG";
export type NetsatLevel = "B1-B2" | "B2-C1";

export const SECTION_LABEL: Record<Section, string> = {
  WRITING_ERROR: "Part 1 — Error Identification (หาจุดผิด)",
  WRITING_SC: "Part 2 — Sentence Completion (เติมประโยค)",
  READING_SHORT: "Part 3 — Reading: Instructions / Correspondence",
  READING_LONG: "Part 4 — Reading: Information & Argument",
};

// ── โครงข้อมูลในคลัง ──
export interface BankWritingItem {
  id: string;
  exam_type: string;
  topic: string;
  stem: string;
  options: string[];
  answerIndex: number;
  points: number;
  explanation_th: string;
  verified: boolean;
  level?: NetsatLevel;
}
export interface BankReadingQuestion {
  id: string;
  qtype: string;
  stem: string;
  options: string[];
  answerIndex: number;
  points: number;
  explanation_th: string;
}
export interface BankReadingPassage {
  id: string;
  title: string;
  genre: string;
  category: string;
  wordCount: number;
  level: string;
  tier?: NetsatLevel;
  targetVocab: string[];
  verified: boolean;
  passage: string;
  questions: BankReadingQuestion[];
}
export interface NetsatBank {
  exam: string;
  examLabel: string;
  writingError: BankWritingItem[];
  writingSC: BankWritingItem[];
  readingShort: BankReadingPassage[];
  readingLong: BankReadingPassage[];
}

// ── ข้อในชุดที่ประกอบแล้ว ──
export interface MockQuestion {
  uid: string;
  section: Section;
  passageId?: string;
  stem: string;
  options: string[];
  correctIndex: number;
  points: number;
  explanation_th: string;
}
export interface MockPassage {
  id: string;
  title: string;
  passage: string;
  wordCount: number;
}
export interface AssembledMock {
  questions: MockQuestion[];
  passages: Record<string, MockPassage>;
  totalPoints: number;
  totalQuestions: number;
}

// ── เวลาสอบ (วินาที) ──
export const EXAM_SECONDS = 50 * 60;
// ต้องทำอย่างน้อย 40 นาทีก่อนจึงกด "ส่ง" ได้ (กันการรัวมั่วแล้วรีบส่งเพื่อฟาร์มหลายรอบ)
export const MIN_SUBMIT_SECONDS = 40 * 60;
const TARGET_READING = 20;

// ── โหลดคลังข้อ (ฉบับไม่มีเฉลย — ใช้ฝั่งเบราว์เซอร์ เช่นหน้า /admin/items) ──
// หมายเหตุ: ฉบับนี้ไม่มี answerIndex/explanation_th แล้ว (เฉลยอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น)
export async function loadBank(): Promise<NetsatBank> {
  const res = await fetch("/netsat-bank-public.json", { cache: "force-cache" });
  if (!res.ok) throw new Error("โหลดคลังข้อไม่สำเร็จ");
  return (await res.json()) as NetsatBank;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sample<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

// สลับตำแหน่งตัวเลือก + คืน index ของคำตอบที่ถูกหลังสลับ
function shuffleOptions(options: string[], correctIndex: number): { options: string[]; correctIndex: number } {
  const order = shuffle(options.map((_, i) => i));
  return {
    options: order.map((i) => options[i]),
    correctIndex: order.indexOf(correctIndex),
  };
}

// เลือกข้อ Writing: กรองตามระดับที่เลือกก่อน (ถ้ามี) → เอาแนว NETSAT ทั้งหมด → เติมจากที่เหลือถ้ายังไม่พอ
function pickWriting(pool: BankWritingItem[], n: number, level?: NetsatLevel): BankWritingItem[] {
  const netsat = pool.filter((x) => x.exam_type === "NETSAT");
  const others = pool.filter((x) => x.exam_type !== "NETSAT");
  const primary = level ? netsat.filter((x) => x.level === level) : netsat;
  const chosen = sample(primary, Math.min(n, primary.length));
  if (chosen.length < n) {
    const chosenIds = new Set(chosen.map((x) => x.id));
    const fallback1 = netsat.filter((x) => !chosenIds.has(x.id));
    chosen.push(...sample(fallback1, Math.min(n - chosen.length, fallback1.length)));
  }
  if (chosen.length < n) {
    const chosenIds = new Set(chosen.map((x) => x.id));
    const fallback2 = others.filter((x) => !chosenIds.has(x.id));
    chosen.push(...sample(fallback2, n - chosen.length));
  }
  return shuffle(chosen);
}

export function assembleMock(bank: NetsatBank, hiddenIds: Set<string> = new Set(), level?: NetsatLevel): AssembledMock {
  const questions: MockQuestion[] = [];
  const passages: Record<string, MockPassage> = {};
  let uid = 0;
  const nextUid = () => `q${uid++}`;

  // Writing — Error 10 + SC 10 (สลับตัวเลือก) — ตัดข้อที่ครูซ่อนออกก่อน
  const writing: { items: BankWritingItem[]; section: Section }[] = [
    { items: pickWriting(bank.writingError.filter((x) => !hiddenIds.has(x.id)), 10, level), section: "WRITING_ERROR" },
    { items: pickWriting(bank.writingSC.filter((x) => !hiddenIds.has(x.id)), 10, level), section: "WRITING_SC" },
  ];
  for (const grp of writing) {
    for (const it of grp.items) {
      // Error Identification: คงลำดับเดิม เพื่อให้เลขกำกับ (1)(2)(3)(4) ตรงตำแหน่งในประโยค
      // Sentence Completion: สลับตัวเลือก (กันลอกคำตอบ)
      const s =
        grp.section === "WRITING_SC"
          ? shuffleOptions(it.options, it.answerIndex)
          : { options: it.options, correctIndex: it.answerIndex };
      questions.push({
        uid: nextUid(),
        section: grp.section,
        stem: it.stem,
        options: s.options,
        correctIndex: s.correctIndex,
        points: it.points,
        explanation_th: it.explanation_th,
      });
    }
  }

  // Reading — รวม 20 ข้อ (1 บทสั้น + บทยาวเติมจนครบ), ไม่สลับตัวเลือก
  let readingCount = 0;
  const addPassage = (p: BankReadingPassage, section: Section, max: number) => {
    if (readingCount >= TARGET_READING) return;
    const qs = p.questions.filter((q) => !hiddenIds.has(q.id));
    const take = Math.min(max, qs.length, TARGET_READING - readingCount);
    if (take <= 0) return;
    passages[p.id] = { id: p.id, title: p.title, passage: p.passage, wordCount: p.wordCount };
    for (const q of qs.slice(0, take)) {
      questions.push({
        uid: nextUid(),
        section,
        passageId: p.id,
        stem: q.stem,
        options: q.options,
        correctIndex: q.answerIndex,
        points: q.points,
        explanation_th: q.explanation_th,
      });
      readingCount++;
    }
  };

  // กรองบทอ่านตามระดับที่เลือก (ถ้ามี) — ถ้ากรองแล้วว่างเปล่า (ไม่ควรเกิด) ใช้คลังทั้งหมดแทน
  const shortPool = level ? bank.readingShort.filter((p) => p.tier === level) : bank.readingShort;
  const longPool = level ? bank.readingLong.filter((p) => p.tier === level) : bank.readingLong;
  const shortP = sample(shortPool.length ? shortPool : bank.readingShort, 1)[0];
  if (shortP) addPassage(shortP, "READING_SHORT", 9);
  for (const p of shuffle(longPool.length ? longPool : bank.readingLong)) {
    if (readingCount >= TARGET_READING) break;
    addPassage(p, "READING_LONG", 11);
  }

  const totalPoints = questions.reduce((s, q) => s + q.points, 0);
  return { questions, passages, totalPoints, totalQuestions: questions.length };
}

// ── ตรวจคะแนน ──
export interface SectionScore {
  correct: number;
  total: number;
  earned: number;
  points: number;
}
export interface MockResult {
  earnedPoints: number;
  totalPoints: number;
  correctCount: number;
  totalQuestions: number;
  percent: number;
  bySection: Partial<Record<Section, SectionScore>>;
}

export function scoreMock(mock: AssembledMock, answers: Record<string, number>): MockResult {
  let earnedPoints = 0;
  let correctCount = 0;
  const bySection: Partial<Record<Section, SectionScore>> = {};

  for (const q of mock.questions) {
    const sec = (bySection[q.section] ??= { correct: 0, total: 0, earned: 0, points: 0 });
    sec.total += 1;
    sec.points += q.points;
    if (answers[q.uid] === q.correctIndex) {
      earnedPoints += q.points;
      correctCount += 1;
      sec.correct += 1;
      sec.earned += q.points;
    }
  }

  return {
    earnedPoints,
    totalPoints: mock.totalPoints,
    correctCount,
    totalQuestions: mock.totalQuestions,
    percent: mock.totalPoints > 0 ? Math.round((earnedPoints / mock.totalPoints) * 100) : 0,
    bySection,
  };
}

// mm:ss
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────
// สำหรับ Layer B (ตรวจฝั่งเซิร์ฟเวอร์):
//   - ฝั่งเด็กได้รับเฉพาะ "โจทย์" (ไม่มีเฉลย)
//   - เฉลยเก็บเป็น answerKey ไว้ฝั่งเซิร์ฟเวอร์ (ใน session) แล้วใช้ตรวจตอนส่ง
// ─────────────────────────────────────────────────────────────

// ข้อสอบฉบับ "ไม่มีเฉลย" ที่ส่งให้ฝั่งเด็ก
export interface PublicQuestion {
  uid: string;
  section: Section;
  passageId?: string;
  stem: string;
  options: string[];
  points: number;
}

export interface AnswerKeyEntry {
  correctIndex: number;
  points: number;
  section: Section;
  explanation_th: string;
}

export interface AssembledForServer {
  publicQuestions: PublicQuestion[];
  answerKey: Record<string, AnswerKeyEntry>;
  passages: Record<string, MockPassage>;
  totalPoints: number;
  totalQuestions: number;
}

// แยกชุดที่ประกอบแล้วเป็น (โจทย์ไม่มีเฉลย) + (เฉลยเก็บฝั่งเซิร์ฟเวอร์)
export function splitAssembled(mock: AssembledMock): AssembledForServer {
  const publicQuestions: PublicQuestion[] = [];
  const answerKey: Record<string, AnswerKeyEntry> = {};
  for (const q of mock.questions) {
    publicQuestions.push({
      uid: q.uid,
      section: q.section,
      passageId: q.passageId,
      stem: q.stem,
      options: q.options,
      points: q.points,
    });
    answerKey[q.uid] = {
      correctIndex: q.correctIndex,
      points: q.points,
      section: q.section,
      explanation_th: q.explanation_th,
    };
  }
  return {
    publicQuestions,
    answerKey,
    passages: mock.passages,
    totalPoints: mock.totalPoints,
    totalQuestions: mock.totalQuestions,
  };
}

// ตรวจคะแนนจาก answerKey (ฝั่งเซิร์ฟเวอร์)
export function scoreFromKey(
  answerKey: Record<string, AnswerKeyEntry>,
  answers: Record<string, number>
): MockResult {
  let earnedPoints = 0;
  let correctCount = 0;
  let totalPoints = 0;
  let totalQuestions = 0;
  const bySection: Partial<Record<Section, SectionScore>> = {};
  for (const uid of Object.keys(answerKey)) {
    const k = answerKey[uid];
    totalQuestions += 1;
    totalPoints += k.points;
    const sec = (bySection[k.section] ??= { correct: 0, total: 0, earned: 0, points: 0 });
    sec.total += 1;
    sec.points += k.points;
    if (answers[uid] === k.correctIndex) {
      earnedPoints += k.points;
      correctCount += 1;
      sec.correct += 1;
      sec.earned += k.points;
    }
  }
  return {
    earnedPoints,
    totalPoints,
    correctCount,
    totalQuestions,
    percent: totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0,
    bySection,
  };
}
