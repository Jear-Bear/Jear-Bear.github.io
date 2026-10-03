// pitch-detect.js — fundamental-frequency (F0) detection for one voice.
// Pure: feed a Float32 time-domain buffer, get {hz, confidence} or null.
// Uses the McLeod Pitch Method: a normalized autocorrelation (NSDF) over the
// lags a human voice can produce, then the first peak that's close to the
// strongest one. Normalizing makes it work at any loudness, and taking the
// first strong peak (not the highest) avoids jumping down an octave.

const MIN_HZ = 70;    // below a deep male voice
const MAX_HZ = 500;   // above a high female voice
const RMS_GATE = 0.008;     // ignore silence / room noise
const CLARITY_GATE = 0.6;   // NSDF peak height; rejects breath and consonants
const PEAK_RATIO = 0.9;     // first peak within 90% of the best one wins

export function detectPitch(buf, sampleRate) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < RMS_GATE) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / MIN_HZ));
  if (maxLag <= minLag + 2) return null;

  // NSDF(τ) = 2·Σ x[i]x[i+τ] / Σ (x[i]² + x[i+τ]²), in -1..1
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = minLag - 1; tau <= maxLag + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0, end = n - tau; i < end; i++) {
      const a = buf[i], b = buf[i + tau];
      acf += a * b; m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // collect the highest point of each positive lobe
  const peaks = [];
  let tau = minLag;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;          // leave the lag-0 lobe
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return null;

  let top = 0;
  for (const p of peaks) top = Math.max(top, nsdf[p]);
  const pick = peaks.find((p) => nsdf[p] >= PEAK_RATIO * top);

  // parabolic interpolation for sub-sample accuracy
  const x1 = nsdf[pick - 1], x2 = nsdf[pick], x3 = nsdf[pick + 1];
  const d = x1 - 2 * x2 + x3;
  const shift = d ? (x1 - x3) / (2 * d) : 0;
  const period = pick + shift;
  const clarity = x2 - ((x1 - x3) * shift) / 4;

  const hz = sampleRate / period;
  if (hz < MIN_HZ || hz > MAX_HZ || clarity < CLARITY_GATE) return null;
  return { hz, confidence: clarity };
}
