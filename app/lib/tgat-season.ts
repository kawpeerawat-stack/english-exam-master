// app/lib/tgat.ts
// ─────────────────────────────────────────────────────────────
// เครื่องประกอบ + ตรวจคะแนน "ชุดสอบจำลอง TGAT1 (การสื่อสารภาษาอังกฤษ)" ฝั่งเซิร์ฟเวอร์
//   Blueprint 60 ข้อ / 60 นาที / 100 คะแนน:
//     Speaking 30 = Question-Response 10 + Short conv 10 (3 บท) + Long conv 10 (2 บท)
//     Reading  30 = Text completion/cloze 15 (2 บท) + Reading comprehension 15 (3 บท)
//   - สุ่มทุกครั้ง + สลับตำแหน่งตัวเลือก (กันลอก) — เฉลยตามไปด้วย
//   - ให้คะแนน Speaking 50 + Reading 50 (ทุกข้อในพาร์ตเท่ากัน)
//   * ระบบคู่ขนานกับ NETSAT — ไม่แตะ netsat.ts
// ─────────────────────────────────────────────────────────────

export type TgatSection =
  | "SPEAKING_QR"
  | "SPEAKING_SHORT_CONV"
  | "SPEAKING_LONG_CONV"
  | "READING_CLOZE"
  | "READING_COMP";

export const TGAT_SECTION_LABEL: Record<TgatSection, string> = {
  SPEAKING_QR: "Part 1.1 — Question–Response (ถาม–ตอบ)",
  SPEAKING_SHORT_CONV: "Part 1.2 — Short Conversations (บทสนทนาสั้น)",
  SPEAKING_LONG_CONV: "Part 1.3 — Long Conversations (บทสนทนายาว)",
  READING_CLOZE: "Part 2.1 — Text Completion (เติมข้อความ)",
  READING_COMP: "Part 2.2 — Reading Comprehension (อ่านจับใจความ)",
};

export type TgatPart = "SPEAKING" | "READING";
export function sectionPart(s: TgatSection): TgatPart {
  return s === "READING_CLOZE" || s === "READING_COMP" ? "READING" : "SPEAKING";
}

// ── โครงข้อมูลในคลัง ──
export interface TgatQuestion {
  id: string;
  stem: string;           // conv/cloze: ป้ายช่อง "(1)"; comp: คำถามจริง
  options: string[];
  answerIndex: number;
  explanation_th: string;
  qtype?: string;         // reading comp: MAIN_IDEA ฯลฯ
  blankNo?: number;       // conv/cloze: หมายเลขช่อง
}
export interface TgatQRItem {
  id: string;
  topic?: string;
  prompt: string;         // บรรทัดที่ต้องตอบ (แสดงเป็นโจทย์)
  options: string[];
  answerIndex: number;
  explanation_th: string;
  verified: boolean;
}
export interface TgatGroup {        // บทสนทนา (conv) หรือบทความ (cloze/comp)
  id: string;
  title: string;
  text: string;           // บทสนทนา/บทความ — มีเครื่องหมายช่องว่าง __(n)__ ถ้าเป็น conv/cloze
  kind: "dialogue" | "cloze" | "reading";
  wordCount?: number;
  verified: boolean;
  questions: TgatQuestion[];
}
export interface TgatBank {
  exam: string;
  examLabel: string;
  speakingQR: TgatQRItem[];
  shortConversations: TgatGroup[];
  longConversations: TgatGroup[];
  clozePassages: TgatGroup[];
  readingPassages: TgatGroup[];
}

// ── ข้อในชุดที่ประกอบแล้ว ──
export interface TgatMockQuestion {
  uid: string;
  section: TgatSection;
  groupId?: string;
  stem: string;
  options: string[];
  correctIndex: number;
  explanation_th: string;
}
export interface TgatMockGroup {
  id: string;
  title: string;
  text: string;
  kind: "dialogue" | "cloze" | "reading";
}
export interface TgatAssembled {
  questions: TgatMockQuestion[];
  groups: Record<string, TgatMockGroup>;
  totalQuestions: number;
}

// ── เวลาสอบ (วินาที) ──
export const TGAT_EXAM_SECONDS = 60 * 60;        // 60 นาที
// ต้องทำอย่างน้อย 45 นาทีก่อนกด "ส่ง" (กันการรัวมั่วแล้วรีบส่งเพื่อฟาร์มหลายรอบ) — ปรับได้
export const TGAT_MIN_SUBMIT_SECONDS = 45 * 60;

// เป้าจำนวนข้อต่อชุด (ตาม blueprint)
const TARGET: Record<TgatSection, number> = {
  SPEAKING_QR: 10,
  SPEAKING_SHORT_CONV: 10,
  SPEAKING_LONG_CONV: 10,
  READING_CLOZE: 15,
  READING_COMP: 15,
};

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
function shuffleOptions(options: string[], correctIndex: number): { options: string[]; correctIndex: number } {
  const order = shuffle(options.map((_, i) => i));
  return { options: order.map((i) => options[i]), correctIndex: order.indexOf(correctIndex) };
}

