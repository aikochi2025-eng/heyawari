const FLOOR2_ROOMS = [201, 202, 203, 204, 205, 206, 207, 208, 209];
const FLOOR1_ROOMS = [101, 102, 103, 104, 'closet', 105, 106, 107, 108];
const FLOOR1_REAL_ROOMS = [101, 102, 103, 104, 105, 106, 107, 108];
const LOCKUPS = [401, 601];
const ROOM_RV = 'RV';

// 各部屋の定員（server/logic/roomMaster.js と揃える）
const ROOM_CAPACITY = {
  default: { adults: 1, children: 1, infants: 1 },
  401: { adults: 4, children: 2, infants: 2 },
  601: { adults: 6, children: 3, infants: 3 },
  RV: { adults: 20, children: 20, infants: 20, total: 20 },
};
function capacityFor(roomNo) {
  return ROOM_CAPACITY[roomNo] || ROOM_CAPACITY.default;
}
function applyTotalCap(adults, children, infants, cap) {
  if (!cap.total) return { adults, children, infants };
  let a = adults, c = children, i = infants;
  let over = a + c + i - cap.total;
  if (over > 0) { const d = Math.min(i, over); i -= d; over -= d; }
  if (over > 0) { const d = Math.min(c, over); c -= d; over -= d; }
  if (over > 0) { const d = Math.min(a, over); a -= d; over -= d; }
  return { adults: a, children: c, infants: i };
}

const el = (sel) => document.querySelector(sel);
const datePicker = el('#datePicker');
const app = el('#app');
const issuesBox = el('#issuesBox');
const issuesList = el('#issuesList');
const saveStatus = el('#saveStatus');
const mealSummaryEl = el('#mealSummary');
const totalAmountEl = el('#totalAmount');

let currentDate = null;
let currentRooms = {};
let currentIssues = [];
let mealCategories = [];
let currentModalRoom = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
datePicker.value = todayStr();

function setSaveStatus(text, ok = true) {
  saveStatus.textContent = text;
  saveStatus.style.color = ok ? '#dff0d8' : '#f2dede';
  if (text) setTimeout(() => { if (saveStatus.textContent === text) saveStatus.textContent = ''; }, 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'エラーが発生しました');
  }
  return res.json();
}

function roomLabel(roomNo) {
  return roomNo === ROOM_RV ? 'RV' : roomNo;
}

function renderIssues(issues) {
  issuesList.innerHTML = '';
  if (!issues || issues.length === 0) {
    issuesBox.hidden = true;
    return;
  }
  issuesBox.hidden = false;
  issues.forEach((i) => {
    const li = document.createElement('li');
    li.textContent = i.message;
    issuesList.appendChild(li);
  });
}

function updateTotalAmount() {
  let total = 0;
  Object.values(currentRooms).forEach((c) => { if (c && c.amount) total += c.amount; });
  totalAmountEl.textContent = `¥${total.toLocaleString()}`;
}

