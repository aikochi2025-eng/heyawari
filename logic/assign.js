const {
  FLOOR1_ROOMS, FLOOR2_ROOMS, FLOOR1_ADJACENCY_BLOCKS,
  ROOM_401, ROOM_601, ABOVE_MAP,
} = require('./roomMaster');
const { classifyRoomType, classifyPlan } = require('./classify');
const { seedMealCounts } = require('./mealItems');

// 2階部屋番号 → 直下の1階部屋番号（逆引き）。205の直下は納戸のため対応部屋なし。
const BELOW_MAP = {};
for (const [f1, f2] of Object.entries(ABOVE_MAP)) BELOW_MAP[f2] = parseInt(f1, 10);

function makeCell({ res, roomNo, needsReview, reviewReason, groupKey, isContinuing }) {
  const planLabel = classifyPlan(res.planName, res.meal);
  return {
    roomNo,
    guestName: res.guestName,
    reservationId: res.reservationId,
    reservationNo: res.reservationNo,
    site: res.site,
    amount: res.totalAmount,
    planLabel,
    planNameRaw: res.planName,
    adults: res.adults,
    children: res.children,
    infants: res.infants,
    mealCounts: seedMealCounts(planLabel, (res.adults || 0) + (res.children || 0)),
    memo: res.otherDetails || '',
    checkin: res.checkin,
    checkout: res.checkout,
    nights: res.nights,
    needsReview: !!needsReview,
    reviewReason: reviewReason || null,
    groupKey: groupKey || res.reservationId,
    isContinuing: !!isContinuing,
  };
}

// 連続した空き部屋を探す。block内でのみ探索し、納戸などブロックをまたぐ連続は認めない。
// occupied済み部屋に隣接する空き run を優先し、次に部屋番号が小さい方を優先する（4-3, 4-1-9）。
function listContiguousRunCandidates(block, occupiedSet, length) {
  if (length <= 0) return [];
  const candidates = [];
  for (let i = 0; i + length <= block.length; i++) {
    const run = block.slice(i, i + length);
    if (run.every((r) => !occupiedSet.has(r))) {
      const adjacentToOccupied =
        (i > 0 && occupiedSet.has(block[i - 1])) ||
        (i + length < block.length && occupiedSet.has(block[i + length]));
      candidates.push({ run, adjacentToOccupied, startIdx: i });
    }
  }
  candidates.sort((a, b) => {
    if (a.adjacentToOccupied !== b.adjacentToOccupied) return a.adjacentToOccupied ? -1 : 1;
    return a.startIdx - b.startIdx; // 部屋番号の小さい方優先
  });
  return candidates;
}

function findContiguousRun(block, occupiedSet, length) {
  const candidates = listContiguousRunCandidates(block, occupiedSet, length);
  return candidates.length ? candidates[0].run : null;
}

function findRunOnFloor(floorBlocks, occupiedSet, length) {
  for (const block of floorBlocks) {
    const run = findContiguousRun(block, occupiedSet, length);
    if (run) return run;
  }
  return null;
}

// 単一の空き部屋を1つ選ぶ（隣接優先・部屋番号昇順優先・edge優先オプション対応）
function pickSingleRoom(floorRooms, occupiedSet, { preferEdgeFirst } = {}) {
  const free = floorRooms.filter((r) => !occupiedSet.has(r));
  if (free.length === 0) return null;
  if (preferEdgeFirst) {
    // 108 or 209 のような末端部屋を優先
    const edge = floorRooms[floorRooms.length - 1];
    if (!occupiedSet.has(edge)) return edge;
  }
  // 既occupied部屋に隣接するものを優先
  const idxOf = (r) => floorRooms.indexOf(r);
  let best = null;
  for (const r of free) {
    const i = idxOf(r);
    const adj = (i > 0 && occupiedSet.has(floorRooms[i - 1])) || (i + 1 < floorRooms.length && occupiedSet.has(floorRooms[i + 1]));
    if (!best || (adj && !best.adjacentToOccupied) || (adj === best.adjacentToOccupied && r < best.roomNo)) {
      best = { roomNo: r, adjacentToOccupied: adj };
    }
  }
  return best ? best.roomNo : free[0];
}

