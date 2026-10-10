// freeform.mjs — freeform crosswords: each word is placed where it crosses a
// word already in the grid, like a classic word-list crossword, so every
// answer comes from the list and nothing else needs to fit.
//
// Used for kanji puzzles (nearly every kanji word is two characters, which the
// dense newspaper-style grids in construct.mjs can't fill) and for puzzles
// from a player's own Anki deck (only their words, no filler). Plain
// JavaScript: runs in Node (cli.mjs) and in the browser (deck-worker.js).
//
// Rules: a word may only touch other words where it crosses them, so every
// run of two or more squares in the finished grid is one of the words.

import { rng } from './construct.mjs';

// n: the grid is at most n×n. words: how many to aim for (fewer is fine down
// to min). keyword: length range of the bonus word in the double-boxed squares.
export const FREE_SIZES = {
  kanji: {
    mini: { n: 5, words: 9, min: 5, keyword: [2, 3] },
    daily: { n: 8, words: 22, min: 10, keyword: [2, 4] },
  },
  kana: {
    mini: { n: 6, words: 8, min: 5, keyword: [3, 4] },
    daily: { n: 9, words: 20, min: 12, keyword: [4, 6] },
  },
};

const chars = (s) => [...s];

// One attempt: grow a grid word by word. list items: { a, weight }
function grow(list, spec, rand) {
  const { n } = spec;
  const cells = new Map();                 // "r,c" -> { ch, across, down }
  const byChar = new Map();                // ch -> Set of "r,c"
  const placed = [];                       // { id, r, c, dir }
  const used = new Set();
  let box = null;                          // [minR, maxR, minC, maxC]
  const get = (r, c) => cells.get(`${r},${c}`);

  const fits = (w, r, c, dir, first = false) => {
    const L = w.length;
    const [dr, dc] = dir === 'across' ? [0, 1] : [1, 0];
    if (get(r - dr, c - dc) || get(r + dr * L, c + dc * L)) return -1;
    let cross = 0;
    for (let i = 0; i < L; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      const x = get(rr, cc);
      if (x) {
        if (x.ch !== w[i] || x[dir] != null) return -1;
        cross++;
      } else if (get(rr + dc, cc + dr) || get(rr - dc, cc - dr)) return -1;     // would touch a word side by side
    }
    if (!first && !cross) return -1;
    if (cross === L) return -1;
    const b = box || [r, r, c, c];
    const nb = [Math.min(b[0], r), Math.max(b[1], r + dr * (L - 1)), Math.min(b[2], c), Math.max(b[3], c + dc * (L - 1))];
    if (nb[1] - nb[0] >= n || nb[3] - nb[2] >= n) return -1;
    return cross;
  };

  const put = (id, r, c, dir) => {
    const w = list[id].ch;
    const [dr, dc] = dir === 'across' ? [0, 1] : [1, 0];
    const k = placed.length;
    for (let i = 0; i < w.length; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      const key = `${rr},${cc}`;
      let x = cells.get(key);
      if (!x) {
        x = { ch: w[i], across: null, down: null };
        cells.set(key, x);
        if (!byChar.has(w[i])) byChar.set(w[i], new Set());
        byChar.get(w[i]).add(key);
      }
      x[dir] = k;
      box = box ? [Math.min(box[0], rr), Math.max(box[1], rr), Math.min(box[2], cc), Math.max(box[3], cc)] : [rr, rr, cc, cc];
    }
    placed.push({ id, r, c, dir });
    used.add(list[id].a);
  };

  // Weighted random order (preferred and fun words come up more often)
  const order = () => list.map((w, id) => ({ id, key: Math.pow(rand(), 1 / w.weight) })).sort((x, y) => y.key - x.key).map((x) => x.id);

  // First word: a longer one, across
  const firstOrder = order().filter((id) => list[id].ch.length <= n);
  const first = firstOrder.find((id) => list[id].ch.length >= Math.min(4, n - 1)) ?? firstOrder[0];
  if (first == null) return null;
  put(first, 0, 0, Math.min(list[first].ch.length, n) && rand() < 0.5 ? 'across' : 'down');

  while (placed.length < spec.words) {
    let best = null;
    // Only words that share a letter with a square that can still be crossed
    const cand = new Set();
    for (const [ch, keys] of byChar) {
      if (![...keys].some((k) => { const x = cells.get(k); return x.across == null || x.down == null; })) continue;
      for (const id of list.withChar.get(ch) || []) cand.add(id);
    }
    for (const id of cand) {
      const w = list[id];
      if (used.has(w.a)) continue;
      for (let i = 0; i < w.ch.length; i++) {
        for (const key of byChar.get(w.ch[i]) || []) {
          const x = cells.get(key);
          const [r0, c0] = key.split(',').map(Number);
          for (const dir of ['across', 'down']) {
            if (x[dir] != null) continue;
            const r = dir === 'down' ? r0 - i : r0;
            const c = dir === 'across' ? c0 - i : c0;
            const cross = fits(w.ch, r, c, dir);
            if (cross < 0) continue;
            // More crossings and a squarer grid are better; a little noise for variety
            const score = cross * 3 + (w.pref ? 2 : 0) + w.ch.length * 0.3 + Math.pow(rand(), 1 / w.weight) * 2;
            if (!best || score > best.score) best = { id, r, c, dir, score };
          }
        }
      }
    }
    if (!best) break;
    put(best.id, best.r, best.c, best.dir);
  }
  return { cells, placed, box };
}

