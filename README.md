# English Exam Master — ศูนย์สอบจำลอง

แอปสอบจำลองภาษาอังกฤษเสมือนจริง (NETSAT / TGAT / A-Level) จับเวลา + เฉลยไทย
ต่อยอดสแตกจาก vocab-master-v2 (Next.js 16 · React 19 · Tailwind 4 · Firebase 11)

- ล็อกอินด้วยอีเมล (ใช้ร่วมกับแอปคำศัพท์ → แต้ม/streak/อันดับเป็นระบบเดียวกัน)
- Firebase project: smart-vocab-master (ตั้งค่าฝังในโค้ด `app/lib/firebase.ts`)
- คลังข้อ NETSAT: `public/netsat-bank.json`

## รัน
```
npm install
npm run dev      # http://localhost:3000
npm run build
```

## สถานะ
- [x] Phase 1: คลังข้อ NETSAT (436 Error / 656 SC / 7 บทสั้น / 17 บทยาว)
- [x] Phase 2: หน้า hub + ล็อกอิน + อันดับรายสัปดาห์
- [ ] Phase 3: เครื่องประกอบชุดสอบ + หน้าสอบจับเวลา
- [ ] Phase 4: หน้าสรุปคะแนน + ทบทวนเฉลย
- [ ] Phase 5: เซฟผลลง Firestore + เชื่อม XP/อันดับ
- [ ] Phase 6: โหมดครู
