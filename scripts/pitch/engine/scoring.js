// scoring.js — the two scores from the plan.
//  · patternScore: lenient, pedagogical — did you drop in the right place?
//  · contourScore: detailed, karaoke-style — how close was the shape?
import { resample, dtwDistance } from './contour.js';

// Estimate the drop mora from an attempt's normalized {t,v} curve.
// Split the voiced span into `n` mora-segments, take each segment's mean,
// threshold against the attempt's own midpoint → H/L, then find the H→L fall.
export function estimateDrop(curve, n) {
  if (curve.length < 2 || n < 1) return { drop: 0, levels: [] };
  const vs = resample(curve, n);
  const mean = vs.reduce((a, b) => a + b, 0) / n;
  const mid = mean; // relative threshold
  const levels = vs.map((v) => (v >= mid ? 'H' : 'L'));
  // drop = index after the last H that is immediately followed by an L
  let drop = 0;
  for (let i = 0; i < n - 1; i++) {
    if (levels[i] === 'H' && levels[i + 1] === 'L') { drop = i + 1; break; }
  }
  // atamadaka case: starts H, falls immediately
  if (drop === 0 && levels[0] === 'H' && (n === 1 || levels[1] === 'L')) drop = 1;
  return { drop, levels };
}

// targetDrop: 0 for heiban, else mora index after which it falls.
export function patternScore(attemptCurve, moraCount, targetDrop) {
  const { drop, levels } = estimateDrop(attemptCurve, moraCount);
  const diff = Math.abs(drop - targetDrop);
  const pass = diff === 0;
  let note;
  if (pass) note = 'pitch drop in the right place';
  else if (drop === 0 && targetDrop > 0) note = 'no clear drop — try falling after mora ' + targetDrop;
  else if (targetDrop === 0 && drop > 0) note = 'stay flat — this one is heiban (no drop)';
  else note = `your drop was ${drop < targetDrop ? 'early' : 'late'} by ${diff} mora`;
  return { pass, diff, attemptDrop: drop, levels, note };
}

// 0..100 closeness from DTW distance over normalized curves.
export function contourScore(attemptResampled, targetResampled) {
  const d = dtwDistance(attemptResampled, targetResampled);
  // d is avg |Δ| in 0..1 space; ~0.0 perfect, ~0.35+ poor. Map to 0..100.
  const score = Math.max(0, Math.min(100, Math.round(100 - d * 280)));
  return score;
}
