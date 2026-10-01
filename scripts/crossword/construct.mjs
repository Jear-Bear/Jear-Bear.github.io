// construct.mjs — builds crossword grids from the word list (Node only).
//
// Japanese newspaper style: black squares never touch side by side, every
// white square is reachable, and a square may belong to just one word (an
// unchecked square). Runs of two or more white squares are entries. After
// filling, a few squares are marked as the keyword (二重マス): read in order
// A, B, C… they spell a bonus word.

export const SIZES = {
  mini: { n: 5, maxRun: 5, blacks: [3, 6], keyword: [3, 4], minEntries: 6, fun: 1 },
  daily: { n: 9, maxRun: 7, blacks: [14, 20], keyword: [4, 6], minEntries: 18, fun: 2 },
};
export const LEVELS = ['beginner', 'intermediate', 'advanced'];
// Word-list levels per puzzle level, best match first (later ones only help the fill)
const POOLS = {
  beginner: [['n5', 'n4', 'beginner'], []],
  intermediate: [['n3', 'n2', 'intermediate'], ['n5', 'n4', 'beginner']],
  advanced: [['n1', 'advanced'], ['n3', 'n2', 'intermediate']],
};

// Small seeded RNG (mulberry32) so a date always builds the same puzzles
export function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Word pool --------------------------------------------------------------------------
export function pool(words, level, { exclude = new Set() } = {}) {
  const [main, helpers] = POOLS[level];
  const list = [];
  const seen = new Set();
  words.forEach((w) => {
    if (seen.has(w.a) || exclude.has(w.a)) return;
    const weight = main.includes(w.l) ? (w.extra ? 12 : 3) : helpers.includes(w.l) ? 1 : 0;
    if (!weight) return;
    seen.add(w.a);
    list.push({ ...w, weight });
  });
  return list;
}

function indexPool(list, maxLen) {
  const byLen = [];
  for (let L = 2; L <= maxLen; L++) {
    const ids = [];
    const pos = Array.from({ length: L }, () => new Map());
    list.forEach((w, id) => {
      if (w.a.length !== L) return;
      ids.push(id);
      [...w.a].forEach((c, i) => { const m = pos[i]; if (!m.has(c)) m.set(c, []); m.get(c).push(id); });
    });
    byLen[L] = { ids, pos };
  }
  return byLen;
}

// --- Patterns -----------------------------------------------------------------------------
function slotsOf(black, n) {
  const slots = [];
  const at = (r, c) => r >= 0 && c >= 0 && r < n && c < n && !black[r * n + c];
  for (const dir of ['across', 'down']) {
    for (let a = 0; a < n; a++) {
      let run = [];
      for (let b = 0; b <= n; b++) {
        const r = dir === 'across' ? a : b;
        const c = dir === 'across' ? b : a;
        if (b < n && at(r, c)) run.push(r * n + c);
        else { if (run.length >= 2) slots.push({ dir, cells: run }); run = []; }
      }
    }
  }
  return slots;
}

function connected(black, n) {
  const start = black.findIndex((b) => !b);
  if (start < 0) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / n), c = i % n;
    [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([y, x]) => {
      if (y < 0 || x < 0 || y >= n || x >= n) return;
      const j = y * n + x;
      if (!black[j] && !seen.has(j)) { seen.add(j); stack.push(j); }
    });
  }
  return seen.size === black.filter((b) => !b).length;
}

