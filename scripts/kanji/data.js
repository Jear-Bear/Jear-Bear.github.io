// data.js — loads the Kanji Trainer's data (built by scripts/kanji/build-data.py)
//
//   meta.json         sets + look-alikes (small, loaded first)
//   index-core.json   jōyō + jinmeiyō details
//   index-extra.json  everything else, only loaded when a set needs it
//   k/<hex>.json      per kanji: stroke paths + common words, on demand

const BASE = '/data/kanji/';
const VERSION = '1';

let meta = null;
const index = {};              // char -> entry
let extraLoaded = false;
const detailCache = new Map(); // char -> Promise<detail>

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}?v=${VERSION}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadMeta() {
  if (meta) return meta;
  const [m, core] = await Promise.all([getJSON('meta.json'), getJSON('index-core.json')]);
  meta = m;
  Object.assign(index, core);
  return meta;
}

// Loads index-extra.json if any of `chars` isn't in the core index
export async function ensureChars(chars) {
  if (extraLoaded) return;
  for (const c of chars) {
    if (!index[c]) {
      Object.assign(index, await getJSON('index-extra.json'));
      extraLoaded = true;
      return;
    }
  }
}

export async function loadAllIndex() {
  if (!extraLoaded) {
    Object.assign(index, await getJSON('index-extra.json'));
    extraLoaded = true;
  }
}

export function detail(char) {
  if (!detailCache.has(char)) {
    const hex = char.codePointAt(0).toString(16).padStart(5, '0');
    const p = getJSON(`k/${hex}.json`).catch(() => ({ s: [], w: [] }));
    detailCache.set(char, p);
  }
  return detailCache.get(char);
}

// ---------------------------------------------------------------- entries
// Index entry: [strokes, on, kun, meaning, jlpt, kanken, freq, hasStrokes]
export function info(char) {
  const e = index[char];
  if (!e) return null;
  return {
    char,
    strokes: e[0],
    on: e[1] ? e[1].split('、') : [],
    kun: e[2] ? e[2].split('、') : [],
    meaning: e[3] || '',
    jlpt: e[4] || 0,
    kanken: e[5] || '',
    freq: e[6] || 0,
    hasStrokes: !!e[7],
  };
}

export const known = (char) => !!index[char];

export function lookalikes(char) {
  return meta && meta.lookalikes[char] ? [...meta.lookalikes[char]] : [];
}

// ---------------------------------------------------------------- sets
export const KANKEN_LEVELS = [
  ['10', '10級'], ['9', '9級'], ['8', '8級'], ['7', '7級'], ['6', '6級'], ['5', '5級'],
  ['4', '4級'], ['3', '3級'], ['p2', '準2級'], ['2', '2級'], ['p1', '準1級'], ['1', '1級'],
];

export function builtinGroups() {
  return [
    {
      title: 'Official lists',
      sets: [
        { id: 'joyo', label: 'Jōyō', sub: '常用' },
        { id: 'jinmeiyo', label: 'Jinmeiyō', sub: '人名用' },
      ],
    },
    {
      title: 'JLPT',
      note: 'Community lists; there are no official JLPT kanji lists since 2010.',
      sets: [5, 4, 3, 2, 1].map((n) => ({ id: `jlpt:${n}`, label: `N${n}` })),
    },
    {
      title: 'Kanken 漢検',
      note: '準1級 and 1級 are approximate.',
      sets: KANKEN_LEVELS.map(([id, label]) => ({ id: `kanken:${id}`, label })),
    },
  ];
}

// Characters for a set id (custom lists are passed in)
export function setChars(id, custom = []) {
  if (!meta) return '';
  const [kind, key] = id.split(':');
  if (kind === 'joyo') return meta.sets.joyo;
  if (kind === 'jinmeiyo') return meta.sets.jinmeiyo;
  if (kind === 'jlpt') return meta.sets.jlpt[key] || '';
  if (kind === 'kanken') return meta.sets.kanken[key] || '';
  if (kind === 'grade') return meta.sets.grade[key] || '';
  if (kind === 'custom') {
    const list = custom.find((l) => l.id === key);
    return list ? list.chars : '';
  }
  return '';
}

export function setLabel(id, custom = []) {
  const [kind, key] = id.split(':');
  if (kind === 'joyo') return 'Jōyō';
  if (kind === 'jinmeiyo') return 'Jinmeiyō';
  if (kind === 'jlpt') return `JLPT N${key}`;
  if (kind === 'kanken') return `Kanken ${(KANKEN_LEVELS.find(([k]) => k === key) || [, key])[1]}`;
  if (kind === 'custom') {
    const list = custom.find((l) => l.id === key);
    return list ? list.name : 'My list';
  }
  return id;
}

// Union of the selected sets, in set order, without duplicates
export function selectionChars(selection, custom = []) {
  const seen = new Set();
  const out = [];
  for (const id of selection) {
    for (const c of setChars(id, custom)) {
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
  }
  return out;
}

// ---------------------------------------------------------------- kana
export const isKanji = (ch) => /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}々]/u.test(ch);
export const hasKanji = (s) => [...s].some(isKanji);
export const isKana = (s) => /^[぀-ヿー・.\-\s]+$/.test(s);

export function kataToHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 'まな.ぶ' -> { stem: 'まな', okuri: 'ぶ' }; '-ぶ' / 'ぶ-' markers dropped
export function splitKun(r) {
  const clean = r.replace(/-/g, '');
  const [stem, okuri = ''] = clean.split('.');
  return { stem, okuri };
}

// All acceptable typed forms of a kanji's readings, as hiragana
export function acceptedReadings(inf) {
  const out = new Set();
  inf.on.forEach((r) => out.add(kataToHira(r.replace(/-/g, ''))));
  inf.kun.forEach((r) => {
    const { stem, okuri } = splitKun(r);
    out.add(stem);
    if (okuri) out.add(stem + okuri);
  });
  out.delete('');
  return out;
}
