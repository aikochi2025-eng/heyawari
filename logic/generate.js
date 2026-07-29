const db = require('../db');
const { assignRoomsForDate } = require('./assign');

async function generateForDate(dateStr, { force = false } = {}) {
  const active = await db.getActiveReservations(dateStr);
  const newArrivals = active.filter((r) => r.checkin === dateStr);
  const continuingCandidates = active.filter((r) => r.checkin < dateStr);

  const continuingOccupants = [];
  const continuityIssues = [];
  for (const r of continuingCandidates) {
    const roomNo = await db.getLastKnownRoom(r.reservationId, dateStr);
    if (roomNo) {
      continuingOccupants.push({
        roomNo,
        guestName: r.guestName,
        reservationId: r.reservationId,
        site: r.site,
        amount: r.totalAmount,
        planLabel: null,
        adults: r.adults,
        children: r.children,
        infants: r.infants,
        memo: r.otherDetails || '',
        checkin: r.checkin,
        checkout: r.checkout,
        nights: r.nights,
        isContinuing: true,
      });
    } else {
      continuityIssues.push({
        type: 'CONTINUING_UNKNOWN_ROOM',
        message: `${r.guestName}様は連泊中ですが以前の部屋番号が未登録です。手動で部屋を指定してください（チェックイン${r.checkin}〜チェックアウト${r.checkout}）`,
        roomNos: [],
      });
    }
  }

  const { rooms, issues } = assignRoomsForDate({ newArrivals, continuingOccupants });
  const allIssues = [...continuityIssues, ...issues];
  await db.saveAssignments(dateStr, rooms, allIssues, { preserveManual: !force });
  return db.getAssignmentsForDate(dateStr);
}

module.exports = { generateForDate };
