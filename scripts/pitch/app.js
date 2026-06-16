// app.js — Pitch Mirror orchestration.
import { CLIPS, GENRES } from './data/clips.js?v=1';
import { detectPitch } from './engine/pitch-detect.js?v=1';
import {
  moraPattern, dropIndex, synthContour, normalizeTrace, resample,
} from './engine/contour.js?v=1';
import { patternScore, contourScore } from './engine/scoring.js?v=1';
import * as Store from './store.js?v=1';

const PM_VERSION = 1;
console.info(`[Pitch Mirror] v${PM_VERSION}`);

const $ = (id) => document.getElementById(id);
const store = Store.load();

// ------------------------------------------------------------ audio context
let actx = null;
const audio = () => (actx || (actx = new (window.AudioContext || window.webkitAudioContext)()));

// ------------------------------------------------------------ state
let mode = store.settings.lastMode || 'repeat';
let pool = [];
let idx = 0;
let current = null;       // active clip (+ derived target)
let micStream = null;
let recording = false;
let rafId = 0;
let liveSamples = [];     // {t, hz}
let recStart = 0;
const allClips = () => CLIPS.concat(store.userClips);

// derive target contour + drop for a clip
function prep(clip) {
  const n = clip.moras.length;
  const hl = clip.pattern.kind ? moraPattern(clip.pattern.kind, clip.pattern.drop, n) : null;
  const target = clip.contour && clip.contour.length
    ? clip.contour
    : synthContour(hl || moraPattern('heiban', 0, n));
  const drop = dropIndex(clip.pattern.kind || 'heiban', clip.pattern.drop || 0);
  return { ...clip, target, targetResampled: resample(target.map((v, i) => ({ t: i / (target.length - 1), v })), 64), drop, hl };
}

// ------------------------------------------------------------ views
function show(view) {
  for (const v of ['pm-dashboard', 'pm-review', 'pm-permission']) $(v).hidden = v !== view;
  document.body.classList.toggle('pm-focus', view === 'pm-review');
  if (view === 'pm-review') { window.scrollTo(0, 0); lockScroll(); } else unlockScroll();
}
let savedY = 0;
function lockScroll() { savedY = window.scrollY; window.scrollTo(0, 0); }
function unlockScroll() { window.scrollTo(0, savedY); }

// ------------------------------------------------------------ toasts
function toast(html, cls = '') {
  const el = document.createElement('div');
  el.className = `kt-toast ${cls}`;
  el.innerHTML = html;
  $('pm-toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 350); }, 2400);
}

// ------------------------------------------------------------ dashboard
function renderGenres() {
  const g = $('genre-group');
  g.innerHTML = `<button class="pm-chip is-active" data-filter="genre" data-val="all">Any genre</button>` +
    GENRES.map((x) => `<button class="pm-chip" data-filter="genre" data-val="${x}">${x}</button>`).join('');
}

function applyFilterActive() {
  document.querySelectorAll('.pm-chip').forEach((c) => {
    c.classList.toggle('is-active', store.settings[c.dataset.filter] === c.dataset.val);
  });
  document.querySelectorAll('.pm-mode').forEach((m) => m.classList.toggle('is-active', m.dataset.mode === mode));
  $('pm-clips-section').hidden = mode !== 'mine';
}

function buildPool() {
  const s = store.settings;
  if (mode === 'free') return [{ id: 'free', text: '—', reading: '', moras: [], type: 'free', pattern: {} }];
  if (mode === 'mine') return store.userClips.slice();
  let p = allClips();
  if (mode === 'shadow') p = p.filter((c) => c.type === 'sentence');
  if (mode === 'pairs') p = p.filter((c) => c.pair);
  if (mode === 'repeat') {
    if (s.type !== 'all') p = p.filter((c) => c.type === s.type);
  }
  if (s.gender !== 'all') p = p.filter((c) => c.gender === s.gender || !c.gender);
  if (s.genre !== 'all') p = p.filter((c) => c.genre === s.genre);
  // shuffle
  for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  // pairs mode: interleave members of each pair adjacently
  if (mode === 'pairs') p.sort((a, b) => (a.pair || '').localeCompare(b.pair || ''));
  return p;
}

function renderStats() {
  const ids = Object.keys(store.progress);
  const attempts = ids.reduce((a, id) => a + store.progress[id].attempts, 0);
  const patternHits = ids.filter((id) => store.progress[id].bestPattern).length;
  const contours = ids.map((id) => store.progress[id].bestContour).filter((x) => x > 0);
  const avgContour = contours.length ? Math.round(contours.reduce((a, b) => a + b, 0) / contours.length) : 0;
  const cells = [
    [attempts, 'total attempts'],
    [`${patternHits}`, 'patterns matched'],
    [contours.length ? `${avgContour}` : '—', 'avg contour'],
    [store.userClips.length, 'your clips'],
  ];
  $('pm-stats').innerHTML = cells.map(([v, l]) =>
    `<div class="kt-stat"><span class="kt-stat-v">${v}</span><span class="kt-stat-l">${l}</span></div>`).join('');
}

function renderClipList() {
  const list = $('pm-clip-list');
  if (!store.userClips.length) {
    list.innerHTML = `<li class="pm-empty">No clips yet. Add mined audio above to practice your own sentences.</li>`;
    return;
  }
  list.innerHTML = store.userClips.map((c) => `
    <li class="pm-clip-item">
      <span lang="ja">${c.text || '(untitled)'}</span>
      <button class="btn-link kt-danger" data-del="${c.id}">Remove</button>
    </li>`).join('');
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.del;
    store.userClips = store.userClips.filter((c) => c.id !== id);
    await Store.deleteAudio(id);
    Store.save(store, { now: true });
    renderClipList(); renderStats();
  }));
}