export function assembleTgat(bank: TgatBank, hiddenIds: Set<string> = new Set()): TgatAssembled {
  const questions: TgatMockQuestion[] = [];
  const groups: Record<string, TgatMockGroup> = {};
  let uid = 0;
  const nextUid = () => `t${uid++}`;

  // 1) Question-Response — โจทย์เดี่ยว สลับตัวเลือก
  for (const it of sample(bank.speakingQR.filter((x) => !hiddenIds.has(x.id)), TARGET.SPEAKING_QR)) {
    const s = shuffleOptions(it.options, it.answerIndex);
    questions.push({
      uid: nextUid(),
      section: "SPEAKING_QR",
      stem: it.prompt,
      options: s.options,
      correctIndex: s.correctIndex,
      explanation_th: it.explanation_th,
    });
  }

  // 2-5) พาร์ตที่เป็นกลุ่ม (บทสนทนา/บทความ) — ดึงทีละบทจนครบเป้า
  const addGroups = (pool: TgatGroup[], section: TgatSection, target: number) => {
    let count = 0;
    for (const g of shuffle(pool)) {
      if (count >= target) break;
      const qs = g.questions.filter((q) => !hiddenIds.has(q.id));
      if (qs.length === 0) continue;
      const take = Math.min(qs.length, target - count);
      groups[g.id] = { id: g.id, title: g.title, text: g.text, kind: g.kind };
      for (const q of qs.slice(0, take)) {
        const s = shuffleOptions(q.options, q.answerIndex);
        questions.push({
          uid: nextUid(),
          section,
          groupId: g.id,
          stem: q.stem,
          options: s.options,
          correctIndex: s.correctIndex,
          explanation_th: q.explanation_th,
        });
        count++;
      }
    }
  };
  addGroups(bank.shortConversations, "SPEAKING_SHORT_CONV", TARGET.SPEAKING_SHORT_CONV);
  addGroups(bank.longConversations, "SPEAKING_LONG_CONV", TARGET.SPEAKING_LONG_CONV);
  addGroups(bank.clozePassages, "READING_CLOZE", TARGET.READING_CLOZE);
  addGroups(bank.readingPassages, "READING_COMP", TARGET.READING_COMP);

  return { questions, groups, totalQuestions: questions.length };
}

// ── ตรวจคะแนน: Speaking 50 + Reading 50 ──
export interface TgatSectionScore { correct: number; total: number; }
export interface TgatResult {
  speakingCorrect: number; speakingTotal: number; speakingScore: number; // /50
  readingCorrect: number; readingTotal: number; readingScore: number;    // /50
  correctCount: number; totalQuestions: number;
  score: number;    // /100
  percent: number;  // = score
  bySection: Partial<Record<TgatSection, TgatSectionScore>>;
}

// ── Layer B: แยกโจทย์ (ไม่มีเฉลย) ออกจากเฉลย (เก็บฝั่งเซิร์ฟเวอร์) ──
export interface TgatPublicQuestion {
  uid: string; section: TgatSection; groupId?: string; stem: string; options: string[];
}
export interface TgatAnswerKeyEntry { correctIndex: number; section: TgatSection; explanation_th: string; }
export interface TgatAssembledForServer {
  publicQuestions: TgatPublicQuestion[];
  answerKey: Record<string, TgatAnswerKeyEntry>;
  groups: Record<string, TgatMockGroup>;
  totalQuestions: number;
}
export function splitTgat(mock: TgatAssembled): TgatAssembledForServer {
  const publicQuestions: TgatPublicQuestion[] = [];
  const answerKey: Record<string, TgatAnswerKeyEntry> = {};
  for (const q of mock.questions) {
    publicQuestions.push({ uid: q.uid, section: q.section, groupId: q.groupId, stem: q.stem, options: q.options });
    answerKey[q.uid] = { correctIndex: q.correctIndex, section: q.section, explanation_th: q.explanation_th };
  }
  return { publicQuestions, answerKey, groups: mock.groups, totalQuestions: mock.totalQuestions };
}

function scaleScore(correct: number, total: number, max: number): number {
  return total > 0 ? Math.round((correct / total) * max) : 0;
}

export function scoreTgatFromKey(
  answerKey: Record<string, TgatAnswerKeyEntry>,
  answers: Record<string, number>
): TgatResult {
  let speakingCorrect = 0, speakingTotal = 0, readingCorrect = 0, readingTotal = 0, correctCount = 0, totalQuestions = 0;
  const bySection: Partial<Record<TgatSection, TgatSectionScore>> = {};
  for (const uid of Object.keys(answerKey)) {
    const k = answerKey[uid];
    totalQuestions += 1;
    const sec = (bySection[k.section] ??= { correct: 0, total: 0 });
    sec.total += 1;
    const part = sectionPart(k.section);
    if (part === "SPEAKING") speakingTotal += 1; else readingTotal += 1;
    if (answers[uid] === k.correctIndex) {
      correctCount += 1;
      sec.correct += 1;
      if (part === "SPEAKING") speakingCorrect += 1; else readingCorrect += 1;
    }
  }
  const speakingScore = scaleScore(speakingCorrect, speakingTotal, 50);
  const readingScore = scaleScore(readingCorrect, readingTotal, 50);
  const score = speakingScore + readingScore;
  return {
    speakingCorrect, speakingTotal, speakingScore,
    readingCorrect, readingTotal, readingScore,
    correctCount, totalQuestions,
    score, percent: score,
    bySection,
  };
}

// mm:ss
export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
