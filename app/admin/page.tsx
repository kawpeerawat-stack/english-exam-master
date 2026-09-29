'use client'

// ─────────────────────────────────────────────────────────────
// หน้า Admin — ความก้าวหน้านักเรียน (Grammar Master)
//  • แสดงเฉพาะ "หัวข้อ Grammar" (หน่วยย่อย) ที่นักเรียนทำครบ 100% เท่านั้น
//  • ไม่รวมแบบฝึกหัด Error / Cloze / Sentence (ส่วนนั้นเก็บใน setBest แยก)
//  • คำนวณ 100% จากจำนวนข้อจริงในคลัง /grammar.json (ตัวหารถูกต้องเสมอ)
//  • ทะเบียนนักเรียนจริง /roster.json (ชื่อไทย + ห้อง + เลขที่) → ติดตามการเข้าทำ
//  • จับคู่บัญชีในแอปกับทะเบียนด้วย "ห้อง + เลขที่" ที่นักเรียนกรอกในชื่อ
//  • กั้นสิทธิ์: เห็นได้เฉพาะอีเมลใน ADMIN_EMAILS
// ─────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/AuthProvider'
import {
  loadAllGrammarStudents, type GrammarStudentRow,
  loadManualOverrides, saveManualOverride, removeManualOverride, type ManualOverrideEntry,
} from '@/lib/cloud'

// ⭐ แก้/เพิ่มอีเมลแอดมินที่นี่ (ตัวพิมพ์เล็ก)
const ADMIN_EMAILS = ['kawpeerawat@gmail.com']
// บัญชีทดสอบของอาจารย์เอง (ไม่ใช่นักเรียนจริง) → ไม่ต้องแสดงในรายชื่อ/แท็บยังไม่จับคู่
const EXCLUDED_EMAILS = ['kawwichiannit@gmail.com']

// ลำดับหัวข้อที่อยากให้แสดง (ให้ตรงกับในแอป) — หัวข้ออื่นที่ไม่อยู่ในนี้จะต่อท้าย
const TOPIC_ORDER = [
  'Tenses', 'Subject-Verb Agreement', 'Connectors', 'Sentence Structure',
  'Relative Clauses', 'Non-finite Verbs', 'Comparison', 'Word Order',
  'Word Form', 'Gerund Infinitive', 'Articles', 'Pronouns',
  'Subjunctive', 'Passive Voice', 'Conditionals',
]

type Q = { grammar_topic?: string }
type RosterEntry = { room: string; no: number; name: string }
type TopicHistory = { rounds: number; avgPct: number; bestScore: number; lastDate: string }
type StudentHistory = Record<string, TopicHistory> // topic -> stats
type ExtraStat = { rounds: number; avgPct: number; bestPct: number; lastDate: string }
type ExtraHistory = { errorId?: ExtraStat; sentenceCompletion?: ExtraStat }
type SetInfo = { id: string; total: number } // ชุดข้อสอบ Error ID / Sentence Completion (id + จำนวนข้อในชุด)

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
function timeAgo(ms: number | null): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), day = Math.floor(h / 24)
  if (day > 0) return `${day} วันก่อน`
  if (h > 0) return `${h} ชม.ก่อน`
  if (m > 0) return `${m} นาทีก่อน`
  return 'เมื่อสักครู่'
}

