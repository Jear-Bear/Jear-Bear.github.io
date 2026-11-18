// board-image.js — the results picture attached to the daily Discord post (board.js): a dark
// card per game ("Kana Wordle, Nov 17"), one tile per player per puzzle, 8 to a row. A tile
// has the player's Discord avatar when their account has Discord linked (otherwise a circle
// with their initial, its color picked from the name), the name, and for Wordle their colored
// squares (never the kana), for the crossword their time and ★ for no reveals.
//
// Drawn with satori (layout to SVG, with the yoga layout engine) and resvg (SVG to PNG), both
// as WebAssembly the Worker imports at build time (Workers can't compile WebAssembly at runtime).
// satori stays on 0.12: newer versions bundle a text shaper that compiles WebAssembly at runtime. Text uses a bundled Noto Sans JP subset (Latin, kana, punctuation;
// SIL Open Font License, assets/OFL.txt); any other character in a name (kanji) is fetched
// from Google Fonts for just those characters. If any of it fails, the post goes out as text.

import satori, { init as initSatori } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import regular from '../assets/noto-sans-jp-400.ttf';
import bold from '../assets/noto-sans-jp-700.ttf';

const W = 1108;              // the picture's width; each card is 40 narrower, with 32 padding either side
const TILE = 116;            // 8 to a row with 10 between: 998 of the card's 1004
const GAP = 10;
const PER_ROW = 8;
const MAX_TILES = 64;        // past this a card says "+N more"
const MAX_AVATARS = 40;      // each avatar is a subrequest (the free plan allows 50 per run)
const C = {
  bg: '#121213', card: '#1a1a1b', tile: '#232325', line: '#3a3a3c', text: '#f2f2f2', muted: '#9a9a9f',
  correct: '#538d4e', present: '#b59f3b', close: '#4a7fc1', absent: '#3a3a3c', gold: '#e3b341',
};
const SQUARE = { c: C.correct, p: C.present, n: C.close, a: C.absent };
const CIRCLES = ['#e07a5f', '#3d85c6', '#6aa84f', '#c27ba0', '#e69138', '#8e7cc3', '#45818e', '#cc4125', '#76a5af', '#bf9000'];

let ready = null;
// The layout engine's loader (Emscripten) may take the Worker for a browser worker and read
// self.location.href while it starts. Workers have no location, so it gets a stand-in for
// the length of a render, removed again afterwards.
async function withLocation(fn) {
  const shim = typeof self !== 'undefined' && !self.location;
  if (shim) Object.defineProperty(self, 'location', { value: { href: 'https://sponsor-crm.invalid/' }, configurable: true });
  try { return await fn(); } finally { if (shim) delete self.location; }
}
const setup = () => ready || (ready = Promise.all([initYoga(yogaWasm).then((yoga) => initSatori(yoga)), initResvg(resvgWasm)]).catch((err) => { ready = null; throw err; }));

// satori's element tree, without JSX
const el = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c != null && c !== false) } });
const txt = (s, style) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(s) } });

export const circleColor = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return CIRCLES[h % CIRCLES.length]; };
const initial = (name) => [...String(name).trim()][0] || '?';
const clip = (s, n) => { const a = [...String(s)]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };

function face(t, avatars) {
  const src = t.avatarUrl && avatars.get(t.avatarUrl);
  if (src) return { type: 'img', props: { src, width: 44, height: 44, style: { borderRadius: 22 } } };
  return el('div', { width: 44, height: 44, borderRadius: 22, background: circleColor(t.name), alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, fontWeight: 700 }, txt(initial(t.name), {}));
}

function squares(pattern) {
  return el('div', { flexDirection: 'column', gap: 2, marginTop: 6 },
    pattern.map((row) => el('div', { flexDirection: 'row', gap: 2 }, [...row].map((m) => el('div', { width: 10, height: 10, borderRadius: 2, background: SQUARE[m] || C.absent })))));
}