// ------------------------------------------------------------ session
async function startSession() {
  pool = buildPool();
  if (!pool.length) {
    toast(mode === 'mine' ? 'Add a clip first — see "Your clips" below.' : 'No clips match those filters.');
    return;
  }
  // mic needed for everything except pure listening; ask once up front
  if (!micStream) { pendingStart = true; show('pm-permission'); return; }
  idx = 0;
  $('pm-mode-label').textContent = $(`[data-mode="${mode}"] .pm-mode-name`)?.textContent || 'Practice';
  show('pm-review');
  loadClip();
}

let pendingStart = false;
async function grantMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    audio(); // unlock AudioContext within the user gesture
    if (pendingStart) { pendingStart = false; idx = 0; $('pm-mode-label').textContent = $(`[data-mode="${mode}"] .pm-mode-name`)?.textContent || 'Practice'; show('pm-review'); loadClip(); }
  } catch {
    toast('Microphone access denied — you can still play targets, but not record.', 'kt-toast-error');
    show('pm-dashboard');
  }
}

function loadClip() {
  const raw = pool[idx % pool.length];
  current = prep(raw);
  $('pm-text').textContent = current.text;
  $('pm-reading').textContent = current.reading || '';
  $('pm-pattern-label').textContent = current.type === 'free' ? 'free record'
    : `${current.pattern.kind || '—'}${current.drop ? ' · drop ' + current.drop : ''}`;
  $('pm-progress').textContent = `${(idx % pool.length) + 1} / ${pool.length}`;
  $('pm-verdict').innerHTML = '';
  liveSamples = [];
  drawStaff();
  if (current.type !== 'free') setTimeout(playTarget, 250);
}

function nextClip() { idx++; loadClip(); }

