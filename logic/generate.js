const db = require('../db');
const { assignRoomsForDate } = require('./assign');
const { classifyPlan } = require('./classify');
const { seedMealCounts } = require('./mealItems');

async function generateForDate(dateStr, { force = false } = {}) {
  const active = await db.getActiveReservations(dateStr);
  const newArrivals = active.filter((r) => r.checkin === dateStr);
  const continuingCandidates = active.filter((r) => r.checkin < dateStr);

  const continuingOccupants = [];
  const continuityIssues = [];
  for (const r of continuingCandidates) {
    const roomNo = await db.getLastKnownRoom(r.reservationId, dateStr);
    if (roomNo) {
      const planLabel = classifyPlan(r.planName, r.meal);
      continuingOccupants.push({
        roomNo,
        guestName: r.guestName,
        reservationId: r.reservationId,
        site: r.site,
        amount: r.totalAmount,
        planLabel,
        adults: r.adults,
        children: r.children,
        infants: r.infants,
        mealCounts: seedMealCounts(planLabel, (r.adults || 0) + (r.children || 0)),
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
