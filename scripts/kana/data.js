// data.js — kana definitions for the Kana Trainer
// Katakana are derived from hiragana (+0x60 codepoint offset), so the
// source of truth stays small and typo-proof.

const VARIANTS = {
  shi: ['si'], chi: ['ti'], tsu: ['tu'], fu: ['hu'], ji: ['zi'],
  sha: ['sya'], shu: ['syu'], sho: ['syo'],
  cha: ['tya', 'cya'], chu: ['tyu', 'cyu'], cho: ['tyo', 'cyo'],
  ja: ['jya', 'zya'], ju: ['jyu', 'zyu'], jo: ['jyo', 'zyo'],
};

// Per-character extra accepted answers (Kunrei / IME habits).
const CHAR_EXTRA = {
  'ぢ': ['di'], 'づ': ['du', 'dzu'],
  'を': ['o'], 'ん': ['nn'],
  'ぢゃ': ['dya'], 'ぢゅ': ['dyu'], 'ぢょ': ['dyo'],
};

const toKatakana = (s) =>
  [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).join('');

// [kana-or-list, readings] — index in row preserved for gojūon ordering.
const ROWS = {
  basic: [
    ['あいうえお', ['a', 'i', 'u', 'e', 'o']],
    ['かきくけこ', ['ka', 'ki', 'ku', 'ke', 'ko']],
    ['さしすせそ', ['sa', 'shi', 'su', 'se', 'so']],
    ['たちつてと', ['ta', 'chi', 'tsu', 'te', 'to']],
    ['なにぬねの', ['na', 'ni', 'nu', 'ne', 'no']],
    ['はひふへほ', ['ha', 'hi', 'fu', 'he', 'ho']],
    ['まみむめも', ['ma', 'mi', 'mu', 'me', 'mo']],
    ['やゆよ', ['ya', 'yu', 'yo']],
    ['らりるれろ', ['ra', 'ri', 'ru', 're', 'ro']],
    ['わをん', ['wa', 'wo', 'n']],
  ],
  dakuten: [
    ['がぎぐげご', ['ga', 'gi', 'gu', 'ge', 'go']],
    ['ざじずぜぞ', ['za', 'ji', 'zu', 'ze', 'zo']],
    ['だぢづでど', ['da', 'ji', 'zu', 'de', 'do']],
    ['ばびぶべぼ', ['ba', 'bi', 'bu', 'be', 'bo']],
  ],
  handakuten: [['ぱぴぷぺぽ', ['pa', 'pi', 'pu', 'pe', 'po']]],
  yoon: [
    [['きゃ', 'きゅ', 'きょ'], ['kya', 'kyu', 'kyo']],
    [['しゃ', 'しゅ', 'しょ'], ['sha', 'shu', 'sho']],
    [['ちゃ', 'ちゅ', 'ちょ'], ['cha', 'chu', 'cho']],
    [['にゃ', 'にゅ', 'にょ'], ['nya', 'nyu', 'nyo']],
    [['ひゃ', 'ひゅ', 'ひょ'], ['hya', 'hyu', 'hyo']],
    [['みゃ', 'みゅ', 'みょ'], ['mya', 'myu', 'myo']],
    [['りゃ', 'りゅ', 'りょ'], ['rya', 'ryu', 'ryo']],
  ],
  vyoon: [
    [['ぎゃ', 'ぎゅ', 'ぎょ'], ['gya', 'gyu', 'gyo']],
    [['じゃ', 'じゅ', 'じょ'], ['ja', 'ju', 'jo']],
    [['びゃ', 'びゅ', 'びょ'], ['bya', 'byu', 'byo']],
    [['ぴゃ', 'ぴゅ', 'ぴょ'], ['pya', 'pyu', 'pyo']],
  ],
};

// Extended katakana — defined directly. [char, reading, extraVariants]
const EXTENDED = [
  ['ティ', 'ti', ['thi']], ['ディ', 'di', ['dhi']],
  ['トゥ', 'tu', ['twu']], ['ドゥ', 'du', ['dwu']],
  ['チェ', 'che', ['tye']], ['シェ', 'she', ['sye']], ['ジェ', 'je', ['jye', 'zye']],
  ['ファ', 'fa'], ['フィ', 'fi'], ['フェ', 'fe'], ['フォ', 'fo'],
  ['ウィ', 'wi'], ['ウェ', 'we'], ['ウォ', 'wo'],
  ['ヴァ', 'va'], ['ヴィ', 'vi'], ['ヴ', 'vu'], ['ヴェ', 've'], ['ヴォ', 'vo'],
];

function accepted(primary, char) {
  const set = new Set([primary]);
  (VARIANTS[primary] || []).forEach((v) => set.add(v));
  (CHAR_EXTRA[char] || []).forEach((v) => set.add(v));
  return [...set];
}

function expandRows(rows, stageH, stageK, script1 = 'h') {
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const [chars, readings] = rows[r];
    const list = Array.isArray(chars) ? chars : [...chars];
    list.forEach((ch, i) => {
      const reading = readings[i];
      out.push({ char: ch, reading, accepted: accepted(reading, ch), script: 'hiragana', stage: stageH, row: r });
      if (stageK != null) {
        const k = toKatakana(ch);
        out.push({ char: k, reading, accepted: accepted(reading, ch), script: 'katakana', stage: stageK, row: r });
      }
    });
  }
  return out;
}

// Stage map:
// 1 basic hiragana · 2 basic katakana · 3 dakuten (h+k) · 4 handakuten (h+k)
// 5 yōon (h+k) · 6 voiced yōon (h+k) · 7 extended katakana · 8 mixed (no own items)
export const KANA = [
  ...expandRows(ROWS.basic, 1, 2),
  ...expandRows(ROWS.dakuten, 3, 3),
  ...expandRows(ROWS.handakuten, 4, 4),
  ...expandRows(ROWS.yoon, 5, 5),
  ...expandRows(ROWS.vyoon, 6, 6),
  ...EXTENDED.map(([char, reading, extra], i) => ({
    char, reading,
    accepted: [reading, ...(extra || [])],
    script: 'katakana', stage: 7, row: i,
  })),
];

export const BY_CHAR = Object.fromEntries(KANA.map((k) => [k.char, k]));

export const STAGES = [
  { id: 1, name: 'Basic Hiragana', short: 'ひらがな' },
  { id: 2, name: 'Basic Katakana', short: 'カタカナ' },
  { id: 3, name: 'Dakuten', short: 'がざだば' },
  { id: 4, name: 'Handakuten', short: 'ぱぴぷ' },
  { id: 5, name: 'Yōon', short: 'きゃしゃ' },
  { id: 6, name: 'Voiced Yōon', short: 'ぎゃじゃ' },
  { id: 7, name: 'Extended Katakana', short: 'ティファ' },
  { id: 8, name: 'Mixed Mastery', short: '全部' },
];

export const stageItems = (id) => KANA.filter((k) => k.stage === id);

// Classic confusable pairs — eligible from the start, surfaced once the
// user's own data confirms them (or used to seed Confusables mode).
export const SEED_PAIRS = [
  ['シ', 'ツ'], ['ソ', 'ン'], ['ぬ', 'め'], ['れ', 'わ'], ['さ', 'ち'],
  ['ね', 'れ'], ['は', 'ほ'], ['ク', 'タ'], ['ウ', 'ワ'], ['ティ', 'チ'],
  ['きゃ', 'きゅ'], ['シ', 'ン'], ['る', 'ろ'],
];