// ---- タイル(コンパクト表示) ----
function makeTile(roomNo, floorClass) {
  const tpl = el('#roomCellTemplate').content.cloneNode(true);
  const wrapper = tpl.querySelector('.room-cell');
  wrapper.classList.add(floorClass);
  wrapper.dataset.room = roomNo;

  if (roomNo === 'closet') {
    wrapper.classList.add('closet');
    wrapper.querySelector('.room-no').textContent = '納戸';
    wrapper.querySelectorAll('.guest-name, .site-tag, .cell-footer, .lock-icon, .review-badge').forEach((n) => n.remove());
    return wrapper;
  }

  const cell = currentRooms[roomNo];
  wrapper.querySelector('.room-no').textContent = roomLabel(roomNo);
  const nameEl = wrapper.querySelector('.guest-name');
  const siteEl = wrapper.querySelector('.site-tag');
  const paxEl = wrapper.querySelector('.pax-badge');
  const amountEl = wrapper.querySelector('.amount-badge');
  const lockIcon = wrapper.querySelector('.lock-icon');
  const badge = wrapper.querySelector('.review-badge');

  if (cell) {
    nameEl.textContent = cell.guestName || '（空室）';
    siteEl.textContent = cell.site || '';
    const pax = [
      cell.adults ? `大${cell.adults}` : '',
      cell.children ? `子${cell.children}` : '',
      cell.infants ? `幼${cell.infants}` : '',
    ].filter(Boolean).join('/');
    paxEl.textContent = pax;
    amountEl.textContent = cell.amount ? `¥${cell.amount.toLocaleString()}` : (cell.leaderRoomNo ? `→${roomLabel(cell.leaderRoomNo)}号室に集計` : '');
    if (cell.needsReview) {
      wrapper.classList.add('review');
      badge.hidden = false;
      wrapper.title = cell.reviewReason || '';
    }
    if (cell.isContinuing) {
      wrapper.title = (wrapper.title ? wrapper.title + '\n' : '') + '連泊中（自動継続）';
    }
    if (cell.leaderRoomNo) {
      wrapper.title = (wrapper.title ? wrapper.title + '\n' : '') + `金額・食事は${roomLabel(cell.leaderRoomNo)}号室にまとめて集計されます`;
    }
    if (cell.locked) {
      wrapper.classList.add('locked');
      lockIcon.textContent = '🔒';
    }
  } else {
    wrapper.classList.add('empty');
    nameEl.textContent = '（空室）';
  }

  wrapper.addEventListener('click', () => openModal(roomNo));

  // ドラッグ&ドロップで入れ替え
  wrapper.draggable = true;
  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(roomNo));
    e.dataTransfer.effectAllowed = 'move';
    wrapper.classList.add('dragging');
  });
  wrapper.addEventListener('dragend', () => wrapper.classList.remove('dragging'));
  wrapper.addEventListener('dragover', (e) => { e.preventDefault(); wrapper.classList.add('drag-over'); });
  wrapper.addEventListener('dragleave', () => wrapper.classList.remove('drag-over'));
  wrapper.addEventListener('drop', async (e) => {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
    const fromRoom = e.dataTransfer.getData('text/plain');
    const toRoom = String(roomNo);
    if (!fromRoom || fromRoom === toRoom) return;
    setSaveStatus('入れ替え中...');
    try {
      const data = await api(`/api/assignments/${currentDate}/swap`, {
        method: 'PUT',
        body: JSON.stringify({ roomA: fromRoom, roomB: toRoom }),
      });
      render(data);
      setSaveStatus('入れ替えました ✓');
    } catch (err) {
      setSaveStatus('エラー: ' + err.message, false);
    }
  });

  return wrapper;
}

function buildFloorSection(title, roomNos, floorClass, { showLockAll = true } = {}) {
  const section = document.createElement('div');
  section.className = 'floor-section';
  const header = document.createElement('div');
  header.className = 'floor-title';
  const realRooms = roomNos.filter((r) => r !== 'closet');
  const occupied = realRooms.filter((r) => currentRooms[r]).length;
  header.innerHTML = `<span>${title}</span><span class="floor-count">${occupied}/${realRooms.length}室</span>`;
  if (showLockAll) {
    const allLocked = realRooms.length > 0 && realRooms.every((r) => currentRooms[r] && currentRooms[r].locked);
    const btn = document.createElement('button');
    btn.className = 'lock-all-btn';
    btn.innerHTML = allLocked ? '🔓 全解除' : '🔒 全固定';
    btn.addEventListener('click', async () => {
      setSaveStatus('固定処理中...');
      try {
        const data = await api(`/api/assignments/${currentDate}/lock-many`, {
          method: 'PUT',
          body: JSON.stringify({ roomNos: realRooms, locked: !allLocked }),
        });
        render(data);
        setSaveStatus('更新しました ✓');
      } catch (e) {
        setSaveStatus('エラー: ' + e.message, false);
      }
    });
    header.appendChild(btn);
  }
  section.appendChild(header);
  const grid = document.createElement('div');
  grid.className = `floor-grid ${floorClass}-grid`;
  roomNos.forEach((r) => grid.appendChild(makeTile(r, floorClass)));
  section.appendChild(grid);
  return section;
}

