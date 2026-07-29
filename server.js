const express = require('express');
const multer = require('multer');
const path = require('path');

const db = require('./db');
const { parseNeppanCsv, listCheckinDates } = require('./logic/csvParse');
const { generateForDate } = require('./logic/generate');
const { buildWorkbook } = require('./logic/excelExport');
const { PLAN_LABELS } = require('./logic/classify');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// 部屋番号は通常は数値だが、RVのように文字列のIDも存在する
function parseRoomId(v) {
  const n = parseInt(v, 10);
  return String(n) === v ? n : v;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
    const records = parseNeppanCsv(req.file.buffer);
    const reservationsOnly = records.filter((r) => r.kubun === '予約');
    await db.upsertReservations(reservationsOnly);

    // キャンセル行を検出し、既存の割当があれば即時空室化する
    const cancelledIds = records.filter((r) => r.kubun === 'キャンセル').map((r) => r.reservationId).filter(Boolean);
    const vacated = cancelledIds.length ? await db.cancelReservations(cancelledIds) : [];

    const dates = listCheckinDates(records);
    res.json({ ok: true, count: reservationsOnly.length, dates, cancelledCount: cancelledIds.length, vacated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dates', async (req, res) => {
  try {
    const a = await db.listDatesWithReservations();
    const b = await db.listDatesWithAssignments();
    const set = new Set([...a, ...b]);
    res.json({ dates: Array.from(set).sort() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate/:date', async (req, res) => {
  try {
    const force = req.query.force === '1';
    const result = await generateForDate(req.params.date, { force });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/assignments/:date', async (req, res) => {
  try {
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/assignments/:date/:roomNo', async (req, res) => {
  try {
    await db.updateCellManual(req.params.date, parseRoomId(req.params.roomNo), req.body || {});
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assignments/:date/:roomNo', async (req, res) => {
  try {
    await db.clearCell(req.params.date, parseRoomId(req.params.roomNo));
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3日間ビュー(印刷向け)用に、開始日から指定日数分をまとめて取得する
app.get('/api/assignments-range', async (req, res) => {
  try {
    const start = req.query.start;
    const days = parseInt(req.query.days, 10) || 3;
    const results = [];
    for (let i = 0; i < days; i++) {
      const dateStr = addDays(start, i);
      const data = await db.getAssignmentsForDate(dateStr);
      results.push({ date: dateStr, ...data });
    }
    res.json({ days: results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;
    const { rooms, issues } = await db.getAssignmentsForDate(dateStr);
    const wb = buildWorkbook({ dateStr, rooms, issues });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="heyawari_${dateStr}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/plan-labels', (req, res) => res.json({ labels: PLAN_LABELS }));

app.get('/api/health', (req, res) => res.json({ ok: true, today: today() }));

const PORT = process.env.PORT || 3000;

db.init().then(() => {
  app.listen(PORT, () => console.log(`自動部屋割り君 listening on :${PORT}`));
}).catch((e) => {
  console.error('DB init failed', e);
  process.exit(1);
});