function pattern(size, rand) {
  const { n, maxRun, blacks: [lo, hi] } = SIZES[size];
  for (let tries = 0; tries < 500; tries++) {
    const black = new Array(n * n).fill(false);
    const target = lo + Math.floor(rand() * (hi - lo + 1));
    const canBlack = (i) => {
      if (black[i]) return false;
      const r = Math.floor(i / n), c = i % n;
      if ((r === 0 || r === n - 1) && (c === 0 || c === n - 1)) return false;       // corners stay white
      return ![[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([y, x]) => y >= 0 && x >= 0 && y < n && x < n && black[y * n + x]);
    };
    let guard = 0;
    while (black.filter(Boolean).length < target && guard++ < 400) {
      const i = Math.floor(rand() * n * n);
      if (canBlack(i)) { black[i] = true; if (!connected(black, n)) black[i] = false; }
    }
    // Break runs that are too long
    let ok = true;
    for (const s of slotsOf(black, n)) {
      if (s.cells.length <= maxRun) continue;
      const choices = s.cells.slice(2, -2).filter(canBlack);
      if (!choices.length) { ok = false; break; }
      const i = choices[Math.floor(rand() * choices.length)];
      black[i] = true;
      if (!connected(black, n)) { ok = false; break; }
    }
    if (!ok || slotsOf(black, n).some((s) => s.cells.length > maxRun)) continue;
    // Every white square must be in an entry
    const slots = slotsOf(black, n);
    const covered = new Set(slots.flatMap((s) => s.cells));
    if (black.some((b, i) => !b && !covered.has(i))) continue;
    if (slots.length < SIZES[size].minEntries) continue;
    return { black, slots };
  }
  return null;
}

// --- Fill ---------------------------------------------------------------------------------
function fill(size, list, idx, rand, { budget = 12000 } = {}) {
  const pat = pattern(size, rand);
  if (!pat) return null;
  const { n } = SIZES[size];
  const { slots } = pat;
  const letters = new Array(n * n).fill('');
  const assigned = new Array(slots.length).fill(-1);
  const used = new Set();
  const cellSlots = new Map();
  slots.forEach((s, k) => s.cells.forEach((cell) => { if (!cellSlots.has(cell)) cellSlots.set(cell, []); cellSlots.get(cell).push(k); }));
  let nodes = 0;

  const matches = (k, limit = Infinity) => {
    const s = slots[k];
    const L = s.cells.length;
    const table = idx[L];
    if (!table) return [];
    let base = null;
    s.cells.forEach((cell, i) => {
      const ch = letters[cell];
      if (!ch) return;
      const ids = table.pos[i].get(ch) || [];
      base = base == null ? ids : base;
      if (ids.length < base.length) base = ids;
    });
    const src = base == null ? table.ids : base;
    const out = [];
    for (const id of src) {
      const w = list[id].a;
      if (used.has(w)) continue;
      let ok = true;
      for (let i = 0; i < L; i++) { const ch = letters[s.cells[i]]; if (ch && w[i] !== ch) { ok = false; break; } }
      if (ok) { out.push(id); if (out.length >= limit) break; }
    }
    return out;
  };

  const solve = () => {
    if (++nodes > budget) return false;
    let best = -1, bestList = null;
    for (let k = 0; k < slots.length; k++) {
      if (assigned[k] >= 0) continue;
      const m = matches(k, 400);
      if (!m.length) return false;
      if (!bestList || m.length < bestList.length) { best = k; bestList = m; if (m.length === 1) break; }
    }
    if (best < 0) return true;
    // Weighted shuffle: the level's own words first, with variety
    const order = bestList.map((id) => ({ id, key: Math.pow(rand(), 1 / list[id].weight) })).sort((a, b) => b.key - a.key).slice(0, 24);
    const s = slots[best];
    for (const { id } of order) {
      const w = list[id].a;
      const prev = s.cells.map((c) => letters[c]);
      s.cells.forEach((c, i) => { letters[c] = w[i]; });
      assigned[best] = id; used.add(w);
      // Forward check the crossing entries
      const crossing = new Set(s.cells.flatMap((c) => cellSlots.get(c)).filter((k) => k !== best && assigned[k] < 0));
      let ok = true;
      for (const k of crossing) if (!matches(k, 1).length) { ok = false; break; }
      if (ok && solve()) return true;
      used.delete(w); assigned[best] = -1;
      s.cells.forEach((c, i) => { letters[c] = prev[i]; });
    }
    return false;
  };
  if (!solve()) return null;
  return { n, black: pat.black, letters, slots, assigned };
}

// Keyword: a word whose kana can be found in distinct squares of the grid
function keyword(size, filled, list, rand) {
  const [lo, hi] = SIZES[size].keyword;
  const answers = new Set(filled.assigned.map((id) => list[id].a));
  const where = new Map();
  filled.letters.forEach((ch, i) => { if (ch) { if (!where.has(ch)) where.set(ch, []); where.get(ch).push(i); } });
  const cands = list.filter((w) => w.a.length >= lo && w.a.length <= hi && !answers.has(w.a) && w.weight >= 3 && !w.a.includes('ー'))
    .map((w) => ({ w, key: rand() })).sort((a, b) => a.key - b.key);
  for (const { w } of cands) {
    const taken = new Set();
    const cells = [];
    for (const ch of w.a) {
      const opts = (where.get(ch) || []).filter((i) => !taken.has(i));
      if (!opts.length) break;
      const i = opts[Math.floor(rand() * opts.length)];
      taken.add(i); cells.push(i);
    }
    if (cells.length === w.a.length) return { word: w, cells };
  }
  return null;
}

// Build one puzzle. Returns the draft object (answers in clear, clues empty).
export function build({ size, level, words, seed, exclude = new Set() }) {
  const rand = rng(seed);
  const list = pool(words, level, { exclude });
  const idx = indexPool(list, SIZES[size].maxRun);
  for (let attempt = 0; attempt < 400; attempt++) {
    const f = fill(size, list, idx, rand);
    if (!f) continue;
    const share = f.assigned.filter((id) => list[id].weight >= 3).length / f.assigned.length;
    if (share < 0.6) continue;                                   // mostly the level's own words
    // At least a word or two from the fun / pop-culture list (relaxed if it keeps failing)
    const fun = f.assigned.filter((id) => list[id].extra).length;
    if (attempt < 150 && fun < SIZES[size].fun) continue;
    const kw = keyword(size, f, list, rand);
    if (!kw) continue;
    return toDraft({ size, level, f, list, kw });
  }
  throw new Error(`Couldn't build a ${level} ${size} puzzle for seed ${seed}`);
}

function toDraft({ size, level, f, list, kw }) {
  const { n } = f;
  const starts = new Map();
  let num = 0;
  for (let i = 0; i < n * n; i++) {
    if (f.black[i]) continue;
    if (f.slots.some((s) => s.cells[0] === i)) starts.set(i, ++num);
  }
  const entries = f.slots.map((s, k) => {
    const w = list[f.assigned[k]];
    return {
      num: starts.get(s.cells[0]), dir: s.dir, row: Math.floor(s.cells[0] / n), col: s.cells[0] % n, len: s.cells.length,
      answer: w.a, word: w.w, reading: w.r, meaning: w.m, source: w.l, clue: '',
    };
  }).sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));
  return {
    size, level, width: n, height: n,
    rows: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (f.black[r * n + c] ? '#' : f.letters[r * n + c])).join('')),
    entries,
    keyword: { answer: kw.word.a, word: kw.word.w, reading: kw.word.r, meaning: kw.word.m, cells: kw.cells.map((i) => [Math.floor(i / n), i % n]), clue: '' },
  };
}
