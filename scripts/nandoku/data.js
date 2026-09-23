// data.js — Nandoku Trainer word data and answer checking.
//
// terms.json rows: [id, term, reading, ask, pre, suf, alts, vars, meaning, note, level, of]
// (see scripts/nandoku/build-data.py)

let levels = {};
let byId = new Map();
let byLevel = new Map();

export async function load() {
  const res = await fetch('../../data/nandoku/terms.json?v=2');
  if (!res.ok) throw new Error(`terms.json: ${res.status}`);
  const data = await res.json();
  levels = data.levels;
  byId = new Map();
  byLevel = new Map();
  for (const r of data.terms) {
    const t = {
      id: r[0], term: r[1], reading: r[2], ask: r[3], pre: r[4], suf: r[5],
      alts: r[6], vars: r[7], meaning: r[8], note: r[9], level: r[10], of: r[11] || '',
    };
    byId.set(t.id, t);
    if (!byLevel.has(t.level)) byLevel.set(t.level, []);
    byLevel.get(t.level).push(t);
  }
}

export const levelList = () => Object.keys(levels).sort();
export const levelCount = (lv) => levels[lv] || 0;
export const get = (id) => byId.get(id);
export const inLevel = (lv) => byLevel.get(lv) || [];
// 'alt' is the 別表記 set: other spellings of the level 5–7 words
export const levelName = (lv) => (lv === 'alt' ? '別表記' : `Level ${Number(lv)}`);

// ---------------------------------------------------------------- answers
export const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const VOWEL_ROWS = {
  a: 'あかさたなはまやらわがざだばぱぁゃゎ',
  i: 'いきしちにひみりぎじぢびぴぃ',
  u: 'うくすつぬふむゆるぐずづぶぷぅゅゔ',
  e: 'えけせてねへめれげぜでべぺぇ',
  o: 'おこそとのほもよろをごぞどぼぽぉょ',
};
const VOWEL_OF = {};
Object.entries(VOWEL_ROWS).forEach(([v, row]) => [...row].forEach((c) => { VOWEL_OF[c] = 'あいうえお'['aiueo'.indexOf(v)]; }));

// Hiragana, no spaces or ・, and ー spelled out as the vowel it lengthens,
// so 'グレーン', 'ぐれーん' and 'ぐれえん' all match
export function normalize(s) {
  const h = kataToHira(s.normalize('NFKC')).replace(/[\s・･.]/g, '');
  let out = '';
  for (const c of h) out += c === 'ー' && VOWEL_OF[out[out.length - 1]] ? VOWEL_OF[out[out.length - 1]] : c;
  return out;
}

export function accepts(t, typed) {
  const v = normalize(typed);
  return [t.ask, ...t.alts].some((a) => normalize(a) === v);
}

// Readings to show on the answer card: the main one plus 別解
export const readingsText = (t) => [t.reading, ...t.alts.map((a) => t.pre + a + t.suf)].join('、');
