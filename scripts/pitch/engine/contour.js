// contour.js — turning pitch into comparable shapes.
// Everything works in *relative* pitch: target and voice each normalize to
// their own range, so a female voice shadowing a male (or vice versa) compares
// correctly. Accent is about the high/low PATTERN, not absolute Hz.

const H = 0.78, L = 0.28; // normalized levels for High / Low mora

// Tokyo-dialect pitch rules → 'H'/'L' per mora.
// kind: 'heiban'(drop 0) | 'atamadaka'(drop 1) | 'nakadaka' | 'odaka'(drop n)
export function moraPattern(kind, drop, n) {
  const a = new Array(n);
  if (kind === 'heiban') {
    for (let i = 0; i < n; i++) a[i] = i === 0 ? 'L' : 'H';
  } else if (kind === 'atamadaka') {
    for (let i = 0; i < n; i++) a[i] = i === 0 ? 'H' : 'L';
  } else { // nakadaka / odaka, drop in 1..n
    for (let i = 0; i < n; i++) {
      if (i === 0) a[i] = 'L';
      else if (i < drop) a[i] = 'H';
      else a[i] = 'L';
    }
  }
  return a;
}

// The "drop" mora index for scoring: the mora AFTER which pitch falls.
// 0 = no drop (heiban). For odaka the drop is on the following particle (= n).
export function dropIndex(kind, drop) {
  if (kind === 'heiban') return 0;
  return drop;
}

// Build a smooth normalized target curve (0..1) from a mora H/L pattern.
export function synthContour(hl, pointsPerMora = 16) {
  const pts = [];
  for (let m = 0; m < hl.length; m++) {
    const level = hl[m] === 'H' ? H : L;
    const prev = m > 0 ? (hl[m - 1] === 'H' ? H : L) : level;
    for (let p = 0; p < pointsPerMora; p++) {
      const f = p / pointsPerMora;
      // quick ease at mora boundary, then hold
      const v = f < 0.25 ? prev + (level - prev) * (f / 0.25) : level;
      pts.push(v);
    }
  }
  return pts;
}

// Convert a live sample series [{t, hz}] into a normalized 0..1 curve, using
// the series' OWN log-pitch range (this is the relative-pitch step).
export function normalizeTrace(samples) {
  const voiced = samples.filter((s) => s && s.hz > 0);
  if (voiced.length < 2) return { points: [], t0: 0, t1: 0 };
  const logs = voiced.map((s) => Math.log2(s.hz));
  let lo = Math.min(...logs), hi = Math.max(...logs);
  if (hi - lo < 0.25) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; } // ~1 octave floor
  const t0 = voiced[0].t, t1 = voiced[voiced.length - 1].t;
  const span = (hi - lo) || 1;
  const points = voiced.map((s) => ({
    t: (s.t - t0) / ((t1 - t0) || 1),
    v: (Math.log2(s.hz) - lo) / span,
  }));
  return { points, t0, t1 };
}

// Resample a {t,v} curve (t in 0..1) to n evenly-spaced values.
export function resample(curve, n = 64) {
  if (!curve.length) return new Array(n).fill(0.5);
  const out = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    while (j < curve.length - 1 && curve[j + 1].t < t) j++;
    const a = curve[j], b = curve[Math.min(j + 1, curve.length - 1)];
    const seg = (b.t - a.t) || 1;
    const f = Math.max(0, Math.min(1, (t - a.t) / seg));
    out[i] = a.v + (b.v - a.v) * f;
  }
  return out;
}

// Lightweight DTW distance between two equal-ish length numeric arrays (0..1).
// Returns average aligned absolute difference (0 = identical).
export function dtwDistance(a, b) {
  const n = a.length, m = b.length;
  const INF = Infinity;
  const prev = new Float64Array(m + 1).fill(INF);
  const cur = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(INF); cur[0] = INF;
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1]);
      const best = Math.min(prev[j], cur[j - 1], prev[j - 1]);
      cur[j] = cost + best;
    }
    prev.set(cur);
  }
  const pathLen = n + m;
  return prev[m] / pathLen;
}
