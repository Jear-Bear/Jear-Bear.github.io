// construct.mjs — builds crossword grids from the word list (Node only).
//
// Japanese newspaper style: black squares never touch side by side, every
// white square is reachable, and a square may belong to just one word (an
// unchecked square). Runs of two or more white squares are entries. After
// filling, a few squares are marked as the keyword (二重マス): read in order
// A, B, C… they spell a bonus word.

export const SIZES = {
  mini: { n: 5, maxRun: 5, blacks: [3, 6], keyword: [3, 4], minEntries: 6, fun: 1, tries: 8 },
  daily: { n: 9, maxRun: 7, blacks: [14, 20], keyword: [4, 6], minEntries: 18, fun: 2, tries: 2 },
};
export const LEVELS = ['beginner', 'intermediate', 'advanced', 'mixed'];
// Levels a word in extra-words.json can have (mixed draws on all of them)
export const WORD_LEVELS = ['beginner', 'intermediate', 'advanced'];
// Word-list levels per puzzle level. Every answer comes from the puzzle's own
// level (solvers noticed N5 words like さむい in Intermediate when easier
// words were allowed to help the fill). Mixed is a plain Japanese crossword:
// every level, with Japanese clues.
const POOLS = {
  beginner: ['n5', 'n4', 'beginner'],
  intermediate: ['n3', 'n2', 'intermediate'],
  advanced: ['n1', 'advanced'],
  mixed: ['n5', 'n4', 'n3', 'n2', 'n1', 'beginner', 'intermediate', 'advanced'],
};
// Levels whose clues are written in Japanese
export const JAPANESE_CLUES = new Set(['mixed']);

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

// --- Themes -------------------------------------------------------------------------------
// A loose theme (data/crossword/themes.json): a word fits when a theme word
// shows up in the first two senses of its meaning, or (extra words) by tag.
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function themeMatcher(theme) {
  if (!theme) return () => false;
  const yes = new RegExp(`\\b(?:${theme.words.map(escapeRe).join('|')})(?:s|es|ed|d|ing|er|ers)?\\b`, 'i');
  const no = theme.not && theme.not.length ? new RegExp(theme.not.join('|'), 'i') : null;
  const tags = new Set(theme.tags || []);
  return (w) => {
    if (w.t && w.t.some((t) => tags.has(t))) return true;
    const senses = String(w.m).replace(/\([^)]*\)/g, '').split(/[,;]/).slice(0, 2).join(', ');
    return yes.test(senses) && !(no && no.test(w.m));
  };
}