function render(data) {
  currentRooms = data.rooms || {};
  currentIssues = data.issues || [];
  renderIssues(currentIssues);
  updateTotalAmount();

  app.innerHTML = '';
  app.appendChild(buildFloorSection('2階（201〜209）', FLOOR2_ROOMS, 'floor2'));
  app.appendChild(buildFloorSection('1階（101〜108） 納戸：104〜105間', FLOOR1_ROOMS, 'floor1'));
  app.appendChild(buildFloorSection('RV（108号室の下・完全手動・定員20名）', [ROOM_RV], 'rv'));
  app.appendChild(buildFloorSection('個室（401・601）', LOCKUPS, 'lockup'));

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `
    <span><span class="legend-swatch" style="background:#eaf1dd"></span>1階</span>
    <span><span class="legend-swatch" style="background:#ddebf7"></span>2階</span>
    <span><span class="legend-swatch" style="background:#f2e2ce"></span>個室</span>
    <span><span class="legend-swatch" style="background:#e6dff2"></span>RV</span>
    <span><span class="legend-swatch" style="background:#fff2cc"></span>要確認</span>
    <span>🔒固定中（CSV更新で上書きされません）</span>
  `;
  app.appendChild(legend);

  renderMealSummary();
}

// ---- 部屋番号・宿泊者名・食事の集計表を組み立てる（ライブ表示／3日間印刷の両方で共用） ----
// rooms: { roomNo: cell } / tableClass: 表の見た目調整用クラス名
function buildMealTable(rooms, { tableClass = 'meal-summary-table' } = {}) {
  if (!mealCategories.length) return null;
  const allRoomOrder = [...FLOOR1_REAL_ROOMS, ...FLOOR2_ROOMS, ROOM_RV, ...LOCKUPS];
  const occupiedRooms = allRoomOrder.filter((r) => rooms[r]);
  if (occupiedRooms.length === 0) return null;

  const allItems = mealCategories.flatMap((c) => c.items);
  const colTotals = {};
  occupiedRooms.forEach((r) => (colTotals[r] = 0));
  const itemRows = [];
  allItems.forEach((item) => {
    let rowTotal = 0;
    const perRoom = {};
    occupiedRooms.forEach((r) => {
      const n = (rooms[r].mealCounts && rooms[r].mealCounts[item]) || 0;
      perRoom[r] = n;
      rowTotal += n;
      colTotals[r] += n;
    });
    if (rowTotal > 0) {
      itemRows.push({ item, perRoom, rowTotal });
    }
  });

  const table = document.createElement('table');
  table.className = tableClass;

  const thead = document.createElement('thead');
  const headRow1 = document.createElement('tr');
  headRow1.innerHTML = '<th class="mst-corner">メニュー</th>' +
    occupiedRooms.map((r) => `<th>${roomLabel(r)}</th>`).join('') +
    '<th class="mst-total-col">名称</th><th class="mst-total-col">計</th>';
  const headRow2 = document.createElement('tr');
  headRow2.className = 'mst-name-row';
  headRow2.innerHTML = '<th class="mst-corner"></th>' +
    occupiedRooms.map((r) => `<th>${(rooms[r].guestName || '').slice(0, 6)}</th>`).join('') +
    '<th class="mst-total-col"></th><th class="mst-total-col"></th>';
  thead.appendChild(headRow1);
  thead.appendChild(headRow2);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (itemRows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mst-corner">-</td>${occupiedRooms.map(() => '<td></td>').join('')}<td class="mst-total-col"></td><td class="mst-total-col"></td>`;
    tbody.appendChild(tr);
  }
  itemRows.forEach(({ item, perRoom, rowTotal }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mst-item">${item}</td>` +
      occupiedRooms.map((r) => `<td>${perRoom[r] || ''}</td>`).join('') +
      `<td class="mst-total-col">${item}</td><td class="mst-total-col mst-total">${rowTotal}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const tfoot = document.createElement('tfoot');
  const footRow = document.createElement('tr');
  const grandTotal = Object.values(colTotals).reduce((a, b) => a + b, 0);
  footRow.innerHTML = '<td class="mst-item">合計</td>' +
    occupiedRooms.map((r) => `<td>${colTotals[r] || ''}</td>`).join('') +
    `<td class="mst-total-col">合計</td><td class="mst-total-col mst-total">${grandTotal}</td>`;
  tfoot.appendChild(footRow);
  table.appendChild(tfoot);

  return table;
}

// ---- 画面下部：食事・オプション集計表（ライブ） ----
function renderMealSummary() {
  mealSummaryEl.innerHTML = '';
  if (!mealCategories.length) return;

  const title = document.createElement('div');
  title.className = 'meal-summary-title';
  title.textContent = '食事集計（自動更新）';
  mealSummaryEl.appendChild(title);

  const table = buildMealTable(currentRooms);
  if (!table) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '本日の割当がまだありません。';
    mealSummaryEl.appendChild(hint);
    return;
  }
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'meal-summary-scroll';
  scrollWrap.appendChild(table);
  mealSummaryEl.appendChild(scrollWrap);
}

// ---- 部屋詳細モーダル ----
const modalOverlay = el('#roomModal');
const modalTitle = el('#modalRoomTitle');
const modalSub = el('#modalRoomSub');
const modalGuestName = el('#modalGuestName');
const modalSite = el('#modalSite');
const modalAmount = el('#modalAmount');
const modalAdults = el('#modalAdults');
const modalChildren = el('#modalChildren');
const modalInfants = el('#modalInfants');
const modalMemo = el('#modalMemo');
const modalCancelBtn = el('#modalCancelBtn');
const modalLockBtn = el('#modalLockBtn');
const mealCategoriesEl = el('#mealCategories');

function currentModalCell() {
  return currentRooms[currentModalRoom] || {};
}

function openModal(roomNo) {
  currentModalRoom = roomNo;
  const cell = currentModalCell();
  const cap = capacityFor(roomNo);
  const totalPax = (cell.adults || 0) + (cell.children || 0) + (cell.infants || 0);
  modalTitle.textContent = `${roomLabel(roomNo)}号室`;
  const leaderNote = cell.leaderRoomNo ? `⚠ 金額・食事は${roomLabel(cell.leaderRoomNo)}号室にまとめて集計されます` : '';
  modalSub.textContent = [cell.reservationNo || '予約番未登録', totalPax ? `${totalPax}名` : '', leaderNote].filter(Boolean).join('　');

  modalGuestName.value = cell.guestName || '';
  modalSite.value = cell.site || '';
  modalAmount.value = cell.amount || '';
  modalAdults.value = cell.adults || 0;
  modalChildren.value = cell.children || 0;
  modalInfants.value = cell.infants || 0;
  modalAdults.max = cap.adults;
  modalChildren.max = cap.children;
  modalInfants.max = cap.infants;
  modalMemo.value = cell.memo || '';

  updateLockButton(cell.locked);
  renderMealCategoriesInModal(cell.mealCounts || {});

  modalOverlay.hidden = false;
}

function closeModal() {
  modalOverlay.hidden = true;
  currentModalRoom = null;
}

function updateLockButton(locked) {
  modalLockBtn.classList.toggle('locked', !!locked);
  modalLockBtn.textContent = locked
    ? '🔒 固定中（CSV更新で上書きされません）→タップで解除'
    : '🔓 未固定（CSV更新で上書きされます）→タップで固定';
}

function renderMealCategoriesInModal(mealCounts) {
  mealCategoriesEl.innerHTML = '';
  const workingCounts = { ...mealCounts };
  mealCategories.forEach((cat) => {
    const tpl = el('#mealCategoryTemplate').content.cloneNode(true);
    const catEl = tpl.querySelector('.meal-category');
    catEl.classList.add(`mc-${cat.color}`);
    catEl.querySelector('.mc-title').textContent = cat.title;
    catEl.querySelector('.mc-note').textContent = cat.note || '';
    const itemsWrap = catEl.querySelector('.meal-items');
    cat.items.forEach((item) => {
      const rowTpl = el('#mealItemRowTemplate').content.cloneNode(true);
      const row = rowTpl.querySelector('.meal-item-row');
      row.querySelector('.mi-label').textContent = item;
      const countEl = row.querySelector('.mi-count');
      const setCount = (n) => { countEl.textContent = n; };
      setCount(workingCounts[item] || 0);
      row.querySelector('.mi-minus').addEventListener('click', () => {
        const n = Math.max(0, (workingCounts[item] || 0) - 1);
        workingCounts[item] = n;
        setCount(n);
        saveMealCounts(workingCounts);
      });
      row.querySelector('.mi-plus').addEventListener('click', () => {
        const max = cat.max || 99;
        const n = Math.min(max, (workingCounts[item] || 0) + 1);
        workingCounts[item] = n;
        setCount(n);
        saveMealCounts(workingCounts);
      });
      itemsWrap.appendChild(row);
    });
    mealCategoriesEl.appendChild(catEl);
  });
}

async function saveModalFields() {
  if (currentModalRoom === null) return;
  const cap = capacityFor(currentModalRoom);
  let a = Math.max(0, Math.min(parseInt(modalAdults.value, 10) || 0, cap.adults));
  let c = Math.max(0, Math.min(parseInt(modalChildren.value, 10) || 0, cap.children));
  let i = Math.max(0, Math.min(parseInt(modalInfants.value, 10) || 0, cap.infants));
  ({ adults: a, children: c, infants: i } = applyTotalCap(a, c, i, cap));
  modalAdults.value = a;
  modalChildren.value = c;
  modalInfants.value = i;
  await saveCell(currentModalRoom, {
    guestName: modalGuestName.value,
    site: modalSite.value,
    amount: parseInt(modalAmount.value, 10) || 0,
    adults: a,
    children: c,
    infants: i,
    memo: modalMemo.value,
  }, { keepModalOpen: true });
}

async function saveMealCounts(mealCounts) {
  if (currentModalRoom === null) return;
  await saveCell(currentModalRoom, { mealCounts }, { keepModalOpen: true });
}

async function saveCell(roomNo, fields, { keepModalOpen = false } = {}) {
  setSaveStatus('保存中...');
  try {
    const data = await api(`/api/assignments/${currentDate}/${roomNo}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    });
    currentRooms = data.rooms;
    currentIssues = data.issues;
    renderIssues(currentIssues);
    updateTotalAmount();
    renderTilesOnly();
    renderMealSummary();
    setSaveStatus('保存しました ✓');
    if (!keepModalOpen) closeModal();
  } catch (e) {
    setSaveStatus('保存エラー: ' + e.message, false);
  }
}

