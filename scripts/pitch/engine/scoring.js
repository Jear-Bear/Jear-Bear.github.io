// scoring.js
//  · shapeScore: how closely your pitch shape follows the target (a native
//    recording, or the guide tone). This is what the page grades you on.
//  · patternScore: where the pitch falls, mora by mora. Only used when building
//    the clip library, to keep recordings whose shape matches the dictionary.
import { resample } from './contour.js?v=4';

// 0..100 from the correlation between the two pitch shapes (32 points each).
// Correlation ignores how high your voice is and how wide your range is, and
// only looks at where it rises and falls. Tested on the library: two native
// speakers saying the same word score ~88 (median); words with a different
// accent score ~0 (median). Against the library, a pass mark of 40 lets ~77%
// of correct-pattern attempts through and ~6% of wrong-pattern ones.
export const PASS = 40;
export const GREAT = 75;
export function shapeScore(attemptCurve, targetValues) {
  const a = resample(attemptCurve, 32);
  const b = resample(targetValues.map((v, i) => ({ t: i / (targetValues.length - 1 || 1), v })), 32);
  const ma = a.reduce((s, x) => s + x, 0) / 32, mb = b.reduce((s, x) => s + x, 0) / 32;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < 32; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  const r = sa && sb ? s / Math.sqrt(sa * sb) : 0;
  return Math.max(0, Math.round(r * 100));
}

// Split the voiced span into n equal mora slices, call each slice high or low
// against the attempt's own mean, and find the first high→low step.
export function estimateDrop(curve, n) {
  if (curve.length < 2 || n < 1) return { drop: 0, levels: [] };
  const vs = resample(curve, n);
  const mean = vs.reduce((a, b) => a + b, 0) / n;
  const levels = vs.map((v) => (v >= mean ? 'H' : 'L'));
  let drop = 0;
  for (let i = 0; i < n - 1; i++) {
    if (levels[i] === 'H' && levels[i + 1] === 'L') { drop = i + 1; break; }
  }
  if (drop === 0 && levels[0] === 'H' && (n === 1 || levels[1] === 'L')) drop = 1;
  return { drop, levels };
}

// targetDrop: 0 for heiban (and odaka, whose fall lands on the next particle),
// else the mora after which pitch falls.
export function patternScore(attemptCurve, moraCount, targetDrop) {
  const { drop, levels } = estimateDrop(attemptCurve, moraCount);
  const diff = Math.abs(drop - targetDrop);
  const pass = diff === 0;
  let note;
  if (pass) note = 'pitch drop in the right place';
  else if (drop === 0 && targetDrop > 0) note = 'no clear drop';
  else if (targetDrop === 0 && drop > 0) note = 'fell where it should stay up';
  else note = `drop ${drop < targetDrop ? 'early' : 'late'} by ${diff} mora`;
  return { pass, diff, attemptDrop: drop, levels, note };
}
