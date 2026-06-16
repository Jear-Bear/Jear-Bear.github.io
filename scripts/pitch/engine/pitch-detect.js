// pitch-detect.js — fundamental-frequency (F0) detection via autocorrelation.
// Pure: feed a Float32 time-domain buffer, get {hz, confidence} or null.
// Autocorrelation (not FFT-peak) because it's robust to missing-fundamental
// and harmonics — the standard choice for monophonic voice.

const MIN_HZ = 70;   // below a deep male voice
const MAX_HZ = 500;  // above a high female voice
const RMS_GATE = 0.01;
const CLARITY_GATE = 0.7; // normalized autocorrelation peak; rejects unvoiced

export function detectPitch(buf, sampleRate) {
  const SIZE = buf.length;

  // 1. RMS gate — ignore silence / very quiet (consonants, pauses)
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < RMS_GATE) return null;

  // 2. Trim leading/trailing low-amplitude edges for a cleaner correlation
  const thres = 0.2;
  let r1 = 0, r2 = SIZE - 1;
  for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
  for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
  const b = buf.subarray(r1, r2);
  const n = b.length;
  if (n < 2) return null;

  // 3. Autocorrelation
  const c = new Float32Array(n);
  for (let lag = 0; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += b[i] * b[i + lag];
    c[lag] = sum;
  }

  // 4. Find first dip then the highest peak after it
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxval = -Infinity, maxpos = -1;
  for (let i = d; i < n; i++) {
    if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  }
  if (maxpos <= 0) return null;

  // 5. Parabolic interpolation around the peak for sub-sample accuracy
  let T0 = maxpos;
  if (maxpos > 0 && maxpos < n - 1) {
    const x1 = c[maxpos - 1], x2 = c[maxpos], x3 = c[maxpos + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const bb = (x3 - x1) / 2;
    if (a !== 0) T0 = maxpos - bb / (2 * a);
  }

  const hz = sampleRate / T0;
  const confidence = c[0] > 0 ? maxval / c[0] : 0;

  if (hz < MIN_HZ || hz > MAX_HZ) return null;
  if (confidence < CLARITY_GATE) return null;
  return { hz, confidence };
}
