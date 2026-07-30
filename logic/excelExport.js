const ExcelJS = require('exceljs');
const { FLOOR1_BLOCK_A, FLOOR1_BLOCK_B, FLOOR2_ROOMS, ROOM_401, ROOM_601, ROOM_RV } = require('./roomMaster');
const { ALL_MEAL_ITEMS } = require('./mealItems');

const COLOR = {
  header: 'FFDCE6F1',
  floor1: 'FFEAF1DD',
  floor2: 'FFDDEBF7',
  lockup: 'FFF2E2CE',
  rv: 'FFE6DFF2',
  review: 'FFFFF2CC',
  reviewBorder: 'FFFFC000',
  empty: 'FFF2F2F2',
  title: 'FF1F4E78',
};

function sheetNameForDate(dateStr) {
  // 'YYYY-MM-DD' -> 'M-D'
  const [, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  return `${m}-${d}`;
}

function fill(color) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}
function thinBorder() {
  const b = { style: 'thin', color: { argb: 'FFB7B7B7' } };
  return { top: b, left: b, bottom: b, right: b };
}

// 食事集計の列を決める。固定カウンター項目(mealItems.js)のうち実際に数量が
// 入っているものだけを、カテゴリ順で列にする。mealCountsが無い旧データ(移行前)は
// planLabelを1件分としてフォールバック表示する。
function buildMealColumns(rooms) {
  const used = new Set();
  Object.values(rooms).forEach((c) => {
    if (!c) return;
    const counts = c.mealCounts || {};
    const hasCounts = Object.keys(counts).length > 0 && Object.values(counts).some((v) => v);
    if (hasCounts) {
      Object.entries(counts).forEach(([k, v]) => { if (v) used.add(k); });
    } else if (c.planLabel) {
      used.add(c.planLabel);
    }
  });
  const known = ALL_MEAL_ITEMS.filter((i) => used.has(i));
  const unknown = Array.from(used).filter((i) => !ALL_MEAL_ITEMS.includes(i)).sort();
  return [...known, ...unknown];
}

// 指定した部屋・列(メニュー名)の集計人数を返す(旧データはplanLabelでフォールバック)
function mealCountFor(cell, menuName) {
  if (!cell) return 0;
  const counts = cell.mealCounts || {};
  const hasCounts = Object.keys(counts).length > 0 && Object.values(counts).some((v) => v);
  if (hasCounts) return counts[menuName] || 0;
  if (cell.planLabel === menuName) return (cell.adults || 0) + (cell.children || 0) || 1;
  return 0;
}

function roomLabel(roomNo, cell) {
  if (!cell) return '（空室）';
  return cell.guestName || '（空室）';
}