// ดึง "ห้อง" จากชื่อ เช่น "... M.6/2" / "ม.6/5" / "6/3" → "6/2"
function parseRoom(name: string): string | null {
  const ms = name.match(/\d{1,2}\s*\/\s*\d{1,2}/g)
  if (!ms || ms.length === 0) return null
  return ms[ms.length - 1].replace(/\s/g, '')
}
// ดึง "เลขที่" จากชื่อ — รองรับ 3 รูปแบบ:
//  1) ชัดเจน: No.16 / เลขที่ 16 / เบอร์ 16 / #16 / N.16
//  2) เลขเดี่ยวลอย ๆ (มีช่องว่างคั่น) เช่น "... 6/5 25" หรือ "25 6/5" (ตัดส่วนห้องออกก่อน)
//  3) เลขติดท้ายคำ (ไม่มีช่องว่าง) เช่น "ไชยวรรณ24 6/3" — เอาเฉพาะเลข 1-2 หลักที่ไม่ติดเลขอื่น
function parseNo(name: string): number | null {
  const m1 = name.match(/(?:no\.?|เลขที่|เบอร์|#|n\.)\s*(\d{1,2})\b/i)
  if (m1) return parseInt(m1[1], 10)
  const stripped = name.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ') // ตัด "ห้อง" เช่น 6/3 ออกก่อน กันสับสน
  const m2 = stripped.match(/(?<![\d.])\b(\d{1,2})\b(?![\d.])/g)
  if (m2 && m2.length > 0) return parseInt(m2[m2.length - 1], 10)
  const m3 = stripped.match(/(?<!\d)(\d{1,2})(?!\d)/g)
  if (m3 && m3.length > 0) return parseInt(m3[m3.length - 1], 10)
  return null
}

// ตัดคำนำหน้าชื่อไทย + ช่องว่าง เพื่อเทียบชื่อแบบหลวม ๆ
function normalizeThaiName(s: string): string {
  return s.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').replace(/\s+/g, '').trim()
}

// จับคู่สำรองด้วย "ชื่อไทย" เมื่อไม่มีเลขที่ในชื่อที่กรอก — เทียบเฉพาะนักเรียนในห้องเดียวกัน
// คืนค่ารายการทะเบียนที่ตรง ถ้าตรงมากกว่า 1 คน (กำกวม) จะไม่จับคู่ (คืน null) เพื่อความปลอดภัย
function matchByThaiName(accountName: string, roomEntries: RosterEntry[]): RosterEntry | null {
  const norm = normalizeThaiName(accountName)
  if (!/[\u0E00-\u0E7F]/.test(norm)) return null // ต้องมีอักษรไทยอย่างน้อย 1 ตัว
  const hits = roomEntries.filter(e => norm.includes(normalizeThaiName(e.name)))
  return hits.length === 1 ? hits[0] : null
}

// จับคู่ชื่อไทยแบบ "พิมพ์ผิด/สะกดคลาดเคลื่อนได้บ้าง" — ใช้เมื่อเทียบตรงตัวเป๊ะ (matchByThaiName) หาไม่เจอ
// เทียบด้วยค่าความคล้าย (Levenshtein) แทนการต้องตรงตัวทุกตัวอักษร รองรับกรณีพิมพ์ตกหล่น/วรรณยุกต์ผิด/สะกดเพี้ยนเล็กน้อย
// เกณฑ์ 0.75 + ห่างอันดับ 2 ≥0.15 (ทดสอบแล้วชื่อคนละคนในห้องเดียวกันคล้ายสุดแค่ ~0.64 จึงเว้นระยะปลอดภัยไว้มาก)
function matchByThaiNameFuzzy(accountName: string, roomEntries: RosterEntry[], threshold = 0.75, margin = 0.15): RosterEntry | null {
  const cleaned = cleanEnteredName(accountName) // ตัดห้อง/เลขที่/คำนำหน้าออกก่อน
  const norm = normalizeThaiName(cleaned)
  if (!norm || !/[\u0E00-\u0E7F]/.test(norm)) return null // ต้องมีอักษรไทยอย่างน้อย 1 ตัว
  if (roomEntries.length === 0) return null
  const scored = roomEntries
    .map(e => ({ e, score: stringSimilarity(norm, normalizeThaiName(e.name)) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (best.score < threshold) return null
  if (second && best.score - second.score < margin) return null // ใกล้เคียงกันเกินไป กำกวม ไม่จับคู่
  return best.e
}

// ดึง "ชื่อจริง" อย่างเดียวจากชื่อทางการ (ตัดคำนำหน้า + เอาแค่คำแรกก่อนช่องว่าง — นามสกุลไทยมักไม่มีช่องว่างคั่นในตัวเอง)
function extractFirstName(officialName: string): string {
  const clean = officialName.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').trim()
  return clean.split(/\s+/)[0] || ''
}

// จับคู่เมื่อพิมพ์แค่ "ชื่อจริง" อย่างเดียว ไม่ใส่นามสกุล (นักเรียนบางคนขี้เกียจพิมพ์นามสกุล)
// ใช้ "ขึ้นต้นด้วยชื่อจริง" (ไม่ใช่ตรงเป๊ะ) กันเศษอักษรตกค้าง เช่น "ม" จากการตัดคำว่าห้องที่ไม่สมบูรณ์
// ต้องมีคนเดียวในห้องที่ชื่อจริงนี้ (ทดสอบแล้วทั้งโรงเรียนซ้ำกันแค่คู่เดียว "ธนภัทร" ห้อง 6/2)
function matchByFirstNameOnly(accountName: string, roomEntries: RosterEntry[]): RosterEntry | null {
  const cleaned = normalizeThaiName(cleanEnteredName(accountName))
  if (!cleaned || !/[\u0E00-\u0E7F]/.test(cleaned)) return null
  const hits = roomEntries.filter(e => {
    const fn = extractFirstName(e.name)
    return fn.length >= 2 && cleaned.startsWith(fn) // กันชื่อจริงสั้นเกิน 1 ตัวอักษรที่เสี่ยงจับมั่ว
  })
  return hits.length === 1 ? hits[0] : null
}


// ── จับคู่สำรองชั้นที่ 4: เทียบชื่ออังกฤษที่กรอก กับ "ชื่อไทยทับศัพท์เป็นอังกฤษ" (roster-roman.json) ──
type RosterRoman = { room: string; no: number; name: string; roman: string }

// ตัดห้อง/เลขที่/คำนำหน้า ออกจากชื่อที่กรอก เหลือแต่ตัวชื่อ (lowercase) สำหรับเทียบทับศัพท์
function cleanEnteredName(name: string): string {
  let s = name.replace(/\d{1,2}\s*\/\s*\d{1,2}/g, ' ')
  s = s.replace(/(?:no\.?|เลขที่|เบอร์|#|n\.|[mม]\.?)\s*\d{0,2}\b/gi, ' ')
  s = s.replace(/[.,]/g, ' ')
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

// Levenshtein distance → ค่าความคล้าย 0-1 (1 = เหมือนกันทุกตัวอักษร)
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const dp: number[] = Array(b.length + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  const dist = dp[b.length]
  return 1 - dist / Math.max(a.length, b.length)
}

// จับคู่ด้วยชื่ออังกฤษเทียบทับศัพท์ — ต้องได้คะแนนสูงพอ (≥0.55) และนำอันดับ 2 พอสมควร (กันกำกวม)
// จับคู่ด้วยชื่ออังกฤษเทียบทับศัพท์ — ต้องได้คะแนนสูงพอและนำอันดับ 2 พอสมควร (กันกำกวม)
// scope แคบ (ในห้องเดียว) ใช้เกณฑ์ปกติ (0.55/0.08); scope กว้าง (ข้ามทุกห้อง) ต้องเข้มกว่า เพราะตัวเลือกเยอะขึ้นเสี่ยงชนกันง่ายกว่า
function matchByRomanName(accountName: string, roomRoman: RosterRoman[], threshold = 0.55, margin = 0.08): RosterRoman | null {
  const entered = cleanEnteredName(accountName)
  if (!entered || /[\u0E00-\u0E7F]/.test(entered)) return null // เฉพาะชื่อที่กรอกเป็นอังกฤษล้วน
  if (roomRoman.length === 0) return null
  const scored = roomRoman
    .map(e => ({ e, score: stringSimilarity(entered, e.roman) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (best.score < threshold) return null
  if (second && best.score - second.score < margin) return null // ใกล้เคียงกันเกินไป กำกวม ไม่จับคู่
  return best.e
}

// เทียบ "คำแรก" ของชื่อ (ตัดคำนำหน้าไทยออกก่อน) แบบ lowercase — ใช้แยกว่าเป็นคนเดียวกัน (สมัครซ้ำ) หรือคนละคน (พิมพ์เลขที่ชนกัน)
function normalizeThaiOrLatinFirstWord(name: string): string {
  const cleaned = name.replace(/^(นางสาว|นาย|นาง|ด\.ช\.|ด\.ญ\.)\s*/, '').trim()
  return (cleaned.split(/\s+/)[0] || '').toLowerCase()
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa] p-6">
      <div className="text-center text-gray-500 font-bold max-w-md">{children}</div>
    </div>
  )
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const email = (session?.user?.email || '').toLowerCase()
  const isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)

  const [students, setStudents] = useState<GrammarStudentRow[]>([])
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [rosterRoman, setRosterRoman] = useState<RosterRoman[]>([])
  const [overrides, setOverrides] = useState<Record<string, ManualOverrideEntry>>({})
  const [history, setHistory] = useState<Record<string, StudentHistory>>({})
  const [extraHistory, setExtraHistory] = useState<Record<string, ExtraHistory>>({})
  const [errorSetInfo, setErrorSetInfo] = useState<SetInfo[]>([])   // ชุด Error ID (สด จาก errorSets.json)
  const [clozeSetInfo, setClozeSetInfo] = useState<SetInfo[]>([])   // ชุด Cloze Test (สด จาก clozeSets.json)
  const [scSetInfo, setScSetInfo] = useState<SetInfo[]>([])          // ชุด Sentence Completion (สด จาก scSets.json)
  const [totalByTopic, setTotalByTopic] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<'completed' | 'name' | 'recent'>('completed')
  const [room, setRoom] = useState('all')
  const [onlyNotDone, setOnlyNotDone] = useState(false)

  // ── จับคู่มือ: state ของ modal เลือกนักเรียนจากทะเบียน ──
  const [linkingEmail, setLinkingEmail] = useState<string | null>(null) // อีเมลบัญชีที่กำลังจะจับคู่ (เปิด modal เมื่อไม่ null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState('')


  useEffect(() => {
    if (status !== 'authenticated' || !isAdmin) { setLoading(false); return }
    let alive = true
    ;(async () => {
      setLoading(true); setError('')
      try {
        // นับจำนวนข้อต่อหัวข้อจากคลังจริง → ใช้เป็นตัวหารตัดสิน 100%
        const [gRes, rRes, hRes, eRes, rmRes, ovRes, esRes, scRes, czRes, fsOverrides] = await Promise.all([
          fetch('/grammar.json', { cache: 'no-store' }),
          fetch('/roster.json', { cache: 'no-store' }).catch(() => null),
          fetch('/grammar-history.json', { cache: 'no-store' }).catch(() => null),
          fetch('/extra-history.json', { cache: 'no-store' }).catch(() => null),
          fetch('/roster-roman.json', { cache: 'no-store' }).catch(() => null),
          fetch('/manual-overrides.json', { cache: 'no-store' }).catch(() => null),
          fetch('/errorSets.json', { cache: 'no-store' }).catch(() => null),   // ชุด Error ID (สด)
          fetch('/scSets.json', { cache: 'no-store' }).catch(() => null),      // ชุด Sentence Completion (สด)
          fetch('/clozeSets.json', { cache: 'no-store' }).catch(() => null),   // ชุด Cloze Test (สด)
          loadManualOverrides().catch(() => ({})), // จับคู่มือที่บันทึกถาวรบน Firestore (ยืนยันในหน้า Admin)
        ])
        const qs: Q[] = await gRes.json()
        const totals: Record<string, number> = {}
        for (const q of qs) { const t = q.grammar_topic; if (t) totals[t] = (totals[t] || 0) + 1 }
        let rosterData: RosterEntry[] = []
        if (rRes && rRes.ok) { try { rosterData = await rRes.json() } catch { rosterData = [] } }
        let historyData: Record<string, StudentHistory> = {}
        if (hRes && hRes.ok) { try { historyData = await hRes.json() } catch { historyData = {} } }
        let extraData: Record<string, ExtraHistory> = {}
        if (eRes && eRes.ok) { try { extraData = await eRes.json() } catch { extraData = {} } }
        let romanData: RosterRoman[] = []
        if (rmRes && rmRes.ok) { try { romanData = await rmRes.json() } catch { romanData = [] } }
        let errorSetsRaw: { id: string; items?: unknown[] }[] = []
        if (esRes && esRes.ok) { try { errorSetsRaw = await esRes.json() } catch { errorSetsRaw = [] } }
        let scSetsRaw: { id: string; items?: unknown[] }[] = []
        if (scRes && scRes.ok) { try { scSetsRaw = await scRes.json() } catch { scSetsRaw = [] } }
        let clozeSetsRaw: { id: string; questions?: unknown[] }[] = []
        if (czRes && czRes.ok) { try { clozeSetsRaw = await czRes.json() } catch { clozeSetsRaw = [] } }
        // ไฟล์ manual-overrides.json = seed เริ่มต้น (คนที่ยืนยันไปก่อนหน้านี้) — Firestore ทับได้ถ้าซ้ำคีย์กัน (ใหม่กว่าเชื่อ Firestore)
        let seedOverrides: Record<string, { room: string; no: number }> = {}
        if (ovRes && ovRes.ok) { try { seedOverrides = await ovRes.json() } catch { seedOverrides = {} } }
        const mergedOverrides: Record<string, ManualOverrideEntry> = {}
        Object.entries(seedOverrides).forEach(([email, v]) => {
          mergedOverrides[email] = { room: v.room, no: v.no, officialName: '', linkedAt: 0 }
        })
        Object.entries(fsOverrides).forEach(([email, v]) => { mergedOverrides[email] = v })
        const rows = await loadAllGrammarStudents()
        if (!alive) return
        setTotalByTopic(totals)
        setRoster(Array.isArray(rosterData) ? rosterData : [])
        setRosterRoman(Array.isArray(romanData) ? romanData : [])
        setOverrides(mergedOverrides)
        setHistory(historyData)
        setExtraHistory(extraData)
        setErrorSetInfo(errorSetsRaw.map(s => ({ id: s.id, total: s.items?.length || 0 })))
        setClozeSetInfo(clozeSetsRaw.map(s => ({ id: s.id, total: s.questions?.length || 0 })))
        setScSetInfo(scSetsRaw.map(s => ({ id: s.id, total: s.items?.length || 0 })))
        setStudents(rows)
      } catch (e) {
        if (alive) setError('โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง')
        console.error(e)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [status, isAdmin])

  // หัวข้อทั้งหมด เรียงตาม TOPIC_ORDER ก่อน
  const allTopics = useMemo(() => {
    const keys = Object.keys(totalByTopic)
    const ordered = TOPIC_ORDER.filter(t => keys.includes(t))
    const extra = keys.filter(t => !TOPIC_ORDER.includes(t)).sort()
    return [...ordered, ...extra]
  }, [totalByTopic])
  const totalTopics = allTopics.length

  // แผนที่ทะเบียน: "ห้อง-เลขที่" → ชื่อไทย
  const rosterMap = useMemo(() => {
    const m: Record<string, string> = {}
    roster.forEach(e => { m[`${e.room}-${e.no}`] = e.name })
    return m
  }, [roster])

  // ทะเบียนแยกตามห้อง (เรียงเลขที่) — ต้องมาก่อน computed เพราะใช้ตอนจับคู่ด้วยชื่อไทย
  const rosterByRoom = useMemo(() => {
    const m: Record<string, RosterEntry[]> = {}
    roster.forEach(e => { (m[e.room] = m[e.room] || []).push(e) })
    Object.keys(m).forEach(k => m[k].sort((a, b) => a.no - b.no))
    return m
  }, [roster])
  const rosterRooms = useMemo(
    () => Object.keys(rosterByRoom).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [rosterByRoom]
  )
  const rosterRomanByRoom = useMemo(() => {
    const m: Record<string, RosterRoman[]> = {}
    rosterRoman.forEach(e => { (m[e.room] = m[e.room] || []).push(e) })
    return m
  }, [rosterRoman])

  // คำนวณหัวข้อที่ครบ 100% ของแต่ละคน + จับคู่ทะเบียน (ห้อง/เลขที่/ชื่อไทย/ชื่ออังกฤษทับศัพท์) + สถิติย้อนหลังต่อหัวข้อ (จากอีเมล)
  // จับคู่ 4 ชั้น: (1) เลขที่ชัดเจน/หลวม + ห้อง  (2) ชื่อไทยตรงทะเบียนในห้องเดียวกัน  (3) ชื่ออังกฤษเทียบทับศัพท์ในห้องเดียวกัน
  const computed = useMemo(() => {
    return students.filter(s => !EXCLUDED_EMAILS.includes(s.email.toLowerCase())).map(s => {
      const completed = allTopics.filter(
        t => (totalByTopic[t] || 0) > 0 && (s.topicProgress[t] || 0) >= (totalByTopic[t] || 0)
      )
      const rm = parseRoom(s.name)
      const no = parseNo(s.name)
      let key = rm && no ? `${rm}-${no}` : null
      let officialName = key ? (rosterMap[key] ?? null) : null
      let matchedBy: 'override' | 'number' | 'name' | 'name-fuzzy' | 'first-name' | 'roman' | 'name-global' | 'roman-global' | null = officialName ? 'number' : null
      // ชั้นที่ 0 (มั่นใจสุด): เคยยืนยันตัวตนด้วยมือแล้ว (manual-overrides.json) → ใช้ค่านี้เสมอ ไม่สนชื่อที่กรอกตอนนี้
      const ov = overrides[s.email.toLowerCase()]
      if (ov && rosterMap[`${ov.room}-${ov.no}`]) {
        key = `${ov.room}-${ov.no}`
        officialName = rosterMap[key]
        matchedBy = 'override'
      }
      if (!officialName && rm && rosterByRoom[rm]) {
        const nameHit = matchByThaiName(s.name, rosterByRoom[rm])
        if (nameHit) { officialName = nameHit.name; key = `${rm}-${nameHit.no}`; matchedBy = 'name' }
      }
      // ชื่อไทยตรงเป๊ะไม่เจอ → ลองแบบพิมพ์ผิด/สะกดคลาดเคลื่อนได้บ้าง (ในห้องเดียวกัน)
      if (!officialName && rm && rosterByRoom[rm]) {
        const fuzzyHit = matchByThaiNameFuzzy(s.name, rosterByRoom[rm])
        if (fuzzyHit) { officialName = fuzzyHit.name; key = `${rm}-${fuzzyHit.no}`; matchedBy = 'name-fuzzy' }
      }
      // พิมพ์แค่ "ชื่อจริง" ไม่ใส่นามสกุล (ในห้องเดียวกัน — ต้องไม่ซ้ำกับใครในห้องนั้น)
      if (!officialName && rm && rosterByRoom[rm]) {
        const firstNameHit = matchByFirstNameOnly(s.name, rosterByRoom[rm])
        if (firstNameHit) { officialName = firstNameHit.name; key = `${rm}-${firstNameHit.no}`; matchedBy = 'first-name' }
      }
      if (!officialName && rm && rosterRomanByRoom[rm]) {
        const romanHit = matchByRomanName(s.name, rosterRomanByRoom[rm])
        if (romanHit) { officialName = romanHit.name; key = `${rm}-${romanHit.no}`; matchedBy = 'roman' }
      }
      // ชั้นที่ 5: ไม่รู้ห้องเลย (หรือห้องที่พาร์สได้ผิด) → ค้นหาชื่อไทยเต็มข้ามทุกห้องทั้งโรงเรียน
      // ปลอดภัยเพราะต้องเจอ "ชื่อ-นามสกุลเต็ม" ตรงกับแค่ 1 คนเท่านั้นถึงจะยอมจับคู่ (ถ้าซ้ำ/กำกวม จะไม่จับคู่)
      if (!officialName) {
        const globalHit = matchByThaiName(s.name, roster)
        if (globalHit) { officialName = globalHit.name; key = `${globalHit.room}-${globalHit.no}`; matchedBy = 'name-global' }
      }
      // ชั้นที่ 6: ยังไม่เจอ + ชื่อเป็นอังกฤษล้วน → ค้นทับศัพท์ข้ามทุกห้องทั้งโรงเรียน (เกณฑ์เข้มกว่าในห้องเดียว 0.65/0.12 กันชนกันมั่ว)
      if (!officialName) {
        const romanGlobalHit = matchByRomanName(s.name, rosterRoman, 0.65, 0.12)
        if (romanGlobalHit) { officialName = romanGlobalHit.name; key = `${romanGlobalHit.room}-${romanGlobalHit.no}`; matchedBy = 'roman-global' }
      }
      const topicHistory = history[s.email.toLowerCase()] || {}
      const extra = extraHistory[s.email.toLowerCase()] || {}
      // ทำครบไปแล้วกี่ข้อ (สด จาก setBest) — Cloze Test / Error Identification / Sentence Completion
      const errorDone = errorSetInfo.reduce((sum, set) => sum + Math.min(s.setBest?.[set.id] ?? 0, set.total), 0)
      const scDone = scSetInfo.reduce((sum, set) => sum + Math.min(s.setBest?.[set.id] ?? 0, set.total), 0)
      const clozeDone = clozeSetInfo.reduce((sum, set) => sum + Math.min(s.setBest?.[set.id] ?? 0, set.total), 0)
      return { ...s, completed, completedCount: completed.length, room: rm, no, key, officialName, matchedBy, topicHistory, extra, errorDone, scDone, clozeDone }
    })
  }, [students, allTopics, totalByTopic, roster, rosterMap, rosterByRoom, rosterRomanByRoom, overrides, history, extraHistory, errorSetInfo, scSetInfo, clozeSetInfo])

  type Account = (typeof computed)[number]

  // จับคู่ "ห้อง-เลขที่" → บัญชีที่ตรงทะเบียน (ถ้าซ้ำเลือกคนที่ทำครบหัวข้อมากกว่า/ล่าสุดกว่า)
  const accountByKey = useMemo(() => {
    const m: Record<string, Account> = {}
    computed.forEach(c => {
      if (!c.key || !c.officialName) return
      const ex = m[c.key]
      if (!ex || c.completedCount > ex.completedCount ||
          (c.completedCount === ex.completedCount && (c.updatedAt || 0) > (ex.updatedAt || 0))) {
        m[c.key] = c
      }
    })
    return m
  }, [computed])

  // บัญชีที่จับคู่ทะเบียนไม่ได้ (ยังไม่ใส่ห้อง/เลขที่ หรือใส่ไม่ตรง) → ให้ครูเช็กเอง
  const orphanAccounts = useMemo(() => computed.filter(c => !c.officialName), [computed])

  // บัญชีที่กำลังเปิด modal จับคู่มืออยู่ (หา object เต็มจาก email ที่เก็บไว้ใน state)
  const linkingAccount = useMemo(
    () => (linkingEmail ? computed.find(c => c.email.toLowerCase() === linkingEmail) ?? null : null),
    [linkingEmail, computed]
  )

  // รายชื่อทะเบียนที่ค้นหาได้ใน modal จับคู่มือ (ค้นได้ทั้งชื่อไทยและเลขที่/ห้อง)
  const linkCandidates = useMemo(() => {
    const q = linkSearch.trim().toLowerCase()
    if (!q) return roster.slice(0, 30) // ยังไม่พิมพ์ค้นหา → โชว์ 30 คนแรกกันรายการยาวเกิน
    return roster.filter(e =>
      e.name.toLowerCase().includes(q) ||
      `${e.room}`.includes(q) ||
      String(e.no).includes(q)
    ).slice(0, 30)
  }, [roster, linkSearch])

  const handleOpenLink = (email: string) => { setLinkingEmail(email); setLinkSearch(''); setLinkError('') }
  const handleCloseLink = () => { if (!linkSaving) { setLinkingEmail(null); setLinkError('') } }

  const handleConfirmLink = async (entry: RosterEntry) => {
    if (!linkingAccount) return
    setLinkSaving(true); setLinkError('')
    const ok = await saveManualOverride(linkingAccount.email, entry.room, entry.no, entry.name)
    setLinkSaving(false)
    if (!ok) { setLinkError('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); return }
    // อัปเดตหน้าจอทันที ไม่ต้องรอโหลดใหม่
    setOverrides(prev => ({ ...prev, [linkingAccount.email.toLowerCase()]: { room: entry.room, no: entry.no, officialName: entry.name, linkedAt: Date.now() } }))
    setLinkingEmail(null)
  }

  const handleUnlink = async (email: string) => {
    const ok = await removeManualOverride(email)
    if (!ok) return
    setOverrides(prev => { const n = { ...prev }; delete n[email.toLowerCase()]; return n })
  }

  // 🔴 ตรวจจับ "ความขัดแย้ง" — หลายบัญชีจับคู่ไปที่ห้อง-เลขที่เดียวกัน (พิมพ์เลขที่ผิดชนกัน หรือสมัครซ้ำ 2 อีเมล)
  // สำคัญ: ถ้าปล่อยไว้ อาจโชว์ข้อมูลของคนหนึ่งไปแปะชื่อของอีกคนโดยไม่รู้ตัว
  const keyConflicts = useMemo(() => {
    const groups: Record<string, Account[]> = {}
    computed.forEach(c => { if (c.key && c.officialName) (groups[c.key] = groups[c.key] || []).push(c) })
    return Object.entries(groups)
      .filter(([, accs]) => accs.length > 1)
      .map(([key, accs]) => {
        // เดาว่าใครคือ "ตัวการพิมพ์ผิด": ชื่อที่กรอกไม่คล้ายกับชื่อทางการเลย มักเป็นตัวการ
        const sameNameGroup = accs.every(a => normalizeThaiOrLatinFirstWord(a.name) === normalizeThaiOrLatinFirstWord(accs[0].name))
        return { key, accounts: accs, likelyDuplicateAccount: sameNameGroup }
      })
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
  }, [computed])

  const isClassView = room !== 'all' && room !== 'none'

  // มุมมองห้อง: รายชื่อทะเบียนทั้งห้อง + บัญชีที่จับคู่ได้
  const classRows = useMemo(() => {
    if (!isClassView) return [] as { entry: RosterEntry; acc: Account | null }[]
    const entries = rosterByRoom[room] || []
    return entries.map(e => ({ entry: e, acc: accountByKey[`${e.room}-${e.no}`] || null }))
  }, [isClassView, room, rosterByRoom, accountByKey])
  const classActive = useMemo(
    () => classRows.filter(r => r.acc).map(r => r.acc as Account),
    [classRows]
  )

  // ชุดบัญชีที่ใช้คำนวณสรุป/ภาพรวมรายหัวข้อ
  const scopeAccounts: Account[] = useMemo(() => {
    if (room === 'all') return computed
    if (room === 'none') return orphanAccounts
    return classActive
  }, [room, computed, orphanAccounts, classActive])

  // ตัวหาร: มุมมองห้อง = จำนวนในทะเบียน, อื่น ๆ = จำนวนบัญชีในมุมมอง
  const denom = isClassView ? (rosterByRoom[room]?.length || 0) : scopeAccounts.length

  const summary = useMemo(() => {
    const active = scopeAccounts.length
    const finishedAll = scopeAccounts.filter(r => totalTopics > 0 && r.completedCount >= totalTopics).length
    const avg = active > 0 ? scopeAccounts.reduce((s, r) => s + r.completedCount, 0) / active : 0
    return { active, finishedAll, avg }
  }, [scopeAccounts, totalTopics])

  // ภาพรวมรายหัวข้อ — กี่คนทำครบ (เทียบ denom) + สถิติเสริมจาก log ย้อนหลัง (ค่าเฉลี่ย%/รอบที่เคยเล่น)
  const perTopic = useMemo(() => {
    return allTopics.map(t => {
      const withHistory = scopeAccounts.filter(r => r.topicHistory[t])
      const rounds = withHistory.reduce((s, r) => s + (r.topicHistory[t]?.rounds || 0), 0)
      const avgPct = withHistory.length > 0
        ? withHistory.reduce((s, r) => s + (r.topicHistory[t]?.avgPct || 0), 0) / withHistory.length
        : 0
      return {
        topic: t,
        total: totalByTopic[t] || 0,
        done: scopeAccounts.filter(r => r.completed.includes(t)).length,
        historyStudents: withHistory.length,
        historyRounds: rounds,
        historyAvgPct: avgPct,
      }
    })
  }, [allTopics, scopeAccounts, totalByTopic])

  // รายการบัญชี (มุมมอง ทั้งหมด / ไม่จับคู่) — ค้นหา + เรียง
  const filteredAccounts = useMemo(() => {
    let rows = scopeAccounts
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(r =>
      (r.officialName || '').toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q)
    )
    return [...rows].sort((a, b) => {
      if (sortBy === 'name') return (a.officialName || a.name).localeCompare(b.officialName || b.name, 'th')
      if (sortBy === 'recent') return (b.updatedAt || 0) - (a.updatedAt || 0)
      return b.completedCount - a.completedCount || (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }, [scopeAccounts, query, sortBy])

  // รายการทะเบียน (มุมมองห้อง) — ค้นหา + ตัวเลือก "เฉพาะยังไม่เข้าทำ"
  const filteredClassRows = useMemo(() => {
    let rows = classRows
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(r => r.entry.name.toLowerCase().includes(q) || String(r.entry.no) === q)
    if (onlyNotDone) rows = rows.filter(r => !r.acc)
    return rows
  }, [classRows, query, onlyNotDone])

  const notDoneList = useMemo(() => classRows.filter(r => !r.acc), [classRows])

  // ตัวหารรวม (คงที่ จากโครงสร้างชุดข้อสอบจริง) — Cloze Test = 120, Error ID = 150, Sentence Completion = 150
  const errorTotal = useMemo(() => errorSetInfo.reduce((s, x) => s + x.total, 0), [errorSetInfo])
  const scTotal = useMemo(() => scSetInfo.reduce((s, x) => s + x.total, 0), [scSetInfo])
  const clozeTotal = useMemo(() => clozeSetInfo.reduce((s, x) => s + x.total, 0), [clozeSetInfo])

  // สรุปภาพรวม Cloze Test / Error ID / Sentence Completion — ตัวเลขสดจาก Firestore (xxxDone) + ข้อมูลรอบ/ค่าเฉลี่ยย้อนหลังจาก log ประกอบ (มีเฉพาะ Error/Sentence)
  const extraSummary = useMemo(() => {
    const calcLive = (doneKey: 'errorDone' | 'scDone' | 'clozeDone', total: number) => {
      const withProgress = scopeAccounts.filter(r => r[doneKey] > 0)
      const totalDone = scopeAccounts.reduce((s, r) => s + r[doneKey], 0)
      const finishedAll = total > 0 ? scopeAccounts.filter(r => r[doneKey] >= total).length : 0
      const avgPctLive = scopeAccounts.length > 0 && total > 0
        ? scopeAccounts.reduce((s, r) => s + r[doneKey], 0) / (scopeAccounts.length * total) : 0
      return { studentsStarted: withProgress.length, totalDone, finishedAll, avgPctLive }
    }
    const calcHistory = (key: 'errorId' | 'sentenceCompletion') => {
      const withData = scopeAccounts.filter(r => r.extra[key])
      const rounds = withData.reduce((s, r) => s + (r.extra[key]?.rounds || 0), 0)
      const avgPct = withData.length > 0
        ? withData.reduce((s, r) => s + (r.extra[key]?.avgPct || 0), 0) / withData.length
        : 0
      return { students: withData.length, rounds, avgPct }
    }
    return {
      cloze: { ...calcLive('clozeDone', clozeTotal), history: { students: 0, rounds: 0, avgPct: 0 } }, // ไม่มีข้อมูลย้อนหลัง (log เก่าไม่ได้เก็บ Cloze)
      errorId: { ...calcLive('errorDone', errorTotal), history: calcHistory('errorId') },
      sentenceCompletion: { ...calcLive('scDone', scTotal), history: calcHistory('sentenceCompletion') },
    }
  }, [scopeAccounts, errorTotal, scTotal, clozeTotal])

  const pctColor = (done: number, total: number) => {
    if (total === 0) return 'bg-gray-300'
    const p = done / total
    if (p >= 1) return 'bg-green-500'
    if (p >= 0.6) return 'bg-[#003399]'
    if (p >= 0.3) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const roomTabCls = (active: boolean) =>
    `px-3.5 py-1.5 rounded-lg text-xs font-black transition-all ${active ? 'bg-[#003399] text-white shadow' : 'bg-gray-50 border-2 border-gray-200 text-gray-600 hover:border-[#003399]/40'}`

  // ── สถานะก่อนเข้าถึง ──
  if (status === 'loading') return <Centered>⏳ กำลังตรวจสอบสิทธิ์...</Centered>
  if (status !== 'authenticated')
    return <Centered>กรุณาเข้าสู่ระบบก่อน<br /><a href="/login" className="text-[#003399] underline mt-2 inline-block">ไปหน้า Login</a></Centered>
  if (!isAdmin)
    return (
      <Centered>
        <div className="text-4xl mb-3">⛔</div>
        บัญชีนี้ไม่มีสิทธิ์เข้าหน้า Admin
        <div className="text-xs text-gray-400 mt-1 font-medium">{email || '(ไม่พบอีเมล)'}</div>
        <a href="/" className="text-[#003399] underline mt-3 inline-block">← กลับหน้าหลัก</a>
      </Centered>
    )

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-16">
      {/* Header */}
      <div className="bg-[#003399] text-white">
        <div className="max-w-5xl mx-auto px-5 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight">📊 Admin — ความก้าวหน้านักเรียน</h1>
            <p className="text-[11px] text-white/70 font-medium mt-0.5">นับเฉพาะหัวข้อ Grammar (หน่วยย่อย) ที่ทำครบ 100% · ติดตามตามทะเบียนห้อง</p>
          </div>
          <a href="/" className="text-xs font-black bg-[#FFD700] text-[#003399] px-4 py-2 rounded-xl hover:bg-[#e6c200] transition-all">← กลับแอป</a>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 mt-5">
        {loading ? (
          <div className="text-center text-gray-400 font-bold py-20 animate-pulse">⏳ กำลังโหลดข้อมูลนักเรียน...</div>
        ) : error ? (
          <div className="text-center text-red-500 font-bold py-20">{error}</div>
        ) : (
          <>
            {/* เลือกห้อง */}
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-3 mb-4">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2 px-1">เลือกห้อง (ตามทะเบียน)</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setRoom('all'); setOnlyNotDone(false) }} className={roomTabCls(room === 'all')}>
                  ทั้งหมด ({computed.length})
                </button>
                {rosterRooms.map(r => (
                  <button key={r} onClick={() => { setRoom(r); setQuery('') }} className={roomTabCls(room === r)}>
                    ม.{r} ({rosterByRoom[r]?.length || 0})
                  </button>
                ))}
                {orphanAccounts.length > 0 && (
                  <button onClick={() => { setRoom('none'); setOnlyNotDone(false) }} className={roomTabCls(room === 'none')}>
                    ⚠️ ยังไม่จับคู่ ({orphanAccounts.length})
                  </button>
                )}
              </div>
              {room === 'none' && (
                <p className="text-[11px] text-amber-600 font-medium mt-2 px-1 leading-relaxed">
                  บัญชีเหล่านี้ยังไม่ได้ใส่ "ห้อง + เลขที่" ในชื่อ (หรือใส่ไม่ตรงทะเบียน) จึงจับคู่อัตโนมัติไม่ได้ — ให้นักเรียนแก้ชื่อเป็นรูปแบบ เช่น "No.16 M.6/2"
                </p>
              )}
            </div>

            {/* 🔴 ตรวจพบความขัดแย้ง — หลายบัญชีชนกันที่ห้อง-เลขที่เดียวกัน (สำคัญ ควรแก้ก่อนดูข้อมูลอื่น) */}
            {keyConflicts.length > 0 && (
              <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 mb-5">
                <p className="text-xs font-black text-red-700 uppercase tracking-widest mb-1">
                  🔴 พบความขัดแย้งการจับคู่ {keyConflicts.length} จุด — ควรตรวจสอบ
                </p>
                <p className="text-[11px] text-red-600 font-medium mb-3 leading-relaxed">
                  มีมากกว่า 1 บัญชีอ้างห้อง+เลขที่เดียวกัน อาจทำให้ระบบโชว์คะแนนผิดคน หรือข้อมูลกระจายอยู่คนละบัญชี
                </p>
                <div className="space-y-2.5">
                  {keyConflicts.map(({ key, accounts, likelyDuplicateAccount }) => (
                    <div key={key} className="bg-white border border-red-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-black text-gray-700">ม.{key.split('-')[0]} เลขที่ {key.split('-')[1]} — {accounts[0].officialName}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${likelyDuplicateAccount ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                          {likelyDuplicateAccount ? '🔁 น่าจะสมัครซ้ำ 2 อีเมล' : '⚠️ ชื่อไม่ตรงกัน — เช็กเลขที่ผิด'}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {accounts.map(a => (
                          <div key={a.email} className="flex items-center justify-between text-[10px] text-gray-500 font-medium pl-2">
                            <span className="truncate">{a.name} <span className="text-gray-300">·</span> {a.email}</span>
                            <span className="font-black text-gray-600 flex-shrink-0 ml-2">{a.completedCount}/{totalTopics} หัวข้อ</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* สรุปภาพรวม */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {isClassView ? (
                <>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{denom}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">นักเรียน ม.{room} (ทะเบียน)</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-green-600">{summary.active}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">เข้าทำแล้ว</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-amber-500">{Math.max(denom - summary.active, 0)}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">ยังไม่เข้าทำ</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{summary.active}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">{room === 'none' ? 'บัญชียังไม่จับคู่' : 'นักเรียนทั้งหมด'}</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-green-600">{summary.finishedAll}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">ครบทุกหัวข้อ ({totalTopics})</div>
                  </div>
                  <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 text-center">
                    <div className="text-3xl font-black text-[#003399]">{summary.avg.toFixed(1)}</div>
                    <div className="text-[11px] text-gray-500 font-bold mt-1">เฉลี่ยหัวข้อที่ครบ/คน</div>
                  </div>
                </>
              )}
            </div>

            {/* ภาพรวมรายหัวข้อ: มีกี่คนทำครบ */}
            <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5">
              <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                ภาพรวมรายหัวข้อ — ทำครบกี่คน {isClassView ? `(จาก ${denom} คนในห้อง)` : ''}
              </p>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
                {perTopic.map(pt => (
                  <div key={pt.topic}>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="font-bold text-gray-700">{pt.topic} <span className="text-gray-400 font-medium">({pt.total} ข้อ)</span></span>
                      <span className="font-black text-gray-600">{pt.done}/{denom} คน</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full ${pctColor(pt.done, denom)}`} style={{ width: `${denom > 0 ? (pt.done / denom) * 100 : 0}%` }} />
                    </div>
                    {pt.historyRounds > 0 && (
                      <div className="text-[10px] text-gray-400 font-medium mt-1">
                        📈 ค่าเฉลี่ยรอบที่เล่น {(pt.historyAvgPct * 100).toFixed(0)}% · {pt.historyRounds.toLocaleString('th-TH')} รอบ ({pt.historyStudents} คนเคยเล่น)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ภาพรวม Cloze Test / Error ID / Sentence Completion — ตัวเลขสดจาก Firestore (ทำครบไปแล้วกี่ข้อ) */}
            {(clozeTotal > 0 || errorTotal > 0 || scTotal > 0) && (
              <div className="bg-white border-2 border-gray-100 rounded-2xl p-4 mb-5">
                <p className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                  แบบฝึกเสริม — Cloze Test / Error ID / Sentence Completion {isClassView ? `(จาก ${denom} คนในห้อง)` : ''}
                </p>
                <div className="grid sm:grid-cols-3 gap-4">
                  {clozeTotal > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-black text-blue-700 text-xs">📝 Cloze Test</span>
                        <span className="font-black text-blue-700 text-xs">{extraSummary.cloze.finishedAll}/{denom}</span>
                      </div>
                      <div className="w-full bg-white rounded-full h-1.5 overflow-hidden mb-1.5">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(extraSummary.cloze.avgPctLive * 100, 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-blue-600 font-bold">
                        เฉลี่ยทำได้ {(extraSummary.cloze.avgPctLive * 100).toFixed(1)}% ของ {clozeTotal} ข้อ · {extraSummary.cloze.studentsStarted} คนเริ่มทำแล้ว
                      </div>
                    </div>
                  )}
                  {errorTotal > 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl px-3.5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-black text-purple-700 text-xs">🧩 Error Identification</span>
                        <span className="font-black text-purple-700 text-xs">{extraSummary.errorId.finishedAll}/{denom}</span>
                      </div>
                      <div className="w-full bg-white rounded-full h-1.5 overflow-hidden mb-1.5">
                        <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(extraSummary.errorId.avgPctLive * 100, 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-purple-600 font-bold">
                        เฉลี่ยทำได้ {(extraSummary.errorId.avgPctLive * 100).toFixed(1)}% ของ {errorTotal} ข้อ · {extraSummary.errorId.studentsStarted} คนเริ่มทำแล้ว
                      </div>
                      {extraSummary.errorId.history.rounds > 0 && (
                        <div className="text-[9px] text-purple-400 font-medium mt-1">ประวัติ (ถึง 3 ก.ค. ก่อนลดคลังข้อ): เฉลี่ยรอบละ {(extraSummary.errorId.history.avgPct * 100).toFixed(0)}% · เล่นไป {extraSummary.errorId.history.rounds} รอบ</div>
                      )}
                    </div>
                  )}
                  {scTotal > 0 && (
                    <div className="bg-pink-50 border border-pink-200 rounded-xl px-3.5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-black text-pink-700 text-xs">✏️ Sentence Completion</span>
                        <span className="font-black text-pink-700 text-xs">{extraSummary.sentenceCompletion.finishedAll}/{denom}</span>
                      </div>
                      <div className="w-full bg-white rounded-full h-1.5 overflow-hidden mb-1.5">
                        <div className="h-full rounded-full bg-pink-500" style={{ width: `${Math.min(extraSummary.sentenceCompletion.avgPctLive * 100, 100)}%` }} />
                      </div>
                      <div className="text-[10px] text-pink-600 font-bold">
                        เฉลี่ยทำได้ {(extraSummary.sentenceCompletion.avgPctLive * 100).toFixed(1)}% ของ {scTotal} ข้อ · {extraSummary.sentenceCompletion.studentsStarted} คนเริ่มทำแล้ว
                      </div>
                      {extraSummary.sentenceCompletion.history.rounds > 0 && (
                        <div className="text-[9px] text-pink-400 font-medium mt-1">ประวัติ (ถึง 3 ก.ค. ก่อนลดคลังข้อ): เฉลี่ยรอบละ {(extraSummary.sentenceCompletion.history.avgPct * 100).toFixed(0)}% · เล่นไป {extraSummary.sentenceCompletion.history.rounds} รอบ</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ค้นหา + เครื่องมือ */}
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={isClassView ? '🔍 ค้นหาชื่อ / เลขที่...' : '🔍 ค้นหาชื่อ / อีเมลนักเรียน...'}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-medium focus:border-[#003399] outline-none"
              />
              {isClassView ? (
                <button
                  onClick={() => setOnlyNotDone(v => !v)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-black transition-all whitespace-nowrap ${onlyNotDone ? 'bg-amber-500 text-white' : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                >⬜ เฉพาะยังไม่เข้าทำ</button>
              ) : (
                <div className="flex gap-1.5">
                  {([['completed', 'หัวข้อที่ครบ'], ['recent', 'ล่าสุด'], ['name', 'ชื่อ']] as const).map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSortBy(k)}
                      className={`px-3 py-2.5 rounded-xl text-xs font-black transition-all ${sortBy === k ? 'bg-[#003399] text-white' : 'bg-white border-2 border-gray-200 text-gray-500 hover:border-gray-300'}`}
                    >{label}</button>
                  ))}
                </div>
              )}
            </div>

            {/* ───── มุมมองห้อง: รายชื่อทะเบียนทั้งห้อง ───── */}
            {isClassView ? (
              <>
                {notDoneList.length > 0 && !onlyNotDone && (
                  <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-3 mb-3">
                    <p className="text-xs font-black text-amber-700 mb-1">⬜ ยังไม่เข้าทำ {notDoneList.length} คน</p>
                    <p className="text-[11px] text-amber-600 font-medium leading-relaxed">
                      {notDoneList.map(r => `${r.entry.no}. ${r.entry.name}`).join('  ·  ')}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {filteredClassRows.length === 0 && (
                    <div className="text-center text-gray-400 font-bold py-12 bg-white rounded-2xl border-2 border-gray-100">
                      {onlyNotDone ? '🎉 ทุกคนเข้าทำแล้ว' : 'ไม่พบนักเรียน'}
                    </div>
                  )}
                  {filteredClassRows.map(({ entry, acc }) => (
                    <div key={entry.no} className={`rounded-xl border-2 p-3 ${acc ? 'bg-white border-gray-100' : 'bg-gray-50 border-dashed border-gray-200'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs flex-shrink-0 ${acc ? 'bg-[#003399] text-[#FFD700]' : 'bg-gray-200 text-gray-400'}`}>
                            {entry.no}
                          </div>
                          <div className="min-w-0">
                            <div className={`font-black text-sm truncate ${acc ? 'text-gray-900' : 'text-gray-400'}`}>
                              {entry.name}
                              {acc?.matchedBy === 'name' && (
                                <span className="ml-1 text-[9px] font-black text-amber-600 bg-amber-50 px-1 py-0.5 rounded" title="จับคู่จากชื่อไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">🔤</span>
                              )}
                              {acc?.matchedBy === 'name-fuzzy' && (
                                <span className="ml-1 text-[9px] font-black text-orange-600 bg-orange-50 px-1 py-0.5 rounded" title="ชื่อไทยไม่ตรงเป๊ะ (อาจพิมพ์ผิด/สะกดคลาดเคลื่อน) จับคู่ด้วยความคล้าย — ควรตรวจทาน">🔤~</span>
                              )}
                              {acc?.matchedBy === 'first-name' && (
                                <span className="ml-1 text-[9px] font-black text-cyan-700 bg-cyan-50 px-1 py-0.5 rounded" title="พิมพ์แค่ชื่อจริง ไม่ใส่นามสกุล — จับคู่เพราะไม่ซ้ำกับใครในห้องนี้ ควรตรวจทาน">✂️</span>
                              )}
                              {acc?.matchedBy === 'roman' && (
                                <span className="ml-1 text-[9px] font-black text-teal-600 bg-teal-50 px-1 py-0.5 rounded" title="จับคู่จากชื่ออังกฤษเทียบทับศัพท์ไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">🌐</span>
                              )}
                              {acc?.matchedBy === 'name-global' && (
                                <span className="ml-1 text-[9px] font-black text-purple-600 bg-purple-50 px-1 py-0.5 rounded" title="ไม่พบห้องในชื่อที่กรอกเลย จึงค้นชื่อไทยข้ามทุกห้องแทน — ควรตรวจทานเป็นพิเศษ">🌏</span>
                              )}
                              {acc?.matchedBy === 'roman-global' && (
                                <span className="ml-1 text-[9px] font-black text-rose-600 bg-rose-50 px-1 py-0.5 rounded" title="ไม่พบห้องเลย + ชื่อเป็นอังกฤษ จึงค้นทับศัพท์ข้ามทุกห้อง (เกณฑ์เข้มสุด) — ควรตรวจทานเป็นพิเศษ">🌐🌏</span>
                              )}
                              {acc?.matchedBy === 'override' && (
                                <span className="ml-1 text-[9px] font-black text-green-700 bg-green-50 px-1 py-0.5 rounded" title="ยืนยันตัวตนด้วยมือแล้ว (จำถาวร ไม่ว่าจะเปลี่ยนชื่อในแอปยังไงก็จับคู่ถูกคนเสมอ)">✅</span>
                              )}
                            </div>
                            {acc ? (
                              <div className="text-[10px] text-gray-400 font-medium truncate">{acc.email} · 🕒 {timeAgo(acc.updatedAt) || fmtTime(acc.updatedAt)}</div>
                            ) : (
                              <div className="text-[10px] text-gray-400 font-bold">ยังไม่เข้าทำ</div>
                            )}
                          </div>
                        </div>
                        {acc ? (
                          <div className={`text-xs font-black px-2.5 py-1 rounded-lg text-white flex-shrink-0 ${pctColor(acc.completedCount, totalTopics)}`}>
                            {acc.completedCount}/{totalTopics}
                          </div>
                        ) : (
                          <div className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-gray-200 text-gray-500 flex-shrink-0">⬜ ยังไม่เข้า</div>
                        )}
                      </div>
                      {acc && acc.completed.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2 pl-11">
                          {acc.completed.map(t => (
                            <span key={t} className="text-[9px] font-black px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">✓ {t}</span>
                          ))}
                        </div>
                      )}
                      {acc && (acc.clozeDone > 0 || acc.errorDone > 0 || acc.scDone > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1 pl-11">
                          {acc.clozeDone > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">📝 Cloze {acc.clozeDone}/{clozeTotal}</span>
                          )}
                          {acc.errorDone > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200">🧩 Error ID {acc.errorDone}/{errorTotal}</span>
                          )}
                          {acc.scDone > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 border border-pink-200">✏️ Sentence {acc.scDone}/{scTotal}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ───── มุมมอง ทั้งหมด / ยังไม่จับคู่: การ์ดบัญชี ───── */
              <div className="space-y-3">
                {filteredAccounts.length === 0 && (
                  <div className="text-center text-gray-400 font-bold py-12 bg-white rounded-2xl border-2 border-gray-100">ไม่พบนักเรียน</div>
                )}
                {filteredAccounts.map((s, i) => (
                  <div key={s.email} className="bg-white border-2 border-gray-100 rounded-2xl p-4">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[#003399] text-[#FFD700] flex items-center justify-center font-black flex-shrink-0">
                          {sortBy === 'completed' ? i + 1 : ((s.officialName || s.name)[0] || '?').toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-black text-gray-900 text-sm truncate">
                            {s.officialName || s.name}
                            {s.officialName && s.key && (
                              <span className="ml-1.5 text-[10px] font-black text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">
                                ม.{s.key.split('-')[0]} เลขที่ {s.key.split('-')[1]}
                              </span>
                            )}
                            {s.matchedBy === 'name' && (
                              <span className="ml-1 text-[10px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded" title="จับคู่จากชื่อไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">
                                🔤 จับคู่จากชื่อไทย
                              </span>
                            )}
                            {s.matchedBy === 'name-fuzzy' && (
                              <span className="ml-1 text-[10px] font-black text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded" title="ชื่อไทยไม่ตรงเป๊ะ (อาจพิมพ์ผิด/สะกดคลาดเคลื่อน) จับคู่ด้วยความคล้าย — ควรตรวจทาน">
                                🔤~ ชื่อไทยใกล้เคียง
                              </span>
                            )}
                            {s.matchedBy === 'first-name' && (
                              <span className="ml-1 text-[10px] font-black text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded" title="พิมพ์แค่ชื่อจริง ไม่ใส่นามสกุล — จับคู่เพราะไม่ซ้ำกับใครในห้องนี้ ควรตรวจทาน">
                                ✂️ ชื่อจริงอย่างเดียว
                              </span>
                            )}
                            {s.matchedBy === 'roman' && (
                              <span className="ml-1 text-[10px] font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded" title="จับคู่จากชื่ออังกฤษเทียบทับศัพท์ไทย เพราะไม่พบเลขที่ในชื่อที่กรอก — ควรตรวจทาน">
                                🌐 จับคู่จากชื่อทับศัพท์
                              </span>
                            )}
                            {s.matchedBy === 'name-global' && (
                              <span className="ml-1 text-[10px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded" title="ไม่พบห้องในชื่อที่กรอกเลย จึงค้นชื่อไทยข้ามทุกห้องแทน — ควรตรวจทานเป็นพิเศษ">
                                🌏 จับคู่ข้ามห้อง
                              </span>
                            )}
                            {s.matchedBy === 'roman-global' && (
                              <span className="ml-1 text-[10px] font-black text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded" title="ไม่พบห้องเลย + ชื่อเป็นอังกฤษ จึงค้นทับศัพท์ข้ามทุกห้อง (เกณฑ์เข้มสุด) — ควรตรวจทานเป็นพิเศษ">
                                🌐🌏 ทับศัพท์ข้ามห้อง
                              </span>
                            )}
                            {s.matchedBy === 'override' && (
                              <span className="ml-1 text-[10px] font-black text-green-700 bg-green-50 px-1.5 py-0.5 rounded" title="ยืนยันตัวตนด้วยมือแล้ว (จำถาวร ไม่ว่าจะเปลี่ยนชื่อในแอปยังไงก็จับคู่ถูกคนเสมอ)">
                                ✅ ยืนยันแล้ว
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 font-medium truncate">
                            {s.email}{s.officialName ? ` · (${s.name})` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {!s.officialName && (
                          <button
                            onClick={() => handleOpenLink(s.email)}
                            className="text-[10px] font-black px-2.5 py-1.5 rounded-lg bg-[#003399] text-[#FFD700] hover:bg-[#002266] transition-all whitespace-nowrap mb-1"
                          >🔗 จับคู่มือ</button>
                        )}
                        {s.matchedBy === 'override' && (
                          <button
                            onClick={() => handleUnlink(s.email)}
                            className="text-[9px] font-bold text-gray-400 hover:text-red-500 underline block mb-1 ml-auto"
                          >ยกเลิกการจับคู่</button>
                        )}
                        <div className={`text-sm font-black px-3 py-1 rounded-lg text-white ${pctColor(s.completedCount, totalTopics)}`}>
                          {s.completedCount} / {totalTopics} หัวข้อ
                        </div>
                        <div className="text-[10px] text-gray-400 font-bold mt-1" title={fmtTime(s.updatedAt)}>
                          🕒 {timeAgo(s.updatedAt) || fmtTime(s.updatedAt)}
                        </div>
                      </div>
                    </div>

                    {/* แถบสัดส่วน */}
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden mb-2.5">
                      <div className={`h-full rounded-full transition-all ${pctColor(s.completedCount, totalTopics)}`} style={{ width: `${totalTopics > 0 ? (s.completedCount / totalTopics) * 100 : 0}%` }} />
                    </div>

                    {/* เฉพาะหัวข้อที่ครบ 100% เท่านั้น */}
                    {s.completed.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {s.completed.map(t => (
                          <span key={t} className="text-[10px] font-black px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200">
                            ✓ {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 font-bold italic">ยังไม่มีหัวข้อที่ครบ 100%</div>
                    )}

                    {/* หัวข้อที่กำลังฝึกฝน (มี log ย้อนหลัง แต่ยังไม่ครบ 100%) */}
                    {Object.keys(s.topicHistory).filter(t => !s.completed.includes(t)).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {Object.entries(s.topicHistory)
                          .filter(([t]) => !s.completed.includes(t))
                          .sort((a, b) => b[1].avgPct - a[1].avgPct)
                          .map(([t, h]) => (
                            <span key={t} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                              📈 {t} · เฉลี่ย {(h.avgPct * 100).toFixed(0)}% ({h.rounds} รอบ)
                            </span>
                          ))}
                      </div>
                    )}

                    {(s.clozeDone > 0 || s.errorDone > 0 || s.scDone > 0 || s.extra.errorId || s.extra.sentenceCompletion) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {s.clozeDone > 0 && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                            📝 Cloze · {s.clozeDone}/{clozeTotal} ข้อ ({clozeTotal > 0 ? Math.round(s.clozeDone / clozeTotal * 100) : 0}%)
                          </span>
                        )}
                        {(s.errorDone > 0 || s.extra.errorId) && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-200">
                            🧩 Error ID · {s.errorDone}/{errorTotal} ข้อ ({errorTotal > 0 ? Math.round(s.errorDone / errorTotal * 100) : 0}%)
                            {s.extra.errorId && <span className="text-purple-400"> · เคยเล่น {s.extra.errorId.rounds} รอบ</span>}
                          </span>
                        )}
                        {(s.scDone > 0 || s.extra.sentenceCompletion) && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-pink-50 text-pink-700 border border-pink-200">
                            ✏️ Sentence · {s.scDone}/{scTotal} ข้อ ({scTotal > 0 ? Math.round(s.scDone / scTotal * 100) : 0}%)
                            {s.extra.sentenceCompletion && <span className="text-pink-400"> · เคยเล่น {s.extra.sentenceCompletion.rounds} รอบ</span>}
                          </span>
                        )}
                      </div>
                    )}

                    <div className="text-[10px] text-gray-400 font-medium mt-2">เข้าทำล่าสุด: {fmtTime(s.updatedAt)} · ทำไปทั้งหมด {s.totalRounds} รอบ</div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-center text-[10px] text-gray-300 font-medium mt-6">
              ข้อมูลคำนวณสดจากคลังข้อสอบ ({totalTopics} หัวข้อ) · จับคู่ทะเบียนด้วยห้อง+เลขที่จากชื่อที่นักเรียนกรอก — แสดงเฉพาะหัวข้อ Grammar ที่ครบ 100%
            </p>
          </>
        )}
      </div>

      {/* 🔗 Modal จับคู่มือ — เลือกนักเรียนจากทะเบียนให้บัญชีที่จับคู่อัตโนมัติไม่ได้ */}
      {linkingAccount && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={handleCloseLink}>
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-t-[10px] border-[#003399] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b-2 border-gray-50 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-[#003399]">🔗 จับคู่มือ</div>
                <div className="text-xs text-gray-500 font-medium truncate mt-0.5">{linkingAccount.name} · {linkingAccount.email}</div>
              </div>
              <button onClick={handleCloseLink} className="flex-shrink-0 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 font-black text-xs flex items-center justify-center">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-gray-50">
              <input
                autoFocus
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
                placeholder="🔍 ค้นหาชื่อ / ห้อง / เลขที่..."
                className="w-full px-3.5 py-2.5 rounded-xl border-2 border-gray-200 text-sm font-medium focus:border-[#003399] outline-none"
              />
              {linkError && <p className="text-[11px] text-red-500 font-bold mt-2">{linkError}</p>}
            </div>

            <div className="overflow-y-auto px-3 py-2 flex-1">
              {linkCandidates.length === 0 && (
                <p className="text-center text-xs text-gray-400 font-bold py-8">ไม่พบชื่อที่ตรงกับที่ค้นหา</p>
              )}
              {linkCandidates.map(entry => {
                const takenBy = accountByKey[`${entry.room}-${entry.no}`]
                return (
                  <button
                    key={`${entry.room}-${entry.no}`}
                    disabled={linkSaving}
                    onClick={() => handleConfirmLink(entry)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl hover:bg-blue-50 transition-all flex items-center justify-between gap-2 disabled:opacity-50"
                  >
                    <span className="text-sm font-bold text-gray-800 truncate">{entry.name}</span>
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px] font-black text-[#003399] bg-blue-50 px-1.5 py-0.5 rounded">ม.{entry.room} #{entry.no}</span>
                      {takenBy && <span className="text-[9px] font-bold text-amber-600" title={`ตอนนี้จับคู่กับ ${takenBy.email} อยู่`}>⚠️ มีคนแล้ว</span>}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="px-5 py-3 border-t border-gray-50 text-[10px] text-gray-400 font-medium">
              {linkSaving ? '⏳ กำลังบันทึก...' : 'กดเลือกชื่อเพื่อยืนยันจับคู่ทันที — จำถาวร ไม่ต้องทำซ้ำ'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
