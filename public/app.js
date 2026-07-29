const FLOOR2_ROOMS = [201, 202, 203, 204, 205, 206, 207, 208, 209];
const FLOOR1_ROOMS = [101, 102, 103, 104, 'closet', 105, 106, 107, 108];
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

let planLabels = [];

const el = (sel) => document.querySelector(sel);
const datePicker = el('#datePicker');
const app = el('#app');
const issuesBox = el('#issuesBox');
const issuesList = el('#issuesList');
const saveStatus = el('#saveStatus');

let currentDate = null;
let currentRooms = {};

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

function makeCell(roomNo, floorClass) {
  const tpl = el('#roomCellTemplate').content.cloneNode(true);
  const wrapper = tpl.querySelector('.room-cell');
  wrapper.classList.add(floorClass);
  wrapper.dataset.room = roomNo;

  if (roomNo === 'closet') {
    wrapper.classList.add('closet');
    wrapper.querySelector('.room-no').textContent = '納戸';
    wrapper.querySelectorAll('input, .cell-footer').forEach((n) => n.remove());
    return wrapper;
  }

  wrapper.querySelector('.room-no').textContent = roomNo === ROOM_RV ? 'RV（定員20名・手動）' : roomNo;
  const cell = currentRooms[roomNo];
  const nameInput = wrapper.querySelector('.guest-name');
  const siteInput = wrapper.querySelector('.site');
  const amountInput = wrapper.querySelector('.amount');
  const planSelect = wrapper.querySelector('.plan-label');
  const adultsInput = wrapper.querySelector('.pax-adults');
  const childrenInput = wrapper.querySelector('.pax-children');
  const infantsInput = wrapper.querySelector('.pax-infants');
  const memoInput = wrapper.querySelector('.memo');
  const badge = wrapper.querySelector('.review-badge');
  const clearBtn = wrapper.querySelector('.clear-btn');

  const cap = capacityFor(roomNo);
  adultsInput.max = cap.adults;
  childrenInput.max = cap.children;
  infantsInput.max = cap.infants;

  planLabels.forEach((label) => {
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = label;
    planSelect.appendChild(opt);
  });

  if (cell) {
    nameInput.value = cell.guestName || '';
    siteInput.value = cell.site || '';
    amountInput.value = cell.amount || '';
    planSelect.value = cell.planLabel || '';
    adultsInput.value = cell.adults || 0;
    childrenInput.value = cell.children || 0;
    infantsInput.value = cell.infants || 0;
    memoInput.value = cell.memo || '';
    if (cell.needsReview) {
      wrapper.classList.add('review');
      badge.hidden = false;
      badge.title = cell.reviewReason || '';
      wrapper.title = cell.reviewReason || '';
    }
    if (cell.isContinuing) {
      wrapper.title = (wrapper.title ? wrapper.title + '\n' : '') + '連泊中（自動継続）';
    }
  } else {
    wrapper.classList.add('empty');
  }

  const save = () => {
    let a = Math.max(0, Math.min(parseInt(adultsInput.value, 10) || 0, cap.adults));
    let c = Math.max(0, Math.min(parseInt(childrenInput.value, 10) || 0, cap.children));
    let i = Math.max(0, Math.min(parseInt(infantsInput.value, 10) || 0, cap.infants));
    ({ adults: a, children: c, infants: i } = applyTotalCap(a, c, i, cap));
    adultsInput.value = a;
    childrenInput.value = c;
    infantsInput.value = i;
    saveCell(roomNo, {
      guestName: nameInput.value,
      site: siteInput.value,
      amount: parseInt(amountInput.value, 10) || 0,
      planLabel: planSelect.value,
      adults: a,
      children: c,
      infants: i,
      memo: memoInput.value,
    });
  };
  [nameInput, siteInput, amountInput, planSelect, adultsInput, childrenInput, infantsInput, memoInput].forEach((inp) => {
    inp.addEventListener('change', save);
    inp.addEventListener('blur', save);
  });
  clearBtn.addEventListener('click', () => clearCell(roomNo));

  return wrapper;
}

function render(data) {
  currentRooms = data.rooms || {};
  renderIssues(data.issues || []);

  app.innerHTML = '';

  const section2F = document.createElement('div');
  section2F.className = 'floor-section';
  section2F.innerHTML = '<div class="floor-title">2階（201〜209）</div>';
  const grid2F = document.createElement('div');
  grid2F.className = 'floor-grid';
  FLOOR2_ROOMS.forEach((r) => grid2F.appendChild(makeCell(r, 'floor2')));
  section2F.appendChild(grid2F);
  app.appendChild(section2F);

  const section1F = document.createElement('div');
  section1F.className = 'floor-section';
  section1F.innerHTML = '<div class="floor-title">1階（101〜108）</div>';
  const grid1F = document.createElement('div');
  grid1F.className = 'floor-grid floor1F';
  FLOOR1_ROOMS.forEach((r) => grid1F.appendChild(makeCell(r, 'floor1')));
  section1F.appendChild(grid1F);
  app.appendChild(section1F);

  const sectionRV = document.createElement('div');
  sectionRV.className = 'floor-section';
  sectionRV.innerHTML = '<div class="floor-title">RV（108号室の下・完全手動入力・定員20名）</div>';
  const gridRV = document.createElement('div');
  gridRV.className = 'floor-grid rv-grid';
  gridRV.appendChild(makeCell(ROOM_RV, 'rv'));
  sectionRV.appendChild(gridRV);
  app.appendChild(sectionRV);

  const sectionLock = document.createElement('div');
  sectionLock.className = 'floor-section';
  sectionLock.innerHTML = '<div class="floor-title">個室（401 / 601）</div>';
  const gridLock = document.createElement('div');
  gridLock.className = 'floor-grid lockups';
  LOCKUPS.forEach((r) => gridLock.appendChild(makeCell(r, 'lockup')));
  sectionLock.appendChild(gridLock);
  app.appendChild(sectionLock);

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `
    <span><span class="legend-swatch" style="background:#eaf1dd"></span>1階</span>
    <span><span class="legend-swatch" style="background:#ddebf7"></span>2階</span>
    <span><span class="legend-swatch" style="background:#f2e2ce"></span>個室</span>
    <span><span class="legend-swatch" style="background:#e6dff2"></span>RV</span>
    <span><span class="legend-swatch" style="background:#fff2cc"></span>要確認</span>
  `;
  app.appendChild(legend);
}

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

