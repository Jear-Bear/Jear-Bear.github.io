// writing.js — handwriting pad with stroke-by-stroke checking, and
// stroke-order animation. Uses KanjiVG stroke paths (109×109 box).
//
// Each drawn stroke is resampled to N points and compared with the expected
// stroke: average point distance, start/end position and length. That makes
// direction matter (a reversed stroke fails) and lets us spot a stroke drawn
// out of order (it matches a later stroke instead).

const NS = 'http://www.w3.org/2000/svg';
const N = 24;
const TOL = { trace: 14, guided: 17, memory: 21 };
const HINT_AFTER = { trace: 1, guided: 1, memory: 2 };
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
  if (parent) parent.append(n);
  return n;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function length(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function resample(pts, n = N) {
  if (pts.length === 1) return Array(n).fill(pts[0]);
  const total = length(pts);
  const step = total / (n - 1);
  const out = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const p = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
      out.push(p);
      prev = p;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

function samplePath(pathEl) {
  const total = pathEl.getTotalLength();
  const pts = [];
  for (let i = 0; i < N; i++) {
    const p = pathEl.getPointAtLength((total * i) / (N - 1));
    pts.push([p.x, p.y]);
  }
  return { pts, len: total };
}

function compare(user, ref, tol) {
  const u = resample(user);
  const r = ref.pts;
  const t = ref.len < 20 ? tol + 4 : tol;
  let sum = 0;
  let sumRev = 0;
  for (let i = 0; i < N; i++) {
    sum += dist(u[i], r[i]);
    sumRev += dist(u[i], r[N - 1 - i]);
  }
  const avg = sum / N;
  const avgRev = sumRev / N;
  const lenU = length(user);
  const lenOk = lenU >= ref.len * 0.35 && lenU <= ref.len * 2.2 + 12;
  const ok = avg <= t && dist(u[0], r[0]) <= t * 1.6 && dist(u[N - 1], r[N - 1]) <= t * 1.6 && lenOk;
  const reversed = !ok && avgRev <= t && lenOk;
  return { ok, reversed, avg };
}

function drawGuides(svg) {
  const g = el('g', { class: 'kj-guides' }, svg);
  el('line', { x1: 54.5, y1: 4, x2: 54.5, y2: 105 }, g);
  el('line', { x1: 4, y1: 54.5, x2: 105, y2: 54.5 }, g);
}

// Animate one path drawing itself (returns a promise)
function animateStroke(path, ms) {
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len} ${len}`;
  path.style.strokeDashoffset = reduceMotion() ? '0' : String(len);
  if (reduceMotion()) return Promise.resolve();
  path.getBoundingClientRect();   // commit the start state
  path.style.transition = `stroke-dashoffset ${ms}ms ease-in-out`;
  path.style.strokeDashoffset = '0';
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------- animation
// Plays the stroke order into `container`. Returns { replay, destroy }.
export function strokeAnimation(container, paths, { strokeMs = 420, gapMs = 120, numbers = true } = {}) {
  container.replaceChildren();
  const svg = el('svg', { viewBox: '0 0 109 109', class: 'kj-anim', role: 'img', 'aria-label': `Stroke order, ${paths.length} strokes` });
  container.append(svg);
  drawGuides(svg);
  const ghost = el('g', { class: 'kj-ghost' }, svg);
  const ink = el('g', { class: 'kj-ink-done' }, svg);
  const nums = el('g', { class: 'kj-nums' }, svg);
  paths.forEach((d) => el('path', { d }, ghost));
  let token = 0;

  async function play() {
    const my = ++token;
    ink.replaceChildren();
    nums.replaceChildren();
    for (let i = 0; i < paths.length; i++) {
      if (my !== token) return;
      const p = el('path', { d: paths[i] }, ink);
      if (numbers) {
        const start = p.getPointAtLength(0);
        const t = el('text', { x: start.x - 3, y: start.y - 2 }, nums);
        t.textContent = String(i + 1);
      }
      await animateStroke(p, strokeMs);
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  play();
  return { replay: play, destroy: () => { token++; container.replaceChildren(); } };
}

// ---------------------------------------------------------------- pad
export class WritingPad {
  constructor(container, { level = 'guided', onDone, onFeedback } = {}) {
    this.container = container;
    this.level = level;
    this.onDone = onDone || (() => {});
    this.onFeedback = onFeedback || (() => {});
  }

  load(paths) {
    this.paths = paths;
    this.index = 0;
    this.misses = 0;
    this.strokeMisses = 0;
    this.hints = 0;
    this.revealed = false;
    this.finished = false;

    this.container.replaceChildren();
    const svg = (this.svg = el('svg', { viewBox: '0 0 109 109', class: `kj-pad level-${this.level}`, role: 'img', 'aria-label': 'Writing area' }));
    this.container.append(svg);
    drawGuides(svg);
    this.outline = el('g', { class: 'kj-outline' }, svg);
    this.refs = paths.map((d) => el('path', { d }, this.outline));
    this.samples = this.refs.map(samplePath);
    this.doneG = el('g', { class: 'kj-ink-done' }, svg);
    this.hintG = el('g', { class: 'kj-hint' }, svg);
    this.live = el('path', { class: 'kj-live' }, svg);

    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', () => this.cancel());
  }

  point(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  down(e) {
    if (this.finished) return;
    e.preventDefault();
    this.svg.setPointerCapture(e.pointerId);
    this.drawing = [this.point(e)];
    this.live.setAttribute('d', '');
    this.live.classList.remove('miss');
  }

  move(e) {
    if (!this.drawing) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) this.drawing.push(this.point(ev));
    this.live.setAttribute('d', `M${this.drawing.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L')}`);
  }

  cancel() {
    this.drawing = null;
    this.live.setAttribute('d', '');
  }

  up() {
    const pts = this.drawing;
    this.drawing = null;
    if (!pts || this.finished) return;
    if (length(pts) < 2.5) { this.live.setAttribute('d', ''); return; }   // a tap, ignore
    const tol = TOL[this.level] || TOL.guided;
    const res = compare(pts, this.samples[this.index], tol);
    if (res.ok) {
      this.live.setAttribute('d', '');
      this.accept(this.index);
      return;
    }
    // Why it failed: direction, order, or just off
    let msg = 'Not quite. Try that stroke again.';
    if (res.reversed) msg = 'Right stroke, wrong direction.';
    else {
      for (let j = this.index + 1; j < this.samples.length; j++) {
        if (compare(pts, this.samples[j], tol).ok) { msg = `That's stroke ${j + 1}. Stroke ${this.index + 1} comes first.`; break; }
      }
    }
    this.miss(msg);
  }

  accept(i) {
    const p = el('path', { d: this.paths[i] }, this.doneG);
    p.classList.add('just-done');
    this.hintG.replaceChildren();
    this.strokeMisses = 0;
    this.index++;
    this.onFeedback('', 'ok');
    if (this.index >= this.paths.length) this.finish();
  }

  miss(msg) {
    this.misses++;
    this.strokeMisses++;
    this.live.classList.add('miss');
    setTimeout(() => { this.live.setAttribute('d', ''); this.live.classList.remove('miss'); }, 450);
    this.onFeedback(msg, 'miss');
    if (this.strokeMisses >= (HINT_AFTER[this.level] || 1)) this.showHint(false);
  }

  // Shows the next stroke; `counted` = the learner asked for it
  showHint(counted = true) {
    if (this.finished) return;
    if (counted) { this.hints++; this.misses++; }
    this.hintG.replaceChildren();
    const p = el('path', { d: this.paths[this.index] }, this.hintG);
    const start = p.getPointAtLength(0);
    el('circle', { cx: start.x, cy: start.y, r: 3.2, class: 'kj-hint-start' }, this.hintG);
    animateStroke(p, 500);
  }

  async reveal() {
    if (this.finished) return;
    this.revealed = true;
    this.hintG.replaceChildren();
    for (let i = this.index; i < this.paths.length; i++) {
      const p = el('path', { d: this.paths[i] }, this.doneG);
      p.classList.add('revealed');
      await animateStroke(p, 300);
    }
    this.index = this.paths.length;
    this.finish();
  }

  finish() {
    this.finished = true;
    this.svg.classList.add('is-finished');
    this.onDone({ misses: this.misses, hints: this.hints, revealed: this.revealed });
  }
}

// Grade a finished drawing for the scheduler
export function gradeWriting({ misses, revealed }) {
  if (revealed || misses > 3) return 'again';
  if (misses > 0) return 'hard';
  return 'good';
}