// PAIR(2人区画)・QUAD(4人区画) 用: n人分の個室を1階(ceil(n/2))+2階(floor(n/2))で
// 直上ペアを保ったまま確保する
function findVerticalSplit(occupiedSet, n) {
  const n1 = Math.ceil(n / 2);
  const n2 = n - n1;
  for (const block of FLOOR1_ADJACENCY_BLOCKS) {
    const run1 = findContiguousRun(block, occupiedSet, n1);
    if (!run1) continue;
    const aboveRun = run1.map((r) => ABOVE_MAP[r]);
    const above2FUsed = aboveRun.slice(0, n2);
    if (above2FUsed.every((r) => !occupiedSet.has(r))) {
      return { floor1: run1, floor2: above2FUsed };
    }
  }
  return null;
}

// TRIO(3人区画) 用: 2階の隣接2室 + そのどちらか直下の1階1室、という固定パターンで確保する
function findVerticalSplitFromFloor2(occupiedSet, n2 = 2, n1 = 1) {
  const candidates = listContiguousRunCandidates(FLOOR2_ROOMS, occupiedSet, n2);
  for (const { run } of candidates) {
    const belowCandidates = run.map((r) => BELOW_MAP[r]).filter((r) => r && !occupiedSet.has(r));
    if (belowCandidates.length >= n1) {
      return { floor2: run, floor1: belowCandidates.slice(0, n1) };
    }
  }
  return null;
}

