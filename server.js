const express = require('express');
const multer = require('multer');
const path = require('path');

const db = require('./db');
const { parseNeppanCsv, listCheckinDates } = require('./logic/csvParse');
const { generateForDate } = require('./logic/generate');
const { PLAN_LABELS } = require('./logic/classify');
const { MEAL_CATEGORIES } = require('./logic/mealItems');

const { currentStaff, requireAuth, login, logout } = require('./auth');

const app = express();
app.set('trust proxy', 1); // Render等のリバースプロキシ越しでもhttpsを判定できるようにする
app.use(express.json());

// ログイン不要で開けるのはログイン画面・認証API・ヘルスチェックだけ
const PUBLIC_API = new Set(['/login', '/logout', '/health']);

// 画面（index.html）はログイン済みの場合だけ返す。未ログインはログイン画面へ。
app.get(['/', '/index.html'], async (req, res) => {
  try {
    const staff = await currentStaff(req);
    if (!staff) return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (e) {
    res.status(500).send('エラーが発生しました');
  }
});

// 静的ファイル（ログイン画面・JS・CSS）。index.html は上のルートでのみ返す。
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.post('/api/login', login);
app.post('/api/logout', logout);

// /api 配下は、公開指定以外すべてログイン必須（予約の読み書きを含む）
app.use('/api', (req, res, next) => (PUBLIC_API.has(req.path) ? next() : requireAuth(req, res, next)));

app.get('/api/me', (req, res) => res.json({ username: req.staff.username, name: req.staff.display_name }));

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

// 注意: Express はルートを登録順にマッチするため、":roomNo" のような
// 汎用パラメータを含むルートは、"swap" や "lock-many" などの固定パスより
// 後に登録しないと、固定パスへのリクエストが ":roomNo" 側に誤って
// マッチしてしまう（例: PUT /api/assignments/2026-01-01/swap が
// roomNo="swap" として処理される）。そのため固定パスのルートを先に置く。

// フロア一括固定/解除
app.put('/api/assignments/:date/lock-many', async (req, res) => {
  try {
    const { roomNos, locked } = req.body || {};
    if (!Array.isArray(roomNos)) return res.status(400).json({ error: 'roomNosが必要です' });
    for (const rn of roomNos) {
      await db.setLocked(req.params.date, parseRoomId(rn), !!locked);
    }
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// タイルのドラッグ&ドロップ入れ替え
app.put('/api/assignments/:date/swap', async (req, res) => {
  try {
    const { roomA, roomB } = req.body || {};
    if (roomA === undefined || roomB === undefined) return res.status(400).json({ error: 'roomA / roomBが必要です' });
    await db.swapRooms(req.params.date, parseRoomId(roomA), parseRoomId(roomB));
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 固定(ロック)トグル。CSV再取込・自動生成で上書きされないようにする/戻す。
// 固定した瞬間に「何泊」が2泊以上なら、翌日以降にも同じ部屋番号で内容を反映・固定する。
app.put('/api/assignments/:date/:roomNo/lock', async (req, res) => {
  try {
    const locked = !!(req.body || {}).locked;
    const roomNo = parseRoomId(req.params.roomNo);
    await db.setLocked(req.params.date, roomNo, locked);
    let propagation = null;
    if (locked) {
      propagation = await db.propagateNightsForward(req.params.date, roomNo);
    }
    const result = await db.getAssignmentsForDate(req.params.date);
    res.json({ ...result, propagation });
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

app.get('/api/plan-labels', (req, res) => res.json({ labels: PLAN_LABELS }));
app.get('/api/meal-items', (req, res) => res.json({ categories: MEAL_CATEGORIES }));

app.get('/api/health', (req, res) => res.json({ ok: true, today: today() }));

module.exports = { app };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  db.init().then(() => {
    app.listen(PORT, () => console.log(`自動部屋割り君 listening on :${PORT}`));
  }).catch((e) => {
    console.error('DB init failed', e);
    process.exit(1);
  });
}