function tile(t, avatars) {
  return el('div', { width: TILE, flexDirection: 'column', alignItems: 'center', padding: '10px 6px', background: C.tile, borderRadius: 10, border: t.crown ? `2px solid ${C.gold}` : `2px solid ${C.tile}` },
    face(t, avatars),
    txt(clip(t.name, 12), { color: C.text, fontSize: 14, fontWeight: 700, marginTop: 6 }),
    t.kind === 'wordle' ? txt(t.score, { color: C.muted, fontSize: 12, marginTop: 2 }) : null,
    t.kind === 'wordle' ? squares(t.pattern || []) : null,
    t.kind === 'crossword' ? txt(`${t.time}${t.clean ? '  ★' : ''}`, { color: t.clean ? C.gold : C.muted, fontSize: 15, fontWeight: 700, marginTop: 4 }) : null);
}

function card(c, avatars) {
  let left = MAX_TILES;
  let hidden = 0;
  const sections = c.sections.map((s) => {
    const shown = s.tiles.slice(0, Math.max(0, left));
    hidden += s.tiles.length - shown.length;
    left -= shown.length;
    if (!shown.length) return null;
    return el('div', { flexDirection: 'column', marginTop: 16 },
      txt(s.label, { color: C.muted, fontSize: 15, fontWeight: 700, marginBottom: 8 }),
      el('div', { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: GAP, width: PER_ROW * TILE + (PER_ROW - 1) * GAP }, shown.map((t) => tile(t, avatars))));
  });
  return el('div', { flexDirection: 'column', background: C.card, borderRadius: 16, padding: '24px 32px 28px', marginTop: 20, width: W - 40 },
    el('div', { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
      txt(c.title, { color: C.text, fontSize: 30, fontWeight: 700 }),
      c.streak ? txt(`${c.streak} day group streak`, { color: C.gold, fontSize: 16, fontWeight: 700 }) : null),
    sections,
    hidden ? txt(`+${hidden} more`, { color: C.muted, fontSize: 14, marginTop: 12 }) : null);
}

// Fonts for characters the bundled subset doesn't have (kanji in a name), from Google Fonts,
// only those characters. Emoji are left out (no glyph).
async function extraFont(lang, segment, cache) {
  if (lang === 'emoji' || !segment.trim()) return [];
  const key = segment;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    try {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=${encodeURIComponent(segment)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
      const url = (css.match(/url\((https:[^)]+)\) format\('(?:truetype|opentype)'\)/) || [])[1];
      if (!url) return [];
      // Its own family name: under the bundled font's name satori would keep using the bundled glyphs
      return [{ name: `Noto Sans JP extra ${cache.size}`, data: await (await fetch(url)).arrayBuffer(), weight: 700, style: 'normal' }];
    } catch { return []; }
  })();
  cache.set(key, p);
  return p;
}

async function loadAvatars(cards) {
  const urls = [...new Set(cards.flatMap((c) => c.sections.flatMap((s) => s.tiles.map((t) => t.avatarUrl).filter(Boolean))))].slice(0, MAX_AVATARS);
  const out = new Map();
  await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u);
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.set(u, `data:${res.headers.get('Content-Type') || 'image/png'};base64,${btoa(bin)}`);
    } catch { /* initial circle instead */ }
  }));
  return out;
}

// cards: [{ title, streak, sections: [{ label, tiles: [{ kind, name, avatarUrl?, … }] }] }] → PNG bytes
export function renderResults(cards) {
  return withLocation(() => draw(cards));
}
async function draw(cards) {
  await setup();
  const avatars = await loadAvatars(cards);
  const fontCache = new Map();
  const tree = el('div', { flexDirection: 'column', alignItems: 'center', width: W, padding: '0 20px 20px', background: C.bg, fontFamily: 'Noto Sans JP' },
    cards.map((c) => card(c, avatars)));
  const svg = await satori(tree, {
    width: W,
    fonts: [
      { name: 'Noto Sans JP', data: regular, weight: 400, style: 'normal' },
      { name: 'Noto Sans JP', data: bold, weight: 700, style: 'normal' },
    ],
    loadAdditionalAsset: (lang, segment) => extraFont(lang, segment, fontCache),
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}
