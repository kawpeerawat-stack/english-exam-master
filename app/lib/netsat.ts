// app/lib/netsat.ts
// เครื่องประกอบ "ชุดสอบจำลอง NETSAT" จากคลังข้อ (public/netsat-bank.json)

export type Section = "WRITING_ERROR" | "WRITING_SC" | "READING_SHORT" | "READING_LONG";

export const SECTION_LABEL: Record<Section, string> = {
  WRITING_ERROR: "Part 1 — Error Identification (หาจุดผิด)",
  WRITING_SC: "Part 2 — Sentence Completion (เติมประโยค)",
  READING_SHORT: "Part 3 — Reading: Instructions / Correspondence",
  READING_LONG: "Part 4 — Reading: Information & Argument",
};

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

export const EXAM_SECONDS = 90 * 60;
const TARGET_READING = 20;

export async function loadBank(): Promise<NetsatBank> {
  const res = await fetch("/netsat-bank.json", { cache: "force-cache" });
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

function shuffleOptions(options: string[], correctIndex: number): { options: string[]; correctIndex: number } {
  const order = shuffle(options.map((_, i) => i));
  return {
    options: order.map((i) => options[i]),
    correctIndex: order.indexOf(correctIndex),
  };
}

function pickWriting(pool: BankWritingItem[], n: number): BankWritingItem[] {
  const netsat = pool.filter((x) => x.exam_type === "NETSAT");
  const others = pool.filter((x) => x.exam_type !== "NETSAT");
  const chosen = sample(netsat, Math.min(n, netsat.length));
  if (chosen.length < n) chosen.push(...sample(others, n - chosen.length));
  return shuffle(chosen);
}

export function assembleMock(bank: NetsatBank): AssembledMock {
  const questions: MockQuestion[] = [];
  const passages: Record<string, MockPassage> = {};
  let uid = 0;
  const nextUid = () => `q${uid++}`;

  const writing: { items: BankWritingItem[]; section: Section }[] = [
    { items: pickWriting(bank.writingError, 10), section: "WRITING_ERROR" },
    { items: pickWriting(bank.writingSC, 10), section: "WRITING_SC" },
  ];
  for (const grp of writing) {
    for (const it of grp.items) {
      const s = shuffleOptions(it.options, it.answerIndex);
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

  let readingCount = 0;
  const addPassage = (p: BankReadingPassage, section: Section, max: number) => {
    if (readingCount >= TARGET_READING) return;
    const take = Math.min(max, p.questions.length, TARGET_READING - readingCount);
    if (take <= 0) return;
    passages[p.id] = { id: p.id, title: p.title, passage: p.passage, wordCount: p.wordCount };
    for (const q of p.questions.slice(0, take)) {
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

  const shortP = sample(bank.readingShort, 1)[0];
  if (shortP) addPassage(shortP, "READING_SHORT", 9);
  for (const p of shuffle(bank.readingLong)) {
    if (readingCount >= TARGET_READING) break;
    addPassage(p, "READING_LONG", 11);
  }

  const totalPoints = questions.reduce((s, q) => s + q.points, 0);
  return { questions, passages, totalPoints, totalQuestions: questions.length };
}

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

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
