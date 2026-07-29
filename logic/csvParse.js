const iconv = require('iconv-lite');
const { parse } = require('csv-parse/sync');

// ねっぱんCSV（Shift_JIS/CP932）を読み込み、レコードの配列を返す
function parseNeppanCsv(buffer) {
  const text = iconv.decode(buffer, 'cp932');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
  });
  return records.map(normalizeRecord);
}

function normalizeRecord(r) {
  return {
    reservationId: r['予約ID'] || '',
    kubun: (r['予約区分'] || '').trim(), // 予約 / 変更 / キャンセル
    reservationNo: r['予約番号'] || '',
    checkin: (r['チェックイン日'] || '').trim(),
    checkout: (r['チェックアウト日'] || '').trim(),
    nights: parseInt(r['泊数'] || '0', 10) || 0,
    site: (r['予約サイト名称'] || '').trim(),
    roomTypeName: (r['部屋タイプ名称'] || '').trim(),
    planName: (r['商品プラン名称'] || '').trim(),
    roomCount: parseInt(r['室数'] || '1', 10) || 1,
    guestName: (r['宿泊者氏名'] || '').trim(),
    adults: parseInt(r['大人人数計'] || '0', 10) || 0,
    children: parseInt(r['子供人数計'] || '0', 10) || 0,
    infants: parseInt(r['幼児人数計'] || '0', 10) || 0,
    meal: (r['食事'] || '').trim(),
    totalAmount: parseInt((r['料金合計額'] || '0').replace(/[^0-9-]/g, ''), 10) || 0,
    memoField: (r['メモ'] || '').trim(), // CSVの「メモ」列（参考保持。表示には otherDetails を使用）
    otherDetails: (r['その他明細'] || '').trim(), // CSVのAN列。ユーザー指定によりこちらを部屋のメモ欄に反映する
    note1: (r['備考1'] || '').trim(),
    note2: (r['備考2'] || '').trim(),
  };
}

// チェックイン日(YYYY/MM/DD) で絞り込み、予約区分=予約のみ抽出
function filterByCheckinDate(records, dateStr /* 'YYYY-MM-DD' */) {
  const target = dateStr.replace(/-/g, '/');
  return records.filter((r) => r.kubun === '予約' && r.checkin === target);
}

// CSV内に存在するチェックイン日の一覧（予約のみ）を返す
function listCheckinDates(records) {
  const set = new Set();
  for (const r of records) {
    if (r.kubun === '予約' && r.checkin) set.add(r.checkin.replace(/\//g, '-'));
  }
  return Array.from(set).sort();
}

module.exports = { parseNeppanCsv, filterByCheckinDate, listCheckinDates };
