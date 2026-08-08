const db = require('../db');
const { assignRoomsForDate, memoSourceFor } = require('./assign');
const { classifyPlan } = require('./classify');
const { seedMealCountsSmart } = require('./mealItems');

async function generateForDate(dateStr, { force = false } = {}) {
  const active = await db.getActiveReservations(dateStr);

  // 既に固定(ロック)されている部屋は、CSV再取込後の自動生成でも維持する。
  // 固定に紐づく予約は新規/連泊の割当候補から除外し(でないと同じ予約が別の部屋にも
  // 重複生成されてしまう)、その部屋番号は「空室ではない」ものとして自動割当アルゴリズムに
  // 認識させることで、他の予約が誤って同じ部屋を取り合わないようにする。
  // 強制再生成(force)時は従来通りすべて上書き対象とする。
  const lockedRooms = force ? [] : await db.getLockedRoomsForDate(dateStr);
  const lockedReservationIds = new Set(lockedRooms.map((m) => m.reservationId).filter(Boolean));
  const lockedRoomNos = lockedRooms.map((m) => m.roomNo);

  const newArrivals = active.filter((r) => r.checkin === dateStr && !lockedReservationIds.has(r.reservationId));
  const continuingCandidates = active.filter((r) => r.checkin < dateStr && !lockedReservationIds.has(r.reservationId));

  const continuingOccupants = [];
  const continuityIssues = [];
  for (const r of continuingCandidates) {
    // 1件の予約が複数室にまたがる場合(2人/3人/4人区画の上下split、同フロア複数室など)、
    // 直前の日付に割り当てられていた部屋は複数あり得るため、その全てを引き継ぐ。
    const prevRooms = await db.getLastKnownAssignments(r.reservationId, dateStr);
    if (prevRooms.length > 0) {
      const planLabel = classifyPlan(r.planName, r.meal);
      for (const prev of prevRooms) {
        // 複数室にまたがる予約の場合、金額・食事・メモを集計する「リーダー部屋」は
        // 初日の割当で決まっているので、連泊中はそれをそのまま引き継ぐ(二重集計を防ぐ)。
        const isLeader = prev.isLeader;
        continuingOccupants.push({
          roomNo: prev.roomNo,
          guestName: r.guestName,
          reservationId: r.reservationId,
          site: r.site,
          amount: isLeader ? r.totalAmount : 0,
          planLabel,
          adults: r.adults,
          children: r.children,
          infants: r.infants,
          mealCounts: isLeader ? seedMealCountsSmart({ otherDetails: r.otherDetails, planLabel, adults: r.adults, children: r.children }) : {},
          memo: isLeader ? memoSourceFor(r) : '',
          isLeader,
          groupKey: r.reservationId,
          checkin: r.checkin,
          checkout: r.checkout,
          nights: r.nights,
          isContinuing: true,
        });
      }
    } else {
      continuityIssues.push({
        type: 'CONTINUING_UNKNOWN_ROOM',
        message: `${r.guestName}様は連泊中ですが以前の部屋番号が未登録です。手動で部屋を指定してください（チェックイン${r.checkin}〜チェックアウト${r.checkout}）`,
        roomNos: [],
      });
    }
  }

  const { rooms, issues } = assignRoomsForDate({ newArrivals, continuingOccupants, lockedRoomNos });
  const allIssues = [...continuityIssues, ...issues];
  await db.saveAssignments(dateStr, rooms, allIssues, { preserveManual: !force });
  return db.getAssignmentsForDate(dateStr);
}

module.exports = { generateForDate };
