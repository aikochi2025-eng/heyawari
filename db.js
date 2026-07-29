const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const { getRoomCapacity } = require('./logic/roomMaster');

// ローカル開発時は data/db.sqlite にファイル保存。
// 本番(Turso利用時)は環境変数 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を使う。
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const url = process.env.TURSO_DATABASE_URL || `file:${path.join(dataDir, 'db.sqlite')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient(authToken ? { url, authToken } : { url });

async function init() {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS reservations (
      reservation_id TEXT PRIMARY KEY,
      reservation_no TEXT,
      checkin TEXT,
      checkout TEXT,
      nights INTEGER,
      site TEXT,
      room_type_name TEXT,
      plan_name TEXT,
      room_count INTEGER,
      guest_name TEXT,
      adults INTEGER,
      children INTEGER,
      infants INTEGER,
      meal TEXT,
      total_amount INTEGER,
      other_details TEXT,
      uploaded_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS assignments (
      date TEXT,
      room_no INTEGER,
      reservation_id TEXT,
      guest_name TEXT,
      site TEXT,
      amount INTEGER,
      plan_label TEXT,
      plan_name_raw TEXT,
      adults INTEGER,
      children INTEGER,
      infants INTEGER,
      memo TEXT,
      checkin TEXT,
      checkout TEXT,
      nights INTEGER,
      needs_review INTEGER DEFAULT 0,
      review_reason TEXT,
      group_key TEXT,
      is_continuing INTEGER DEFAULT 0,
      is_manual INTEGER DEFAULT 0,
      updated_at TEXT,
      PRIMARY KEY (date, room_no)
    )`,
    `CREATE TABLE IF NOT EXISTS issues (
      date TEXT,
      seq INTEGER,
      type TEXT,
      message TEXT,
      room_nos TEXT,
      PRIMARY KEY (date, seq)
    )`,
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )`,
  ], 'write');
  // 既存DBに対する簡易マイグレーション（列が無ければ追加。既にあればエラーを無視）
  const migrations = [
    `ALTER TABLE reservations ADD COLUMN other_details TEXT`,
    `ALTER TABLE assignments ADD COLUMN memo TEXT`,
  ];
  for (const sql of migrations) {
    try { await client.execute(sql); } catch (e) { /* 既に列がある場合は無視 */ }
  }
}

async function upsertReservations(records) {
  const stmts = records.map((r) => ({
    sql: `INSERT INTO reservations
      (reservation_id, reservation_no, checkin, checkout, nights, site, room_type_name, plan_name, room_count, guest_name, adults, children, infants, meal, total_amount, other_details, uploaded_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(reservation_id) DO UPDATE SET
        reservation_no=excluded.reservation_no, checkin=excluded.checkin, checkout=excluded.checkout,
        nights=excluded.nights, site=excluded.site, room_type_name=excluded.room_type_name,
        plan_name=excluded.plan_name, room_count=excluded.room_count, guest_name=excluded.guest_name,
        adults=excluded.adults, children=excluded.children, infants=excluded.infants, meal=excluded.meal,
        total_amount=excluded.total_amount, other_details=excluded.other_details, uploaded_at=excluded.uploaded_at`,
    args: [
      r.reservationId, r.reservationNo, r.checkin.replace(/\//g, '-'), r.checkout.replace(/\//g, '-'), r.nights,
      r.site, r.roomTypeName, r.planName, r.roomCount, r.guestName, r.adults, r.children, r.infants,
      r.meal, r.totalAmount, r.otherDetails || '', new Date().toISOString(),
    ],
  }));
  if (stmts.length) await client.batch(stmts, 'write');
}

// キャンセルされた予約IDについて、予約マスタから削除し、既存の割当(全日付)を即時空室化する。
// 戻り値: 実際に空室化された(部屋に割り当てられていた)予約の一覧
async function cancelReservations(reservationIds) {
  const affected = [];
  for (const id of reservationIds) {
    const existing = await client.execute({
      sql: `SELECT date, room_no, guest_name FROM assignments WHERE reservation_id = ?`,
      args: [id],
    });
    for (const row of existing.rows) {
      affected.push({ date: row.date, roomNo: row.room_no, guestName: row.guest_name });
    }
    await client.batch([
      { sql: `DELETE FROM assignments WHERE reservation_id = ?`, args: [id] },
      { sql: `DELETE FROM reservations WHERE reservation_id = ?`, args: [id] },
    ], 'write');
  }
  return affected;
}

async function getActiveReservations(dateStr) {
  const res = await client.execute({
    sql: `SELECT * FROM reservations WHERE checkin <= ? AND checkout > ? ORDER BY checkin`,
    args: [dateStr, dateStr],
  });
  return res.rows.map(rowToReservation);
}

function rowToReservation(row) {
  return {
    reservationId: row.reservation_id,
    reservationNo: row.reservation_no,
    checkin: row.checkin,
    checkout: row.checkout,
    nights: row.nights,
    site: row.site,
    roomTypeName: row.room_type_name,
    planName: row.plan_name,
    roomCount: row.room_count,
    guestName: row.guest_name,
    adults: row.adults,
    children: row.children,
    infants: row.infants,
    meal: row.meal,
    totalAmount: row.total_amount,
    otherDetails: row.other_details,
  };
}

// 指定reservationIdについて、date より前で最新の割当(部屋番号)を取得
async function getLastKnownRoom(reservationId, beforeDate) {
  const res = await client.execute({
    sql: `SELECT room_no, date FROM assignments WHERE reservation_id = ? AND date < ? ORDER BY date DESC LIMIT 1`,
    args: [reservationId, beforeDate],
  });
  if (res.rows.length === 0) return null;
  return res.rows[0].room_no;
}

async function getAssignmentsForDate(dateStr) {
  const res = await client.execute({ sql: `SELECT * FROM assignments WHERE date = ? ORDER BY room_no`, args: [dateStr] });
  const rooms = {};
  for (const row of res.rows) {
    rooms[row.room_no] = {
      roomNo: row.room_no,
      reservationId: row.reservation_id,
      guestName: row.guest_name,
      site: row.site,
      amount: row.amount,
      planLabel: row.plan_label,
      planNameRaw: row.plan_name_raw,
      adults: row.adults,
      children: row.children,
      infants: row.infants,
      memo: row.memo,
      checkin: row.checkin,
      checkout: row.checkout,
      nights: row.nights,
      needsReview: !!row.needs_review,
      reviewReason: row.review_reason,
      groupKey: row.group_key,
      isContinuing: !!row.is_continuing,
      isManual: !!row.is_manual,
    };
  }
  const issuesRes = await client.execute({ sql: `SELECT * FROM issues WHERE date = ? ORDER BY seq`, args: [dateStr] });
  const issues = issuesRes.rows.map((r) => ({ type: r.type, message: r.message, roomNos: JSON.parse(r.room_nos || '[]') }));
  return { rooms, issues };
}

async function saveAssignments(dateStr, rooms, issues, { preserveManual = true } = {}) {
  let existingManual = {};
  if (preserveManual) {
    const res = await client.execute({ sql: `SELECT room_no FROM assignments WHERE date = ? AND is_manual = 1`, args: [dateStr] });
    existingManual = new Set(res.rows.map((r) => r.room_no));
  }
  const stmts = [];
  for (const [roomNoStr, cell] of Object.entries(rooms)) {
    const roomNo = parseInt(roomNoStr, 10);
    if (preserveManual && existingManual.has && existingManual.has(roomNo)) continue;
    stmts.push({
      sql: `INSERT INTO assignments
        (date, room_no, reservation_id, guest_name, site, amount, plan_label, plan_name_raw, adults, children, infants, memo, checkin, checkout, nights, needs_review, review_reason, group_key, is_continuing, is_manual, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
        ON CONFLICT(date, room_no) DO UPDATE SET
          reservation_id=excluded.reservation_id, guest_name=excluded.guest_name, site=excluded.site,
          amount=excluded.amount, plan_label=excluded.plan_label, plan_name_raw=excluded.plan_name_raw,
          adults=excluded.adults, children=excluded.children, infants=excluded.infants, memo=excluded.memo,
          checkin=excluded.checkin, checkout=excluded.checkout, nights=excluded.nights,
          needs_review=excluded.needs_review, review_reason=excluded.review_reason,
          group_key=excluded.group_key, is_continuing=excluded.is_continuing, updated_at=excluded.updated_at`,
      args: [
        dateStr, roomNo, cell.reservationId || null, cell.guestName || null, cell.site || null,
        cell.amount || 0, cell.planLabel || null, cell.planNameRaw || null,
        cell.adults || 0, cell.children || 0, cell.infants || 0, cell.memo || null,
        cell.checkin || null, cell.checkout || null, cell.nights || 0,
        cell.needsReview ? 1 : 0, cell.reviewReason || null, cell.groupKey || null,
        cell.isContinuing ? 1 : 0, new Date().toISOString(),
      ],
    });
  }
  stmts.push({ sql: `DELETE FROM issues WHERE date = ?`, args: [dateStr] });
  issues.forEach((issue, i) => {
    stmts.push({
      sql: `INSERT INTO issues (date, seq, type, message, room_nos) VALUES (?,?,?,?,?)`,
      args: [dateStr, i, issue.type, issue.message, JSON.stringify(issue.roomNos || [])],
    });
  });
  if (stmts.length) await client.batch(stmts, 'write');
}

// 合計人数の上限(cap.total)がある部屋(RV等)向け：超過分を幼児→子供→大人の順で減らす
function applyTotalCap(adults, children, infants, cap) {
  if (!cap.total) return { adults, children, infants };
  let a = adults, c = children, i = infants;
  let over = a + c + i - cap.total;
  if (over > 0) { const d = Math.min(i, over); i -= d; over -= d; }
  if (over > 0) { const d = Math.min(c, over); c -= d; over -= d; }
  if (over > 0) { const d = Math.min(a, over); a -= d; over -= d; }
  return { adults: a, children: c, infants: i };
}

async function updateCellManual(dateStr, roomNo, fields) {
  const cap = getRoomCapacity(roomNo);
  const clamp = (v, max) => (v === undefined ? undefined : Math.max(0, Math.min(parseInt(v, 10) || 0, max)));
  let adults = clamp(fields.adults, cap.adults);
  let children = clamp(fields.children, cap.children);
  let infants = clamp(fields.infants, cap.infants);

  const existing = await client.execute({ sql: `SELECT * FROM assignments WHERE date=? AND room_no=?`, args: [dateStr, roomNo] });
  const now = new Date().toISOString();
  if (existing.rows.length === 0) {
    ({ adults, children, infants } = applyTotalCap(adults || 0, children || 0, infants || 0, cap));
    await client.execute({
      sql: `INSERT INTO assignments (date, room_no, guest_name, site, amount, plan_label, adults, children, infants, memo, needs_review, review_reason, is_manual, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      args: [
        dateStr, roomNo, fields.guestName || null, fields.site || null, fields.amount || 0, fields.planLabel || null,
        adults || 0, children || 0, infants || 0, fields.memo || null,
        fields.needsReview ? 1 : 0, fields.reviewReason || null, now,
      ],
    });
  } else {
    const cur = existing.rows[0];
    const effAdults = adults !== undefined ? adults : cur.adults;
    const effChildren = children !== undefined ? children : cur.children;
    const effInfants = infants !== undefined ? infants : cur.infants;
    const capped = applyTotalCap(effAdults || 0, effChildren || 0, effInfants || 0, cap);
    await client.execute({
      sql: `UPDATE assignments SET guest_name=?, site=?, amount=?, plan_label=?, adults=?, children=?, infants=?, memo=?, needs_review=?, review_reason=?, is_manual=1, updated_at=? WHERE date=? AND room_no=?`,
      args: [
        fields.guestName !== undefined ? fields.guestName : cur.guest_name,
        fields.site !== undefined ? fields.site : cur.site,
        fields.amount !== undefined ? fields.amount : cur.amount,
        fields.planLabel !== undefined ? fields.planLabel : cur.plan_label,
        capped.adults,
        capped.children,
        capped.infants,
        fields.memo !== undefined ? fields.memo : cur.memo,
        fields.needsReview !== undefined ? (fields.needsReview ? 1 : 0) : cur.needs_review,
        fields.reviewReason !== undefined ? fields.reviewReason : cur.review_reason,
        now, dateStr, roomNo,
      ],
    });
  }
}

async function clearCell(dateStr, roomNo) {
  await client.execute({ sql: `DELETE FROM assignments WHERE date=? AND room_no=?`, args: [dateStr, roomNo] });
}

async function listDatesWithReservations() {
  const res = await client.execute(`SELECT DISTINCT checkin FROM reservations ORDER BY checkin`);
  return res.rows.map((r) => r.checkin);
}

async function listDatesWithAssignments() {
  const res = await client.execute(`SELECT DISTINCT date FROM assignments ORDER BY date`);
  return res.rows.map((r) => r.date);
}

module.exports = {
  init,
  upsertReservations,
  cancelReservations,
  getActiveReservations,
  getLastKnownRoom,
  getAssignmentsForDate,
  saveAssignments,
  updateCellManual,
  clearCell,
  listDatesWithReservations,
  listDatesWithAssignments,
};