function assignRoomsForDate({ newArrivals, continuingOccupants = [] }) {
  const rooms = {}; // roomNo -> cell
  const issues = [];
  const occupied = new Set();

  for (const c of continuingOccupants) {
    rooms[c.roomNo] = { ...c, isContinuing: true };
    occupied.add(c.roomNo);
  }

  // カテゴリ分類
  const buckets = { ROOM4: [], ROOM6: [], DORM_1F: [], DORM_2F: [], DORM_PAIR: [], DORM_TRIO: [], DORM_QUAD: [], UNKNOWN: [] };
  for (const res of newArrivals) {
    const cat = classifyRoomType(res.roomTypeName);
    buckets[cat].push(res);
  }

  // 同名で複数予約(要確認の材料)を検出するための名前カウント
  const nameCount = {};
  for (const res of newArrivals) {
    nameCount[res.guestName] = (nameCount[res.guestName] || 0) + 1;
  }
  const lockupGuestNames = new Set([...buckets.ROOM4, ...buckets.ROOM6].map((r) => r.guestName));

  // --- ①④人個室(401) / ②⑥人個室(601) ---
  function assignLockup(list, roomNo, maxKids, label) {
    if (list.length === 0) return;
    if (occupied.has(roomNo)) {
      issues.push({ type: 'LOCKUP_ALREADY_OCCUPIED', message: `${label}(${roomNo})は既に連泊客で使用中だが新規予約${list.map(r=>r.guestName).join('/')}あり`, roomNos: [roomNo] });
      return;
    }
    const primary = list[0];
    const needsReview = list.length > 1 || primary.children + primary.infants > maxKids;
    let reason = null;
    if (list.length > 1) reason = `同日に複数予約(${list.map((r) => r.guestName).join(' / ')})。重複の可能性あり`;
    else if (primary.children + primary.infants > maxKids) reason = `子供人数が添い寝可能人数(${maxKids}名)を超えています`;
    rooms[roomNo] = makeCell({ res: primary, roomNo, needsReview, reviewReason: reason });
    occupied.add(roomNo);
    if (list.length > 1) {
      issues.push({ type: 'DUPLICATE_LOCKUP', message: `${label}に同日複数予約: ${list.map((r) => r.guestName).join(' / ')}`, roomNos: [roomNo] });
    }
  }
  assignLockup(buckets.ROOM4, ROOM_401, 2, '4人個室');
  assignLockup(buckets.ROOM6, ROOM_601, 3, '6人個室');

  // --- ③④ ドミトリー1階/2階 (単室・複数室) ---
  function assignDormFloor(list, floorRooms, floorBlocks, label) {
    // 室数の多い予約を先に確保する（連続確保の失敗を減らすため）
    const sorted = [...list].sort((a, b) => b.roomCount - a.roomCount);
    for (const res of sorted) {
      const n = Math.max(1, res.roomCount);
      const preferEdge = n === 1 && lockupGuestNames.has(res.guestName);
      let run;
      if (n === 1) {
        const r = pickSingleRoom(floorRooms, occupied, { preferEdgeFirst: preferEdge });
        run = r ? [r] : null;
      } else {
        run = findRunOnFloor(floorBlocks, occupied, n);
      }
      if (!run) {
        // 連続確保できない → 空いている部屋を可能な範囲でばら撒き、要確認
        const free = floorRooms.filter((r) => !occupied.has(r)).slice(0, n);
        if (free.length === 0) {
          issues.push({ type: 'NO_ROOM', message: `${label}に空室がありません: ${res.guestName}様(必要${n}室)`, roomNos: [] });
          continue;
        }
        run = free;
        const reason = `連続した空き部屋(${n}室)を確保できず、離れた部屋を仮割当: ${run.join('・')}`;
        for (const rn of run) {
          rooms[rn] = makeCell({ res, roomNo: rn, needsReview: true, reviewReason: reason, groupKey: res.reservationId });
          occupied.add(rn);
        }
        issues.push({ type: 'FRAGMENTED_ROOMS', message: `${res.guestName}様: ${reason}`, roomNos: run });
        continue;
      }
      const needsReview = preferEdge && run[0] !== floorRooms[floorRooms.length - 1];
      for (const rn of run) {
        rooms[rn] = makeCell({
          res, roomNo: rn,
          needsReview,
          reviewReason: needsReview ? '同名の個室予約あり。末端部屋(108/209)を優先する規則ですが確保できませんでした' : null,
          groupKey: res.reservationId,
        });
        occupied.add(rn);
      }
    }
  }
  assignDormFloor(buckets.DORM_1F, FLOOR1_ROOMS, FLOOR1_ADJACENCY_BLOCKS, '1階ドミトリー');
  assignDormFloor(buckets.DORM_2F, FLOOR2_ROOMS, [FLOOR2_ROOMS], '2階ドミトリー');

  // --- ⑤ 2人区画(上下)・3人区画・4人区画 ---
  function assignSplit(list, label, splitFn) {
    for (const res of list) {
      const split = splitFn(res);
      if (!split) {
        issues.push({ type: 'NO_SPLIT_ROOM', message: `${label}: ${res.guestName}様の1階/2階ペア部屋を確保できませんでした。手動で割当てください`, roomNos: [] });
        continue;
      }
      const allRooms = [...split.floor1, ...split.floor2];
      const bothFloorsScarce =
        FLOOR1_ROOMS.filter((r) => !occupied.has(r)).length <= split.floor1.length + 1 &&
        FLOOR2_ROOMS.filter((r) => !occupied.has(r)).length <= split.floor2.length + 1;
      for (const rn of allRooms) {
        rooms[rn] = makeCell({
          res, roomNo: rn,
          needsReview: bothFloorsScarce,
          reviewReason: bothFloorsScarce ? '1階・2階とも残室僅少のため確保内容をご確認ください' : null,
          groupKey: res.reservationId,
        });
        occupied.add(rn);
      }
      if (bothFloorsScarce) {
        issues.push({ type: 'SCARCE_SPLIT', message: `${res.guestName}様: 1階/2階とも残室僅少 (${allRooms.join('・')})`, roomNos: allRooms });
      }
    }
  }
  // 2人区画(上下): 1階1室 + 直上の2階1室
  assignSplit(buckets.DORM_PAIR, '2人区画(上下)', () => findVerticalSplit(occupied, 2));
  // 3人区画: 2階の隣接2室 + そのどちらか直下の1階1室（固定パターン）
  assignSplit(buckets.DORM_TRIO, '3人区画', () => findVerticalSplitFromFloor2(occupied, 2, 1));
  // 4人区画: 人数(大人+子供)に応じて1階ceil(n/2)+2階floor(n/2)
  assignSplit(buckets.DORM_QUAD, '4人区画', (res) => findVerticalSplit(occupied, Math.max(2, res.adults + res.children)));

  // --- 未知の部屋タイプ ---
  for (const res of buckets.UNKNOWN) {
    issues.push({ type: 'UNKNOWN_ROOM_TYPE', message: `未知の部屋タイプ「${res.roomTypeName}」: ${res.guestName}様。マスタ更新が必要な可能性があります`, roomNos: [] });
  }

  // --- 同名複数予約(カテゴリ横断)の要確認 ---
  for (const [name, count] of Object.entries(nameCount)) {
    if (count > 1) {
      const already = issues.some((i) => i.type === 'DUPLICATE_LOCKUP' && i.message.includes(name));
      if (!already) {
        issues.push({ type: 'SAME_NAME_MULTI', message: `${name}様が同日に複数予約あり。個室＋ドミトリー等の組み合わせの可能性、要確認`, roomNos: [] });
      }
    }
  }

  return { rooms, issues, unassignedContinuing: continuingOccupants.filter((c) => !c.roomNo) };
}

module.exports = { assignRoomsForDate };