// モーダルを開いたまま裏のタイル一覧・集計表だけ再描画する
function renderTilesOnly() {
  const scrollY = app.scrollTop;
  app.innerHTML = '';
  app.appendChild(buildFloorSection('2階（201〜209）', FLOOR2_ROOMS, 'floor2'));
  app.appendChild(buildFloorSection('1階（101〜108） 納戸：104〜105間', FLOOR1_ROOMS, 'floor1'));
  app.appendChild(buildFloorSection('RV（108号室の下・完全手動・定員20名）', [ROOM_RV], 'rv'));
  app.appendChild(buildFloorSection('個室（401・601）', LOCKUPS, 'lockup'));
  app.scrollTop = scrollY;
}

modalGuestName.addEventListener('blur', saveModalFields);
modalSite.addEventListener('blur', saveModalFields);
modalAmount.addEventListener('blur', saveModalFields);
modalAdults.addEventListener('change', saveModalFields);
modalChildren.addEventListener('change', saveModalFields);
modalInfants.addEventListener('change', saveModalFields);
modalMemo.addEventListener('blur', saveModalFields);

modalLockBtn.addEventListener('click', async () => {
  if (currentModalRoom === null) return;
  const cell = currentModalCell();
  const nextLocked = !cell.locked;
  setSaveStatus('固定処理中...');
  try {
    const data = await api(`/api/assignments/${currentDate}/${currentModalRoom}/lock`, {
      method: 'PUT',
      body: JSON.stringify({ locked: nextLocked }),
    });
    currentRooms = data.rooms;
    currentIssues = data.issues;
    renderIssues(currentIssues);
    renderTilesOnly();
    updateLockButton(nextLocked);
    setSaveStatus('更新しました ✓');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
});

modalCancelBtn.addEventListener('click', async () => {
  if (currentModalRoom === null) return;
  if (!confirm(`${roomLabel(currentModalRoom)}号室をキャンセル・空室化します。よろしいですか？`)) return;
  setSaveStatus('削除中...');
  try {
    const data = await api(`/api/assignments/${currentDate}/${currentModalRoom}`, { method: 'DELETE' });
    render(data);
    closeModal();
    setSaveStatus('空室にしました');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
});

el('#modalClose').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

// ---- データ読み込み・生成・アップロード ----
async function loadAssignments(date) {
  const data = await api(`/api/assignments/${date}`);
  render(data);
}

async function generate(date, force) {
  setSaveStatus('生成中...');
  try {
    const data = await api(`/api/generate/${date}${force ? '?force=1' : ''}`, { method: 'POST' });
    render(data);
    setSaveStatus('生成しました');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
}

el('#genBtn').addEventListener('click', () => {
  currentDate = datePicker.value;
  generate(currentDate, false);
});
el('#forceGenBtn').addEventListener('click', () => {
  if (!confirm('固定していないセルを全て上書きして再生成します。よろしいですか？（固定中のセルは影響を受けません）')) return;
  currentDate = datePicker.value;
  generate(currentDate, true);
});
datePicker.addEventListener('change', () => {
  currentDate = datePicker.value;
  loadAssignments(currentDate).catch(() => render({ rooms: {}, issues: [] }));
});

// 日付の前後移動ボタン（カレンダーの矢印と並んで使う）
function shiftDate(days) {
  const cur = datePicker.value ? new Date(`${datePicker.value}T00:00:00`) : new Date();
  cur.setDate(cur.getDate() + days);
  const y = cur.getFullYear();
  const m = String(cur.getMonth() + 1).padStart(2, '0');
  const d = String(cur.getDate()).padStart(2, '0');
  datePicker.value = `${y}-${m}-${d}`;
  currentDate = datePicker.value;
  loadAssignments(currentDate).catch(() => render({ rooms: {}, issues: [] }));
}
el('#datePrevBtn').addEventListener('click', () => shiftDate(-1));
el('#dateNextBtn').addEventListener('click', () => shiftDate(1));
el('#csvFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  setSaveStatus('アップロード中...');
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    setSaveStatus(`取込完了(${data.count}件)`);
    let msg = `予約${data.count}件を読み込みました。\n対象日: ${data.dates.slice(0, 5).join(', ')}${data.dates.length > 5 ? ' 他' : ''}`;
    if (data.cancelledCount) {
      msg += `\n\nキャンセル検出: ${data.cancelledCount}件`;
      if (data.vacated && data.vacated.length) {
        msg += `\n以下を空室化しました:\n` + data.vacated.map((v) => `  ${v.date} ${v.roomNo}号室 (${v.guestName || ''})`).join('\n');
      }
    }
    alert(msg);
    if (currentDate) loadAssignments(currentDate).catch(() => {});
  } catch (err) {
    setSaveStatus('アップロードエラー', false);
    alert('アップロードに失敗しました: ' + err.message);
  }
});

// ---- 3日間ビュー（印刷用・A4縦・閲覧専用） ----
const multiDayView = el('#multiDayView');
const multiDayPages = el('#multiDayPages');

function makeReadonlyCell(roomNo, rooms) {
  const div = document.createElement('div');
  div.className = 'ro-cell';
  const cell = rooms[roomNo];
  if (roomNo === 'closet') {
    div.classList.add('closet');
    div.innerHTML = '<div class="ro-no">納戸</div>';
    return div;
  }
  if (!cell) div.classList.add('empty');
  if (cell && cell.needsReview) div.classList.add('review');
  const label = roomLabel(roomNo);
  div.innerHTML = `
    <div class="ro-no">${label}${cell && cell.locked ? ' 🔒' : ''}</div>
    <div class="ro-name">${cell ? (cell.guestName || '（空室）') : '（空室）'}</div>
    <div class="ro-site">${cell ? (cell.site || '') : ''}</div>
    <div class="ro-pax">${cell ? `大${cell.adults || 0}/子${cell.children || 0}/幼${cell.infants || 0}` : ''}</div>
  `;
  return div;
}

// その日の売上合計(リーダー部屋の金額のみ合算されるため二重計上されない)
function dayRevenue(rooms) {
  return Object.values(rooms || {}).reduce((sum, c) => sum + ((c && c.amount) || 0), 0);
}

function renderDayBlock(dayData, { isFirst = false, threeDayTotal = 0 } = {}) {
  const block = document.createElement('div');
  block.className = 'day-block';
  const wdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = wdays[new Date(`${dayData.date}T00:00:00`).getDay()];
  const revenue = dayRevenue(dayData.rooms);

  const header = document.createElement('div');
  header.className = 'day-block-header';
  header.innerHTML = `
    <h3>柏島ヴィレッジ　${dayData.date.replace(/-/g, '/')}（${wd}）チェックイン 部屋割り表</h3>
    <div class="day-block-totals">
      <span class="day-revenue">売上 ¥${revenue.toLocaleString()}</span>
      ${isFirst ? `<span class="three-day-total">3日間合計 ¥${threeDayTotal.toLocaleString()}</span>` : ''}
    </div>
  `;
  block.appendChild(header);

  const rooms = dayData.rooms || {};

  const sec2F = document.createElement('div');
  sec2F.className = 'ro-section';
  sec2F.innerHTML = '<div class="ro-title">2階（201〜209）</div>';
  const grid2F = document.createElement('div');
  grid2F.className = 'ro-grid';
  FLOOR2_ROOMS.forEach((r) => grid2F.appendChild(makeReadonlyCell(r, rooms)));
  sec2F.appendChild(grid2F);
  block.appendChild(sec2F);

  const sec1F = document.createElement('div');
  sec1F.className = 'ro-section';
  sec1F.innerHTML = '<div class="ro-title">1階（101〜108）</div>';
  const grid1F = document.createElement('div');
  grid1F.className = 'ro-grid';
  FLOOR1_ROOMS.forEach((r) => grid1F.appendChild(makeReadonlyCell(r, rooms)));
  sec1F.appendChild(grid1F);
  block.appendChild(sec1F);

  const secRest = document.createElement('div');
  secRest.className = 'ro-section';
  secRest.innerHTML = '<div class="ro-title">個室・RV</div>';
  const gridRest = document.createElement('div');
  gridRest.className = 'ro-grid ro-grid-rest';
  [401, 601, ROOM_RV].forEach((r) => gridRest.appendChild(makeReadonlyCell(r, rooms)));
  secRest.appendChild(gridRest);
  block.appendChild(secRest);

  if (dayData.issues && dayData.issues.length) {
    const issuesDiv = document.createElement('div');
    issuesDiv.className = 'ro-issues';
    issuesDiv.innerHTML = '<strong>要確認:</strong> ' + dayData.issues.map((i) => i.message).join(' / ');
    block.appendChild(issuesDiv);
  }

  return block;
}

// 3日分を1枚のA4縦ページにまとめて表示する
function renderThreeDayPage(daysData) {
  const page = document.createElement('div');
  page.className = 'day-page';
  const threeDayTotal = daysData.reduce((sum, d) => sum + dayRevenue(d.rooms), 0);
  daysData.forEach((d, i) => {
    page.appendChild(renderDayBlock(d, { isFirst: i === 0, threeDayTotal }));
  });
  return page;
}

async function showMultiDayView() {
  const start = datePicker.value;
  setSaveStatus('読み込み中...');
  try {
    const data = await api(`/api/assignments-range?start=${start}&days=3`);
    multiDayPages.innerHTML = '';
    multiDayPages.appendChild(renderThreeDayPage(data.days));
    document.querySelector('.topbar').hidden = true;
    document.querySelector('#issuesBox').hidden = true;
    app.hidden = true;
    mealSummaryEl.hidden = true;
    multiDayView.hidden = false;
    setSaveStatus('');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
}

el('#multiDayBtn').addEventListener('click', showMultiDayView);
el('#backToEditBtn').addEventListener('click', () => {
  multiDayView.hidden = true;
  document.querySelector('.topbar').hidden = false;
  app.hidden = false;
  mealSummaryEl.hidden = false;
});
el('#printBtn').addEventListener('click', () => window.print());

// ---- 3日間食事管理表（印刷用・A4縦・部屋番号/宿泊者名/食事を3日分まとめて表示） ----
const mealMultiDayView = el('#mealMultiDayView');
const mealMultiDayPages = el('#mealMultiDayPages');

function renderMealDayBlock(dayData) {
  const block = document.createElement('div');
  block.className = 'day-block meal-day-block';
  const wdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = wdays[new Date(`${dayData.date}T00:00:00`).getDay()];

  const header = document.createElement('div');
  header.className = 'day-block-header';
  header.innerHTML = `<h3>柏島ヴィレッジ　${dayData.date.replace(/-/g, '/')}（${wd}）食事管理表</h3>`;
  block.appendChild(header);

  const table = buildMealTable(dayData.rooms || {}, { tableClass: 'meal-summary-table meal-print-table' });
  if (table) {
    block.appendChild(table);
  } else {
    const empty = document.createElement('p');
    empty.className = 'ro-issues';
    empty.textContent = 'この日の割当はまだありません。';
    block.appendChild(empty);
  }
  return block;
}

// 3日分の食事管理表を1枚のA4縦ページにまとめる
function renderMealThreeDayPage(daysData) {
  const page = document.createElement('div');
  page.className = 'day-page meal-day-page';
  daysData.forEach((d) => page.appendChild(renderMealDayBlock(d)));
  return page;
}

async function showMealMultiDayView() {
  const start = datePicker.value;
  setSaveStatus('読み込み中...');
  try {
    const data = await api(`/api/assignments-range?start=${start}&days=3`);
    mealMultiDayPages.innerHTML = '';
    mealMultiDayPages.appendChild(renderMealThreeDayPage(data.days));
    document.querySelector('.topbar').hidden = true;
    document.querySelector('#issuesBox').hidden = true;
    app.hidden = true;
    mealSummaryEl.hidden = true;
    mealMultiDayView.hidden = false;
    setSaveStatus('');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
}

el('#mealMultiDayBtn').addEventListener('click', showMealMultiDayView);
el('#mealBackToEditBtn').addEventListener('click', () => {
  mealMultiDayView.hidden = true;
  document.querySelector('.topbar').hidden = false;
  app.hidden = false;
  mealSummaryEl.hidden = false;
});
el('#mealPrintBtn').addEventListener('click', () => window.print());

// 初期表示（食事カテゴリ一覧を先に取得してからグリッドを描画する）
currentDate = datePicker.value;
api('/api/meal-items').then((d) => { mealCategories = d.categories || []; }).catch(() => {})
  .finally(() => loadAssignments(currentDate).catch(() => {}));