// Every run of 2+ squares, across and down, in an n×n array of letters ('' = black)
function runs(grid, n) {
  const out = [];
  for (const dir of ['across', 'down']) {
    for (let a = 0; a < n; a++) {
      let run = [];
      for (let b = 0; b <= n; b++) {
        const r = dir === 'across' ? a : b;
        const c = dir === 'across' ? b : a;
        if (b < n && grid[r][c]) run.push([r, c]);
        else { if (run.length >= 2) out.push({ dir, cells: run }); run = []; }
      }
    }
  }
  return out;
}

// Build one puzzle from list (items: { a: answer, w: written, r: reading,
// m: meaning, weight?, pref? }). Returns the draft shape construct.mjs uses
// (rows with '#', entries with clue '', keyword or null), with free: true.
export function buildFree({ size, level, kind = 'kana', words, seed, spec = null, attempts = 40, exclude = new Set() }) {
  const S = spec || FREE_SIZES[kind][size];
  const rand = rng(seed);
  const seen = new Set();
  const list = [];
  for (const w of words) {
    if (!w || !w.a || seen.has(w.a) || exclude.has(w.a)) continue;
    const ch = chars(w.a);
    if (ch.length < 2 || ch.length > S.n) continue;
    seen.add(w.a);
    list.push({ ...w, ch, weight: w.weight || (w.pref ? 30 : w.extra ? 12 : 3) });
  }
  // Which words have each letter, to find crossings fast
  list.withChar = new Map();
  list.forEach((w, id) => new Set(w.ch).forEach((ch) => { if (!list.withChar.has(ch)) list.withChar.set(ch, []); list.withChar.get(ch).push(id); }));
  let best = null;
  for (let t = 0; t < attempts; t++) {
    const g = grow(list, S, rand);
    if (!g || g.placed.length < S.min) continue;
    const cross = [...g.cells.values()].filter((x) => x.across != null && x.down != null).length;
    const area = (g.box[1] - g.box[0] + 1) * (g.box[3] - g.box[2] + 1);
    const score = g.placed.length * 2 + cross + (g.cells.size / area) * 4;
    if (!best || score > best.score) best = { g, score };
    if (g.placed.length >= S.words && t >= 8) break;
  }
  if (!best) throw new Error(`Couldn't build a ${kind} ${size} puzzle for seed ${seed}`);
  return toDraft(best.g, { size, level, list, S, rand });
}

function toDraft(g, { size, level, list, S, rand }) {
  const [r0, r1, c0, c1] = g.box;
  const h = r1 - r0 + 1, w = c1 - c0 + 1;
  // Center it in a square grid
  const n = Math.max(h, w);
  const dr = Math.floor((n - h) / 2) - r0, dc = Math.floor((n - w) / 2) - c0;
  const grid = Array.from({ length: n }, () => new Array(n).fill(''));
  for (const [key, x] of g.cells) { const [r, c] = key.split(',').map(Number); grid[r + dr][c + dc] = x.ch; }
  // Numbers, in reading order
  const slots = runs(grid, n);
  const starts = [...new Set(slots.map((s) => s.cells[0][0] * n + s.cells[0][1]))].sort((a, b) => a - b);
  const numOf = new Map(starts.map((i, k) => [i, k + 1]));
  const words = new Map(g.placed.map((p) => [`${p.dir}:${p.r + dr},${p.c + dc}`, list[p.id]]));
  const entries = slots.map((s) => {
    const [r, c] = s.cells[0];
    const wd = words.get(`${s.dir}:${r},${c}`);
    if (!wd || wd.ch.length !== s.cells.length) throw new Error('Freeform grid has a run that isn’t a word');
    return { num: numOf.get(r * n + c), dir: s.dir, row: r, col: c, len: s.cells.length, answer: wd.a, word: wd.w, reading: wd.r, meaning: wd.m, clue: '', ...(wd.pref ? { pref: true } : {}) };
  }).sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));
  return {
    size, level, width: n, height: n, free: true,
    rows: grid.map((row) => row.map((ch) => ch || '#').join('')),
    entries,
    keyword: keyword(grid, n, list, new Set(entries.map((e) => e.answer)), S.keyword, rand),
  };
}

// A word (not an answer) whose letters are in distinct squares of the grid
function keyword(grid, n, list, answers, [lo, hi], rand) {
  const where = new Map();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const ch = grid[r][c]; if (ch) { if (!where.has(ch)) where.set(ch, []); where.get(ch).push([r, c]); } }
  const cands = list.filter((w) => w.ch.length >= lo && w.ch.length <= hi && !answers.has(w.a) && !w.a.includes('ー'))
    .map((w) => ({ w, key: rand() - (w.pref ? 0.5 : 0) })).sort((a, b) => a.key - b.key);
  for (const { w } of cands) {
    const taken = new Set();
    const cells = [];
    for (const ch of w.ch) {
      const opts = (where.get(ch) || []).filter(([r, c]) => !taken.has(`${r},${c}`));
      if (!opts.length) break;
      const p = opts[Math.floor(rand() * opts.length)];
      taken.add(`${p[0]},${p[1]}`);
      cells.push(p);
    }
    if (cells.length === w.ch.length) return { answer: w.a, word: w.w, reading: w.r, meaning: w.m, cells, clue: '' };
  }
  return null;
}