async function saveCell(roomNo, fields) {
  setSaveStatus('保存中...');
  try {
    const data = await api(`/api/assignments/${currentDate}/${roomNo}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    });
    currentRooms = data.rooms;
    renderIssues(data.issues);
    setSaveStatus('保存しました ✓');
  } catch (e) {
    setSaveStatus('保存エラー: ' + e.message, false);
  }
}

async function clearCell(roomNo) {
  setSaveStatus('削除中...');
  try {
    const data = await api(`/api/assignments/${currentDate}/${roomNo}`, { method: 'DELETE' });
    render(data);
    setSaveStatus('空にしました');
  } catch (e) {
    setSaveStatus('エラー: ' + e.message, false);
  }
}

el('#genBtn').addEventListener('click', () => {
  currentDate = datePicker.value;
  generate(currentDate, false);
});
el('#forceGenBtn').addEventListener('click', () => {
  if (!confirm('手動編集も含めて、この日の割当をすべて上書きして再生成します。よろしいですか？')) return;
  currentDate = datePicker.value;
  generate(currentDate, true);
});
el('#exportBtn').addEventListener('click', () => {
  const date = datePicker.value;
  window.open(`/api/export/${date}`, '_blank');
});
datePicker.addEventListener('change', () => {
  currentDate = datePicker.value;
  loadAssignments(currentDate).catch(() => render({ rooms: {}, issues: [] }));
});
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
  const label = roomNo === ROOM_RV ? 'RV' : roomNo;
  div.innerHTML = `
    <div class="ro-no">${label}</div>
    <div class="ro-name">${cell ? (cell.guestName || '（空室）') : '（空室）'}</div>
    <div class="ro-site">${cell ? (cell.site || '') : ''}</div>
    <div class="ro-pax">${cell ? `大${cell.adults || 0}/子${cell.children || 0}/幼${cell.infants || 0}` : ''}</div>
  `;
  return div;
}

function renderDayPage(dayData) {
  const page = document.createElement('div');
  page.className = 'day-page';
  const wdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = wdays[new Date(`${dayData.date}T00:00:00`).getDay()];
  page.innerHTML = `<h2>柏島ヴィレッジ　${dayData.date.replace(/-/g, '/')}（${wd}）チェックイン 部屋割り表</h2>`;

  const rooms = dayData.rooms || {};

  const sec2F = document.createElement('div');
  sec2F.className = 'ro-section';
  sec2F.innerHTML = '<div class="ro-title">2階（201〜209）</div>';
  const grid2F = document.createElement('div');
  grid2F.className = 'ro-grid';
  FLOOR2_ROOMS.forEach((r) => grid2F.appendChild(makeReadonlyCell(r, rooms)));
  sec2F.appendChild(grid2F);
  page.appendChild(sec2F);

  const sec1F = document.createElement('div');
  sec1F.className = 'ro-section';
  sec1F.innerHTML = '<div class="ro-title">1階（101〜108）</div>';
  const grid1F = document.createElement('div');
  grid1F.className = 'ro-grid';
  FLOOR1_ROOMS.forEach((r) => grid1F.appendChild(makeReadonlyCell(r, rooms)));
  sec1F.appendChild(grid1F);
  page.appendChild(sec1F);

  const secRest = document.createElement('div');
  secRest.className = 'ro-section';
  secRest.innerHTML = '<div class="ro-title">個室・RV</div>';
  const gridRest = document.createElement('div');
  gridRest.className = 'ro-grid ro-grid-rest';
  [401, 601, ROOM_RV].forEach((r) => gridRest.appendChild(makeReadonlyCell(r, rooms)));
  secRest.appendChild(gridRest);
  page.appendChild(secRest);

  if (dayData.issues && dayData.issues.length) {
    const issuesDiv = document.createElement('div');
    issuesDiv.className = 'ro-issues';
    issuesDiv.innerHTML = '<strong>要確認:</strong> ' + dayData.issues.map((i) => i.message).join(' / ');
    page.appendChild(issuesDiv);
  }

  return page;
}

async function showMultiDayView() {
  const start = datePicker.value;
  setSaveStatus('読み込み中...');
  try {
    const data = await api(`/api/assignments-range?start=${start}&days=3`);
    multiDayPages.innerHTML = '';
    data.days.forEach((d) => multiDayPages.appendChild(renderDayPage(d)));
    document.querySelector('.topbar').hidden = true;
    document.querySelector('#issuesBox').hidden = true;
    app.hidden = true;
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
});
el('#printBtn').addEventListener('click', () => window.print());

// 初期表示（食事プラン一覧を先に取得してからグリッドを描画する）
currentDate = datePicker.value;
api('/api/plan-labels').then((d) => { planLabels = d.labels || []; }).catch(() => {})
  .finally(() => loadAssignments(currentDate).catch(() => {}));