function buildWorkbook({ dateStr, rooms, issues }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = '自動部屋割り君';
  wb.created = new Date();
  const sheetName = sheetNameForDate(dateStr);
  const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: false }] });

  const dateObj = new Date(dateStr);
  const wdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = wdays[dateObj.getDay()];
  const titleText = `柏島ヴィレッジ　${dateStr.replace(/-/g, '/')}（${wd}）チェックイン 部屋割り表`;

  ws.mergeCells('A1:N1');
  const titleCell = ws.getCell('A1');
  titleCell.value = titleText;
  titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = fill(COLOR.title);
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 26;

  // ---- 食事集計表 ----
  let r = 3;
  ws.getCell(`A${r}`).value = '■ 食事集計';
  ws.getCell(`A${r}`).font = { bold: true };
  r += 1;
  const mealCols = buildMealColumns(rooms);
  const header = ['部屋', '名前', '大人', '子供', '幼児', ...mealCols, 'メモ', '要確認'];
  header.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = fill(COLOR.header);
    cell.border = thinBorder();
    cell.alignment = { horizontal: 'center' };
  });
  const headerRow = r;
  r += 1;

  const allRoomNos = [
    ROOM_401, ROOM_601, ROOM_RV,
    ...FLOOR1_BLOCK_A, ...FLOOR1_BLOCK_B,
    ...FLOOR2_ROOMS,
  ];
  const mealTotals = {};
  mealCols.forEach((m) => (mealTotals[m] = 0));

  for (const roomNo of allRoomNos) {
    const cell = rooms[roomNo];
    const rowIdx = r;
    ws.getCell(rowIdx, 1).value = roomNo;
    ws.getCell(rowIdx, 2).value = roomLabel(roomNo, cell);
    ws.getCell(rowIdx, 3).value = cell ? cell.adults : '';
    ws.getCell(rowIdx, 4).value = cell && cell.children ? cell.children : '';
    ws.getCell(rowIdx, 5).value = cell && cell.infants ? cell.infants : '';
    mealCols.forEach((m, i) => {
      const col = 6 + i;
      const n = mealCountFor(cell, m);
      if (n) {
        ws.getCell(rowIdx, col).value = n;
        mealTotals[m] += n;
      }
    });
    const memoColIdx = 6 + mealCols.length;
    const reviewColIdx = memoColIdx + 1;
    if (cell && cell.memo) {
      ws.getCell(rowIdx, memoColIdx).value = cell.memo.length > 30 ? `${cell.memo.slice(0, 30)}…` : cell.memo;
      ws.getCell(rowIdx, memoColIdx).note = cell.memo;
    }
    if (cell && cell.needsReview) {
      ws.getCell(rowIdx, reviewColIdx).value = '要確認';
    }
    for (let c2 = 1; c2 <= reviewColIdx; c2++) {
      const xc = ws.getCell(rowIdx, c2);
      xc.border = thinBorder();
      if (cell && cell.needsReview) {
        xc.fill = fill(COLOR.review);
      } else if (!cell) {
        xc.fill = fill(COLOR.empty);
      }
    }
    if (cell && cell.reviewReason) {
      ws.getCell(rowIdx, 2).note = cell.reviewReason;
    }
    r += 1;
  }
  const totalRow = r;
  ws.getCell(totalRow, 1).value = '合計';
  ws.getCell(totalRow, 1).font = { bold: true };
  mealCols.forEach((m, i) => {
    ws.getCell(totalRow, 6 + i).value = mealTotals[m];
    ws.getCell(totalRow, 4 + i).font = { bold: true };
  });
  r = totalRow + 2;

  // ---- 部屋割り図 ----
  ws.getCell(`A${r}`).value = '■ 部屋割り図';
  ws.getCell(`A${r}`).font = { bold: true };
  r += 1;
  ws.getCell(`A${r}`).value = '凡例:';
  ws.getCell(`B${r}`).value = '1階';
  ws.getCell(`B${r}`).fill = fill(COLOR.floor1);
  ws.getCell(`C${r}`).value = '2階';
  ws.getCell(`C${r}`).fill = fill(COLOR.floor2);
  ws.getCell(`D${r}`).value = '個室(401/601)';
  ws.getCell(`D${r}`).fill = fill(COLOR.lockup);
  ws.getCell(`E${r}`).value = 'RV';
  ws.getCell(`E${r}`).fill = fill(COLOR.rv);
  ws.getCell(`F${r}`).value = '要確認';
  ws.getCell(`F${r}`).fill = fill(COLOR.review);
  ws.getCell(`G${r}`).value = '空室';
  ws.getCell(`G${r}`).fill = fill(COLOR.empty);
  r += 2;

  function writeFloorGrid(title, roomSeq, floorColor) {
    ws.getCell(`A${r}`).value = title;
    ws.getCell(`A${r}`).font = { bold: true };
    r += 1;
    const numRow = r;
    const nameRow = r + 1;
    const siteRow = r + 2;
    const amountRow = r + 3;
    roomSeq.forEach((roomNo, idx) => {
      const col = idx + 1;
      if (roomNo === null) {
        ws.getCell(numRow, col).value = '納戸';
        ws.getCell(numRow, col).fill = fill('FFD9D9D9');
        for (const rowIdx of [numRow, nameRow, siteRow, amountRow]) {
          ws.getCell(rowIdx, col).fill = fill('FFD9D9D9');
          ws.getCell(rowIdx, col).border = thinBorder();
        }
        return;
      }
      const cell = rooms[roomNo];
      const bg = cell && cell.needsReview ? COLOR.review : (cell ? floorColor : COLOR.empty);
      ws.getCell(numRow, col).value = roomNo;
      ws.getCell(numRow, col).font = { bold: true };
      ws.getCell(nameRow, col).value = roomLabel(roomNo, cell);
      ws.getCell(siteRow, col).value = cell ? cell.site : '';
      ws.getCell(amountRow, col).value = cell ? cell.amount : '';
      if (cell && cell.amount) ws.getCell(amountRow, col).numFmt = '¥#,##0';
      for (const rowIdx of [numRow, nameRow, siteRow, amountRow]) {
        const xc = ws.getCell(rowIdx, col);
        xc.fill = fill(bg);
        xc.border = thinBorder();
        xc.alignment = { horizontal: 'center' };
      }
      if (cell && cell.reviewReason) {
        ws.getCell(nameRow, col).note = cell.reviewReason;
      } else if (cell && cell.memo) {
        ws.getCell(nameRow, col).note = cell.memo;
      }
    });
    r = amountRow + 2;
  }

  writeFloorGrid('2階（201〜209）', FLOOR2_ROOMS, COLOR.floor2);
  writeFloorGrid('1階（101〜108）', [...FLOOR1_BLOCK_A, null, ...FLOOR1_BLOCK_B], COLOR.floor1);
  writeFloorGrid('RV（手動入力・定員20名）', [ROOM_RV], COLOR.rv);

  ws.getCell(`A${r}`).value = '個室';
  ws.getCell(`A${r}`).font = { bold: true };
  r += 1;
  writeFloorGrid('【4人個室】401 / 【6人個室】601', [ROOM_401, ROOM_601], COLOR.lockup);

  if (issues && issues.length) {
    r += 1;
    ws.getCell(`A${r}`).value = '■ 要確認一覧';
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: 'FFC00000' } };
    r += 1;
    for (const issue of issues) {
      ws.getCell(`A${r}`).value = `・${issue.message}`;
      r += 1;
    }
  }

  // 列幅調整
  for (let c = 1; c <= 20; c++) {
    ws.getColumn(c).width = 14;
  }
  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 18;

  return wb;
}

module.exports = { buildWorkbook, sheetNameForDate };
