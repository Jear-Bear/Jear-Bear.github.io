// data.js — Nandoku Trainer word data and answer checking.
//
// terms.json rows: [id, term, segs, readings, meaning, note, vars, hint, tags, set, of, cores]
// (see scripts/nandoku/build-data.py)

let sets = {};
let byId = new Map();
let bySet = new Map();

export async function load() {
  const res = await fetch('../../data/nandoku/terms.json?v=4');
  if (!res.ok) throw new Error(`terms.json: ${res.status}`);
  const data = await res.json();
  sets = data.sets;
  byId = new Map();
  bySet = new Map();
  for (const r of data.terms) {
    const t = {
      id: r[0], term: r[1], segs: r[2], readings: r[3], meaning: r[4], note: r[5],
      vars: r[6], hint: r[7], tags: r[8], level: r[9], of: r[10] || '', cores: r[11] || [],
    };
    byId.set(t.id, t);
    if (!bySet.has(t.level)) bySet.set(t.level, []);
    bySet.get(t.level).push(t);
  }
}

// Numbered levels first, then 別表記 and the casual-mode set
export const levelList = () => Object.keys(sets).sort();
export const levelCount = (lv) => sets[lv] || 0;
export const get = (id) => byId.get(id);
export const inLevel = (lv) => bySet.get(lv) || [];
const SET_NAMES = { alt: '別表記', kokoro: 'こころのリテラシー' };
export const levelName = (lv) => SET_NAMES[lv] || `Level ${Number(lv)}`;

// Meaning questions need a definition that says something ("字義未詳" = meaning unknown)
export const hasMeaning = (t) => !!t.meaning && !/^字義未詳/.test(t.meaning);

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

// The full reading, or just the yellow part's (とちぎ for 栃木県)
export function accepts(t, typed) {
  const v = normalize(typed);
  return t.readings.some((a) => normalize(a) === v) || t.cores.some((a) => normalize(a) === v);
}

// Readings to show on the answer card
export const readingsText = (t) => t.readings.join('、');