// --- Word pool --------------------------------------------------------------------------
export function pool(words, level, { exclude = new Set(), theme = null } = {}) {
  const levels = POOLS[level];
  const fits = themeMatcher(theme);
  const list = [];
  const seen = new Set();
  words.forEach((w) => {
    if (seen.has(w.a) || exclude.has(w.a) || !levels.includes(w.l)) return;
    seen.add(w.a);
    const th = fits(w) ? 1 : 0;
    // Fun words come up more often (weights are relative). Theme words aren't
    // weighted: that makes grids much harder to fill. They're seeded instead.
    list.push({ ...w, th, weight: w.extra ? 12 : 3 });
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

// --- Shapes ---------------------------------------------------------------------------------
// Now and then a puzzle gets a fun NYT-style shape: a motif of black squares
// that may touch and form a picture (stairs, a heart, a tetris piece...).
// Some are tidy and some lopsided on purpose. '#' is a motif square; the rest
// of the grid is filled in around it with the usual pattern rules, so the
// grid stays fillable. (Fully-crossed shaped grids like
// the NYT's rarely fill with kana: there are only ~60 seven-kana words.)
// A motif may appear mirrored or turned, except UPRIGHT ones.
export const SHAPES = {
  mini: {
    stairs: ['##...', '#....', '.....', '....#', '...##'],
    diagonal: ['#....', '.#...', '.....', '...#.', '....#'],
    pinwheel: ['#....', '...#.', '.....', '.#...', '....#'],
    window: ['.....', '.#.#.', '.....', '.#.#.', '.....'],
    tetris: ['##...', '.....', '...#.', '..##.', '.....'],
    zigzag: ['.....', '##...', '.....', '...##', '.....'],
  },
  daily: {
    stairs: ['###......', '##.......', '#........', '.........', '....#....', '.........', '........#', '.......##', '......###'],
    gem: ['.........', '.........', '....#....', '...###...', '..#####..', '...###...', '....#....', '.........', '.........'],
    plus: ['.........', '.........', '.........', '....#....', '...###...', '....#....', '.........', '.........', '.........'],
    xmark: ['#.......#', '.#.....#.', '..#...#..', '.........', '.........', '.........', '..#...#..', '.#.....#.', '#.......#'],
    pinwheel: ['...#.....', '...#.....', '...#.....', '.......##', '....#....', '##.......', '.....#...', '.....#...', '.....#...'],
    heart: ['#########', '##..#..##', '#.......#', '.........', '.........', '#.......#', '##.....##', '###...###', '####.####'],
    corners: ['##.....##', '#.......#', '.........', '.........', '.........', '.........', '.........', '#.......#', '##.....##'],
    // Quirky, lopsided ones
    tetris: ['##.......', '#........', '.........', '......#..', '.....###.', '.........', '.#.......', '.##......', '.#.......'],
    snake: ['.........', '.###.....', '...#.....', '...###...', '.....#...', '.....###.', '.........', '.........', '.........'],
    bite: ['####.....', '###......', '##.......', '#........', '.........', '.........', '.........', '.........', '.........'],
    steps: ['##.......', '.##......', '..##.....', '.........', '.........', '.....##..', '......##.', '.......##', '.........'],
    blob: ['.........', '.........', '...##....', '..####...', '...###...', '....#....', '.........', '.........', '.........'],
  },
};
const UPRIGHT = new Set(['heart']);

function motif(size, name, rand) {
  let rows = SHAPES[size][name].map((r) => [...r]);
  if (rand() < 0.5) rows = rows.map((r) => r.reverse());                                     // mirror
  if (!UPRIGHT.has(name) && rand() < 0.5) rows = rows[0].map((_, c) => rows.map((r) => r[c])); // turn
  return rows.flat().map((ch) => ch === '#');
}

// The square that mirrors i, so extra squares can keep the picture symmetric:
// left-right for upright shapes (the heart), otherwise turned 180°
const partner = (i, n, shape) => (UPRIGHT.has(shape) ? Math.floor(i / n) * n + (n - 1 - (i % n)) : n * n - 1 - i);

// Longest entry. Shaped grids, and 9x9s from the smaller beginner and N1
// lists, keep entries to 5 kana: each level has only ~10-45 words of seven
// kana, and long slots were the main reason those grids failed to fill.
const SHORT = new Set(['beginner', 'advanced']);
const maxRunFor = (size, level, shape) => (shape || SHORT.has(level) ? Math.min(SIZES[size].maxRun, 5) : SIZES[size].maxRun);

// Unchecked squares ("unches"): white squares in only one entry. Solvers find
// them unfair (no second clue to help), so of several valid patterns we keep
// the one with the fewest.
export function unches(black, n) {
  const W = (r, c) => r >= 0 && c >= 0 && r < n && c < n && !black[r * n + c];
  let u = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (W(r, c) && !((W(r, c - 1) || W(r, c + 1)) && (W(r - 1, c) || W(r + 1, c)))) u++;
    }
  }
  return u;
}

function pattern(size, rand, shape = null, maxRun = SIZES[size].maxRun, tries = 1) {
  let best = null;
  for (let k = 0; k < tries; k++) {
    const p = onePattern(size, rand, shape, maxRun);
    if (!p) continue;
    p.unches = unches(p.black, SIZES[size].n);
    if (!best || p.unches < best.unches) best = p;
    if (best.unches === 0) break;
  }
  return best;
}

function onePattern(size, rand, shape = null, maxRun = SIZES[size].maxRun) {
  const { n, blacks: [lo, hi] } = SIZES[size];
  for (let tries = 0; tries < 500; tries++) {
    const black = shape ? motif(size, shape, rand) : new Array(n * n).fill(false);
    // A shape keeps its motif; a 9x9 gets a few extra squares, mirrored in
    // pairs half the time and scattered (quirkier) the other half
    const base = black.filter(Boolean).length;
    const sym = shape && rand() < 0.5;
    const target = shape ? base + (size === 'mini' ? 0 : 4 + 2 * Math.floor(rand() * 3)) : lo + Math.floor(rand() * (hi - lo + 1));
    const canBlack = (i) => {
      if (black[i]) return false;
      const r = Math.floor(i / n), c = i % n;
      if ((r === 0 || r === n - 1) && (c === 0 || c === n - 1)) return false;       // corners stay white
      return ![[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([y, x]) => y >= 0 && x >= 0 && y < n && x < n && black[y * n + x]);
    };
    // Add a square (and, on a shape, its mirror partner when it fits); undo
    // if it splits the grid
    const add = (i) => {
      if (!canBlack(i)) return false;
      black[i] = true;
      const j = sym ? partner(i, n, shape) : i;
      const pair = j !== i && canBlack(j);
      if (pair) black[j] = true;
      if (connected(black, n)) return true;
      if (pair) { black[j] = false; if (connected(black, n)) return true; }
      black[i] = false;
      return false;
    };
    let guard = 0;
    while (black.filter(Boolean).length < target && guard++ < 400) add(Math.floor(rand() * n * n));
    // Break runs that are too long
    let ok = connected(black, n);
    for (let pass = 0; ok && pass < 3; pass++) {
      for (const s of slotsOf(black, n)) {
        if (s.cells.length <= maxRun) continue;
        // Prefer a break that leaves runs of 2+; a 1-square run is fine if
        // the square is in a word the other way (checked below)
        let choices = s.cells.slice(2, -2).filter(canBlack);
        if (!choices.length && shape) choices = s.cells.slice(1, -1).filter(canBlack);
        if (!choices.length || !add(choices[Math.floor(rand() * choices.length)])) { ok = false; break; }
      }
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
function fill(size, list, idx, rand, { budget = 12000, seeds = 0, shape = null, width = 24, maxRun, tries = 1 } = {}) {
  const pat = pattern(size, rand, shape, maxRun, tries);
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
    // Weighted shuffle: fun words come up more often, with variety
    const order = bestList.map((id) => ({ id, key: Math.pow(rand(), 1 / list[id].weight) })).sort((a, b) => b.key - a.key).slice(0, width);
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
  // Theme seeds: drop a few theme words into slots that don't cross each
  // other, then let the search fill in around them.
  if (seeds) {
    const themeIds = list.map((w, id) => (w.th ? id : -1)).filter((id) => id >= 0);
    const taken = new Set();
    const order = slots.map((s, k) => ({ k, key: rand() + Math.abs(s.cells.length - 4) / 3 })).sort((a, b) => a.key - b.key);   // 3–5 kana slots first
    let placed = 0;
    for (const { k } of order) {
      if (placed >= seeds) break;
      const s = slots[k];
      if (s.cells.length < 3 || s.cells.some((c) => cellSlots.get(c).some((j) => taken.has(j)))) continue;
      const fits = themeIds.filter((id) => list[id].a.length === s.cells.length && !used.has(list[id].a))
        .map((id) => ({ id, key: Math.pow(rand(), 1 / list[id].weight) })).sort((a, b) => b.key - a.key).slice(0, 12);
      for (const { id } of fits) {
        const w = list[id].a;
        s.cells.forEach((c, i) => { letters[c] = w[i]; });
        const crossing = s.cells.flatMap((c) => cellSlots.get(c)).filter((j) => j !== k);
        if (crossing.every((j) => matches(j, 1).length)) { assigned[k] = id; used.add(w); taken.add(k); crossing.forEach((j) => taken.add(j)); placed++; break; }
        s.cells.forEach((c) => { letters[c] = ''; });
      }
    }
  }
  if (!solve()) return null;
  return { n, black: pat.black, letters, slots, assigned };
}

// Keyword: a word whose kana can be found in distinct squares of the grid
function keyword(size, filled, list, rand) {
  const [lo, hi] = SIZES[size].keyword;
  const answers = new Set(filled.assigned.map((id) => list[id].a));
  const where = new Map();
  filled.letters.forEach((ch, i) => { if (ch) { if (!where.has(ch)) where.set(ch, []); where.get(ch).push(i); } });
  // Theme words first, so the bonus word usually lands on the theme
  const cands = list.filter((w) => w.a.length >= lo && w.a.length <= hi && !answers.has(w.a) && !w.a.includes('ー'))
    .map((w) => ({ w, key: rand() + (w.th ? 0 : 1) })).sort((a, b) => a.key - b.key);
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
// With a theme, one theme word is seeded into the empty grid, the bonus
// keyword is a theme word when the letters allow, and of the first few grids
// that fill, the one with the most theme answers wins. The theme stays loose
// on purpose: weighting theme words in the search makes grids fail to fill.
export function build({ size, level, words, seed, exclude = new Set(), theme = null, shape = null }) {
  const rand = rng(seed);
  const list = pool(words, level, { exclude, theme });
  const idx = indexPool(list, SIZES[size].maxRun);
  const keep = theme ? SIZES[size].tries : 1;
  let best = null;
  // Most random patterns don't fill (a 9x9 from the small beginner list fills
  // only a few percent of the time), so try plenty; failures are fast.
  // A shaped day tries its shape first and falls back to a normal grid if
  // the shape won't fill at this level.
  const shaped = shape ? 600 : 0;
  for (let attempt = 0; attempt < shaped + 1500 && !(best && best.n >= keep); attempt++) {
    const useShape = attempt < shaped ? shape : null;
    if (best && best.shape && !useShape) break;                  // keep a shaped grid over a plain one
    const plain = attempt - shaped;                              // attempts since the plain grids began
    // Fewest unches first: pick the best of 40 patterns, then of 10, then any
    const phase = useShape ? attempt : plain;
    const tries = phase < 400 ? 40 : phase < 800 ? 10 : 1;
    const f = fill(size, list, idx, rand, { seeds: theme && (useShape ? attempt < 300 : plain < 300) ? 1 : 0, shape: useShape, maxRun: maxRunFor(size, level, useShape), tries });
    if (!f) continue;
    f.shape = useShape;
    // At least a word or two from the fun / pop-culture list (relaxed if it keeps failing)
    const fun = f.assigned.filter((id) => list[id].extra).length;
    if ((useShape ? attempt : plain) < 150 && fun < SIZES[size].fun) continue;
    const kw = keyword(size, f, list, rand);
    if (!kw) continue;
    // Theme answers count for the score, unchecked squares against it
    const score = f.assigned.filter((id) => list[id].th).length + (kw.word.th ? 2 : 0) - unches(f.black, f.n) / 3;
    if (!best || score > best.score) best = { f, kw, score, shape: useShape, n: (best ? best.n : 0) + 1 };
    else best.n++;
  }
  if (best) return toDraft({ size, level, f: best.f, list, kw: best.kw });
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
      answer: w.a, word: w.w, reading: w.r, meaning: w.m, source: w.l, ...(w.th ? { theme: true } : {}), clue: '',
    };
  }).sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));
  return {
    size, level, width: n, height: n, ...(f.shape ? { shape: f.shape } : {}),
    rows: Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (f.black[r * n + c] ? '#' : f.letters[r * n + c])).join('')),
    entries,
    keyword: { answer: kw.word.a, word: kw.word.w, reading: kw.word.r, meaning: kw.word.m, ...(kw.word.th ? { theme: true } : {}), cells: kw.cells.map((i) => [Math.floor(i / n), i % n]), clue: '' },
  };
}
