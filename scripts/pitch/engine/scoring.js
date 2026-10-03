// scoring.js — the two scores.
//  · patternScore: lenient, pedagogical — did your pitch drop after the right mora?
//  · contourScore: detailed, karaoke-style — how close was the whole shape?
import { resample, dtwDistance } from './contour.js?v=3';

// How big a fall has to be (in semitones) to count as an accent drop. Voices
// sag a little on their own, especially on the last mora of a word said alone;
// a real downstep is bigger than that.
export const DROP_ST = 2;
export const FINAL_DROP_ST = 3.5;

// Pitch (semitones) of each mora: split the voiced span into n equal slices
// and take each slice's median.
export function moraLevels(curve, n) {
  const vals = curve.map((p) => (p.st ?? p.v * 12));
  const out = new Array(n).fill(null);
  for (let m = 0; m < n; m++) {
    const lo = m / n, hi = (m + 1) / n;
    const seg = [];
    curve.forEach((p, i) => { if (p.t >= lo && p.t <= hi) seg.push(vals[i]); });
    if (seg.length) { seg.sort((a, b) => a - b); out[m] = seg[Math.floor(seg.length / 2)]; }
  }
  // fill empty slices from their neighbours
  for (let m = 0; m < n; m++) if (out[m] === null) out[m] = out[m - 1] ?? out.find((x) => x !== null) ?? 0;
  return out;
}

// Where does the attempt drop? The biggest mora-to-mora fall that's big
// enough to be a real downstep (the last mora needs a bigger one). 0 = no drop.
export function estimateDrop(curve, n, { dropSt = DROP_ST, finalDropSt = FINAL_DROP_ST } = {}) {
  if (curve.length < 2 || n < 1) return { drop: 0, levels: [], st: [] };
  const st = moraLevels(curve, n);
  let drop = 0, best = 0;
  for (let i = 0; i < n - 1; i++) {
    const fall = st[i] - st[i + 1];
    const need = i + 1 === n - 1 ? finalDropSt : dropSt;
    if (fall >= need && fall > best) { best = fall; drop = i + 1; }
  }
  const mid = (Math.max(...st) + Math.min(...st)) / 2;
  const levels = st.map((v, i) => (drop ? (i === 0 && drop > 1 ? 'L' : i < drop ? 'H' : 'L') : v >= mid ? 'H' : 'L'));
  return { drop, levels, st };
}

// targetDrop: 0 for heiban (and odaka, whose fall lands on the next particle),
// else the mora after which pitch falls.
export function patternScore(attemptCurve, moraCount, targetDrop, opts) {
  const { drop, levels, st } = estimateDrop(attemptCurve, moraCount, opts);
  const diff = Math.abs(drop - targetDrop);
  const pass = diff === 0;
  let note;
  if (pass) note = 'pitch drop in the right place';
  else if (drop === 0 && targetDrop > 0) note = 'no clear drop — try falling after mora ' + targetDrop;
  else if (targetDrop === 0 && drop > 0) note = `stay up — this one doesn’t drop (you fell after mora ${drop})`;
  else note = `your drop was ${drop < targetDrop ? 'early' : 'late'} by ${diff} mora`;
  return { pass, diff, attemptDrop: drop, levels, st, note };
}

// 0..100 closeness from DTW distance over normalized curves.
export function contourScore(attemptResampled, targetResampled) {
  const d = dtwDistance(attemptResampled, targetResampled);
  // d is avg |Δ| in 0..1 space; ~0.0 perfect, ~0.35+ poor. Map to 0..100.
  return Math.max(0, Math.min(100, Math.round(100 - d * 280)));
}
