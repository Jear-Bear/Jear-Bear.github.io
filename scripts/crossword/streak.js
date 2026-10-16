// streak.js — the daily streak, with the New York Times' 48-hour rule.
//
// A day counts when at least one of that day's puzzles (any mode, level or size) is
// finished within 48 hours of its release. Puzzles come out at local midnight, so a day's
// puzzles count until local midnight at the end of the next day: yesterday's puzzle can
// still keep a streak alive today, in any order. Finishing later still counts as a solve,
// just not for the streak. Solves from before solve times were saved count.
//
// Worked out from the saved progress (which sync.js keeps on the account), so the streak
// follows a signed-in person between devices.

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
const DAY = /^(\d{4}-\d{2}-\d{2})-/;           // daily puzzle IDs start with their date (deck and bonus ones don't)

// Days with a puzzle finished in time
export function streakDays(progress) {
  const on = new Set();
  Object.entries(progress || {}).forEach(([id, p]) => {
    const m = id.match(DAY);
    if (!m || !p || !p.done) return;
    if (p.solvedAt && localDate(new Date(p.solvedAt)) > addDays(m[1], 1)) return;   // after its 48 hours
    on.add(m[1]);
  });
  return on;
}

// { current, longest, today (today's counts), atRisk (yesterday's still open and the
// streak before it depends on it), riding (that streak's length) }
export function dailyStreak(progress, today = localDate()) {
  const on = streakDays(progress);
  const yesterday = addDays(today, -1);
  const run = (from) => { let n = 0; let d = from; while (on.has(d)) { n++; d = addDays(d, -1); } return n; };
  // Today and yesterday can still be done, so missing them doesn't break anything yet
  let d = today;
  while (!on.has(d) && d >= yesterday) d = addDays(d, -1);
  const current = run(d);
  const riding = run(addDays(today, -2));
  let longest = 0; let streak = 0; let prev = null;
  [...on].sort().forEach((x) => { streak = prev && addDays(prev, 1) === x ? streak + 1 : 1; longest = Math.max(longest, streak); prev = x; });
  return { current, longest, today: on.has(today), atRisk: !on.has(yesterday) && riding > 0, riding };
}
