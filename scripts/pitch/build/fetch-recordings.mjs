// fetch-recordings.mjs — builds Pitch Mirror's recorded clip library.
//
// Input: candidates.json — Lingua Libre recordings on Wikimedia Commons
// (CC0 / CC BY / CC BY-SA), with the accent for each word from Kanjium
// (CC BY-SA 4.0). For every recording it:
//   1. downloads the WAV,
//   2. runs the same pitch detector the page uses and checks that where the
//      speaker's pitch falls matches the dictionary accent (recordings that
//      don't match, or are too quiet to read, are dropped),
//   3. trims silence and encodes a small mono MP3 with ffmpeg,
//   4. stores the recording's own pitch contour as the on-screen target.
// Output: out/audio/*.mp3 + out/library.json. Run by .github/workflows/pitch-audio.yml.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { detectPitch } from '../engine/pitch-detect.js';
import { normalizeTrace, resample } from '../engine/contour.js';
import { patternScore } from '../engine/scoring.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT || path.join(HERE, 'out');
const UA = 'JaredDesuSite/1.0 (https://jareddesu.com; jperlmutter1@gmail.com) pitch-mirror-build';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(OUT, 'audio'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'tmp'), { recursive: true });

export function readWav(buf) {
  let p = 12, fmt, data;
  while (p < buf.length - 8) {
    const id = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), sr: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { data = buf.subarray(p + 8, p + 8 + sz); break; }
    p += 8 + sz + (sz & 1);
  }
  if (!fmt || !data) throw new Error('not a wav');
  const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * bps * fmt.ch;
    x[i] = fmt.tag === 3 ? data.readFloatLE(o)
      : fmt.bits === 16 ? data.readInt16LE(o) / 32768
      : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608
      : fmt.bits === 32 ? data.readInt32LE(o) / 2147483648
      : (data.readUInt8(o) - 128) / 128;
  }
  return { sr: fmt.sr, x };
}

// same framing as the live page: ~43 ms windows, ~60 per second
export function trace({ sr, x }) {
  let pk = 0;
  for (const v of x) pk = Math.max(pk, Math.abs(v));
  const g = pk ? 0.5 / pk : 1;
  const win = 2 ** Math.round(Math.log2(sr * 0.0427)), hop = Math.round(sr / 60);
  const out = [];
  for (let i = 0; i + win < x.length; i += hop) {
    const r = detectPitch(x.subarray(i, i + win).map((v) => v * g), sr);
    out.push({ t: i / sr, hz: r ? r.hz : 0 });
  }
  return out;
}

const SMALL = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);
export const moras = (reading) => {
  const a = [];
  for (const c of reading) { if (SMALL.has(c) && a.length) a[a.length - 1] += c; else a.push(c); }
  return a;
};
const kindOf = (accent, n) => (accent === 0 ? 'heiban' : accent === 1 ? 'atamadaka' : accent === n ? 'odaka' : 'nakadaka');

async function get(url) {
  for (let a = 0; a < 6; a++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    console.log('  http', res.status, 'retrying');
    await sleep(5000 * (a + 1));
  }
  throw new Error('download failed');
}

const cands = JSON.parse(fs.readFileSync(path.join(HERE, 'candidates.json'), 'utf8'));
const items = [...cands.words, ...cands.phrases];
// resumable: earlier runs' results live in OUT (the pitch-audio-build branch)
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch { return d; } };
const lib = load('library.json', []);
const rejected = load('rejected.json', []);
const done = new Set([...lib.map((e) => e.title), ...rejected.map((r) => r[2])]);
const save = () => {
  fs.writeFileSync(path.join(OUT, 'library.json'), JSON.stringify(lib));
  fs.writeFileSync(path.join(OUT, 'rejected.json'), JSON.stringify(rejected, null, 1));
};
const BUDGET_MS = +(process.env.BUDGET_MIN || 20) * 60000;
const t0 = Date.now();
for (const [i, c] of items.entries()) {
  if (done.has(c.title)) continue;
  if (Date.now() - t0 > BUDGET_MS) { console.log('time budget reached; run again to continue'); break; }
  const id = crypto.createHash('md5').update(c.title).digest('hex').slice(0, 10);
  try {
    const wavBuf = await get(c.url);
    const tr = trace(readWav(wavBuf));
    const norm = normalizeTrace(tr);
    const voiced = tr.filter((s) => s.hz).length;
    if (norm.points.length < 6) { rejected.push([c.text, 'too little voice', c.title]); continue; }
    const entry = {
      id, title: c.title, text: c.text, type: c.type,
      contour: resample(norm.points, 100).map((v) => Math.round(v * 1000) / 1000),
      credit: { author: c.author, license: c.license, licenseUrl: c.licenseUrl, url: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(c.title.replace(/ /g, '_')) },
    };
    if (c.type === 'word') {
      const m = moras(c.reading), n = m.length;
      const kind = kindOf(c.accent, n);
      const target = kind === 'heiban' || kind === 'odaka' ? 0 : c.accent; // odaka falls on the next particle
      const ps = patternScore(norm.points, n, target);
      if (!ps.pass) { rejected.push([c.text, `${kind}: ${ps.note} (${ps.levels.join('')})`, c.title]); continue; }
      Object.assign(entry, { reading: c.reading, moras: m, pattern: { kind, drop: c.accent }, voiced });
    }
    const wav = path.join(OUT, 'tmp', id + '.wav');
    fs.writeFileSync(wav, wavBuf);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav,
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse',
      '-ac', '1', '-ar', '24000', '-b:a', '48k', path.join(OUT, 'audio', id + '.mp3')]);
    entry.audio = `audio/${id}.mp3`;
    lib.push(entry);
  } catch (e) {
    if (!/download failed/.test(e.message)) rejected.push([c.text, String(e.message || e), c.title]);
  }
  save();
  if (i % 25 === 0) console.log(i, '/', items.length, 'kept', lib.length);
  await sleep(250);
}
fs.rmSync(path.join(OUT, 'tmp'), { recursive: true, force: true });
save();
const left = items.filter((c) => !lib.some((e) => e.title === c.title) && !rejected.some((r) => r[2] === c.title)).length;
fs.writeFileSync(path.join(OUT, 'STATUS.txt'), `kept ${lib.length}, rejected ${rejected.length}, left ${left}\n`);
console.log('kept', lib.length, 'rejected', rejected.length, 'left', left);
