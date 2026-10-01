// kana.js — kana helpers shared by the crossword player and the builder (Node).
//
// Crossword rules (as in Japanese newspaper crosswords): one kana per square,
// small kana are written full size (ゃ→や, っ→つ), dakuten stay (が is its own
// letter), and the long-vowel mark ー takes a square. Answers are hiragana.

const SMALL = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', ゕ: 'か', ゖ: 'け' };

export const toHira = (s) => String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// Normalize to grid letters: hiragana, small kana full size. Returns '' if
// anything other than kana and ー is left.
export function gridKana(s) {
  const h = toHira(s).replace(/[ぁぃぅぇぉっゃゅょゎゕゖ]/g, (c) => SMALL[c]).replace(/[・\s]/g, '');
  return /^[あ-ゔー]+$/.test(h) ? h : '';
}

export const isGridKana = (c) => /^[あ-ゔー]$/.test(c) && !SMALL[c];

// Dakuten / handakuten cycling for the on-screen keyboard (か → が, は → ば → ぱ)
const DAKU = {};
'かがきぎくぐけげこごさざしじすずせぜそぞただちぢつづてでとど'.match(/../g).forEach((p) => { DAKU[p[0]] = p[1]; DAKU[p[1]] = p[0]; });
'はばぱひびぴふぶぷへべぺほぼぽ'.match(/.../g).forEach((p) => { DAKU[p[0]] = p[1]; DAKU[p[1]] = p[2]; DAKU[p[2]] = p[0]; });
DAKU.う = 'ゔ'; DAKU.ゔ = 'う';
export const cycleDakuten = (c) => DAKU[c] || c;

// Hepburn-ish romaji for one grid word (used to spot clues that give away
// the answer, and to show a reading hint)
const R = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu', ー: '-',
};
export function romaji(reading) {
  const s = toHira(reading);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (c === 'っ' && n && R[n]) { out += R[n][0]; continue; }
    if ('ゃゅょ'.includes(n) && R[c] && R[c].length > 1) {
      const base = R[c].slice(0, -1);
      const v = { ゃ: 'a', ゅ: 'u', ょ: 'o' }[n];
      out += /(sh|ch|j)$/.test(base) ? base + v : `${base}y${v}`;
      i++;
      continue;
    }
    out += R[c] || '';
  }
  return out.replace(/-/g, '');
}