// ------------------------------------------------------------ target playback
function playTarget() {
  if (current.type === 'free') return;
  // real audio file?
  if (current.audio) {
    const a = new Audio(current.audio);
    a.play().catch(() => {});
    if (window.speechSynthesis) {} // skip TTS when real audio exists
    return;
  }
  // synthetic: glide a tone through the normalized contour
  const ac = audio();
  const dur = Math.max(0.6, current.moras.length * 0.34);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'triangle';
  const base = current.gender === 'm' ? 110 : 196; // comfortable per voice
  const span = base * 0.5;
  const freqs = new Float32Array(current.target.length);
  for (let i = 0; i < current.target.length; i++) freqs[i] = base + current.target[i] * span;
  const t0 = ac.currentTime + 0.02;
  osc.frequency.setValueCurveAtTime(freqs, t0, dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
  gain.gain.setValueAtTime(0.22, t0 + dur - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
  // optional word identity via TTS, where a JA voice exists
  speakWord();
}

function speakWord() {
  if (!window.speechSynthesis || !current.reading) return;
  const v = speechSynthesis.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith('ja'));
  if (!v) return; // no Japanese voice installed — tone is enough
  const u = new SpeechSynthesisUtterance(current.text);
  u.voice = v; u.lang = 'ja-JP'; u.rate = 0.85; u.volume = 0.9;
  setTimeout(() => speechSynthesis.speak(u), 500);
}

// ------------------------------------------------------------ recording loop
async function toggleRecord() {
  if (recording) { stopRecord(); return; }
  if (!micStream) { pendingStart = true; show('pm-permission'); return; }
  recording = true;
  liveSamples = [];
  $('pm-rec-label').textContent = 'Stop';
  $('pm-record').classList.add('is-recording');
  $('pm-verdict').innerHTML = '';
  const ac = audio();
  if (ac.state === 'suspended') await ac.resume();
  const src = ac.createMediaStreamSource(micStream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  recStart = performance.now();
  const maxMs = Math.max(2500, current.moras.length * 700);

  const loop = () => {
    if (!recording) return;
    analyser.getFloatTimeDomainData(buf);
    const r = detectPitch(buf, ac.sampleRate);
    const t = (performance.now() - recStart) / 1000;
    liveSamples.push({ t, hz: r ? r.hz : 0 });
    drawStaff();
    if (performance.now() - recStart > maxMs) { stopRecord(); return; }
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
}

function stopRecord() {
  recording = false;
  cancelAnimationFrame(rafId);
  $('pm-rec-label').textContent = 'Record';
  $('pm-record').classList.remove('is-recording');
  if (current.type === 'free') { drawStaff(true); return; }
  score();
}

// ------------------------------------------------------------ scoring + verdict
function score() {
  const norm = normalizeTrace(liveSamples);
  if (norm.points.length < 3) {
    $('pm-verdict').innerHTML = `<span class="pm-v-miss">Didn't catch much — try again, a little louder.</span>`;
    drawStaff(true);
    return;
  }
  const n = current.moras.length || 2;
  // Odaka words fall on the FOLLOWING particle, so within the word itself the
  // contour looks like heiban (no internal drop). Score against drop 0 and
  // tell the user where the real downstep lands.
  const isOdaka = current.pattern.kind === 'odaka';
  const scoreDrop = isOdaka ? 0 : current.drop;
  const ps = patternScore(norm.points, n, scoreDrop);
  const showContour = store.settings.showContour;
  let contour = null;
  if (showContour) contour = contourScore(resample(norm.points, 64), current.targetResampled);

  Store.recordAttempt(store, current.id, ps.pass, contour);

  const odakaNote = isOdaka && ps.pass
    ? `<span class="pm-v-contour">flat within the word — the drop lands on the next particle (◌を→low)</span>`
    : '';
  const verdict = `
    <span class="pm-v-pattern ${ps.pass ? 'ok' : 'miss'}">
      ${ps.pass ? '✓ pattern matched' : '✗ ' + ps.note}
    </span>
    ${odakaNote}
    ${showContour ? `<span class="pm-v-contour">contour <strong>${contour}</strong></span>` : ''}`;
  $('pm-verdict').innerHTML = verdict;
  if (ps.pass) toast('<strong>✓</strong> nailed the pitch', '');
  drawStaff(true);
  renderStats();
}

// ------------------------------------------------------------ the pitch staff
const cv = $('pm-staff');
function sizeCanvas() {
  const wrap = cv.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function cssVar(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function drawStaff(finished = false) {
  if (!current) return;
  const { ctx, w, h } = sizeCanvas();
  const padX = 22, padY = 26;
  const gw = w - padX * 2, gh = h - padY * 2;
  const accent = cssVar('--page-color', '#8b7bd8');
  const ink = cssVar('--ink', '#1c1c22');
  const muted = cssVar('--muted', '#8a8a92');
  const border = cssVar('--border', '#e5e3dd');
  ctx.clearRect(0, 0, w, h);

  const X = (t) => padX + t * gw;          // t 0..1
  const Y = (v) => padY + (1 - v) * gh;    // v 0..1 (high = up)

  // mora track + downstep markers (skip for free mode)
  const moras = current.moras || [];
  if (moras.length) {
    ctx.font = '500 15px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    for (let m = 0; m < moras.length; m++) {
      const t = (m + 0.5) / moras.length;
      ctx.fillStyle = muted;
      ctx.fillText(moras[m], X(t), padY - 8);
      if (m < moras.length - 1) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X((m + 1) / moras.length), padY);
        ctx.lineTo(X((m + 1) / moras.length), padY + gh);
        ctx.stroke();
      }
    }
    // downstep notch after the drop mora
    if (current.drop > 0 && current.drop <= moras.length) {
      const t = current.drop / moras.length;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(X(t) - 10, Y(0.82));
      ctx.lineTo(X(t), Y(0.82));
      ctx.lineTo(X(t), Y(0.30));
      ctx.stroke();
    }
  }

  // target band (synthetic contour) — calm filled area
  const tgt = current.target;
  if (tgt && tgt.length) {
    ctx.beginPath();
    ctx.moveTo(X(0), Y(tgt[0]));
    for (let i = 1; i < tgt.length; i++) ctx.lineTo(X(i / (tgt.length - 1)), Y(tgt[i]));
    ctx.lineTo(X(1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
    ctx.fillStyle = accent + '22';
    ctx.fill();
    // band top stroke
    ctx.beginPath();
    ctx.moveTo(X(0), Y(tgt[0]));
    for (let i = 1; i < tgt.length; i++) ctx.lineTo(X(i / (tgt.length - 1)), Y(tgt[i]));
    ctx.strokeStyle = accent + '99';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // live trace (normalized into its own range for relative comparison)
  if (liveSamples.length > 1) {
    const norm = normalizeTrace(liveSamples);
    const pts = norm.points;
    if (pts.length > 1) {
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const x = X(p.t), y = Y(p.v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = finished ? ink : accent;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.stroke();
      // leading dot while recording
      if (recording) {
        const last = pts[pts.length - 1];
        ctx.beginPath();
        ctx.arc(X(last.t), Y(last.v), 4, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
      }
    }
  }
}

// ------------------------------------------------------------ import user clips
async function addUserClip(file) {
  const text = $('pm-clip-text').value.trim();
  const id = 'user-' + Date.now();
  const blob = file;
  const url = URL.createObjectURL(blob);
  // compute target contour from the audio itself
  let contour = [];
  let moras = [...text].filter((c) => c.trim());
  try {
    const ac = audio();
    const arrBuf = await file.arrayBuffer();
    const decoded = await ac.decodeAudioData(arrBuf);
    contour = contourFromBuffer(decoded);
  } catch { /* fall back to flat target */ }
  const clip = {
    id, text: text || file.name.replace(/\.[^.]+$/, ''), reading: '', moras: moras.length ? moras : ['—'],
    type: 'sentence', pattern: {}, audio: url, contour, gender: '', genre: 'mined', source: 'you',
  };
  store.userClips.push(clip);
  await Store.putAudio(id, blob);
  Store.save(store, { now: true });
  $('pm-clip-text').value = '';
  renderClipList(); renderStats();
  toast('Clip added.');
}

// run the detector over a decoded buffer → normalized target contour
function contourFromBuffer(decoded) {
  const data = decoded.getChannelData(0);
  const sr = decoded.sampleRate;
  const win = 2048, hop = 1024;
  const samples = [];
  for (let i = 0; i + win < data.length; i += hop) {
    const r = detectPitch(data.subarray(i, i + win), sr);
    samples.push({ t: i / sr, hz: r ? r.hz : 0 });
  }
  const norm = normalizeTrace(samples);
  return resample(norm.points, 100);
}

// ------------------------------------------------------------ wiring
renderGenres();
applyFilterActive();
renderStats();
renderClipList();
$('pm-show-contour').checked = !!store.settings.showContour;

document.querySelector('.pm-filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.pm-chip');
  if (!chip) return;
  store.settings[chip.dataset.filter] = chip.dataset.val;
  Store.save(store);
  applyFilterActive();
});

document.querySelector('.pm-modes').addEventListener('click', (e) => {
  const m = e.target.closest('.pm-mode');
  if (!m) return;
  mode = m.dataset.mode;
  store.settings.lastMode = mode;
  Store.save(store);
  applyFilterActive();
});

$('pm-show-contour').addEventListener('change', (e) => {
  store.settings.showContour = e.target.checked;
  Store.save(store);
});

$('pm-start').addEventListener('click', startSession);
$('pm-grant').addEventListener('click', grantMic);
$('pm-perm-cancel').addEventListener('click', () => { pendingStart = false; show('pm-dashboard'); });
$('pm-end').addEventListener('click', () => { if (recording) stopRecord(); show('pm-dashboard'); });
$('pm-play').addEventListener('click', playTarget);
$('pm-record').addEventListener('click', toggleRecord);
$('pm-next').addEventListener('click', nextClip);

$('pm-add-clip').addEventListener('click', () => $('pm-file').click());
$('pm-file').addEventListener('change', (e) => { if (e.target.files[0]) addUserClip(e.target.files[0]); e.target.value = ''; });

$('pm-export').addEventListener('click', () => Store.exportJSON(store));
$('pm-reset').addEventListener('click', () => {
  if (!confirm('Reset all Pitch Mirror progress and remove your clips?')) return;
  Object.assign(store, Store.reset(store));
  renderStats(); renderClipList(); applyFilterActive();
  toast('Reset done.');
});

document.addEventListener('keydown', (e) => {
  if ($('pm-review').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); playTarget(); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); toggleRecord(); }
  else if (e.key === 'n' || e.key === 'N') { nextClip(); }
  else if (e.key === 'Escape') { if (recording) stopRecord(); show('pm-dashboard'); }
});

window.addEventListener('resize', () => { if (!$('pm-review').hidden) drawStaff(true); });
// some browsers populate voices async
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};

show('pm-dashboard');
