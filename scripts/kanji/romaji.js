// romaji.js — live romaji -> hiragana for typed-reading answers.
// Handles Hepburn and common wāpuro spellings (shi/si, tsu/tu, ji/zi…),
// doubled consonants (kka -> っか), n / nn / n' -> ん, and leaves an
// unfinished tail (e.g. "k", "sh") as romaji so typing feels like an IME.

const T = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
  ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  la: 'ら', li: 'り', lu: 'る', le: 'れ', lo: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ', she: 'しぇ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', je: 'じぇ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ', zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', che: 'ちぇ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ', cya: 'ちゃ', cyu: 'ちゅ', cyo: 'ちょ',
  dya: 'ぢゃ', dyu: 'ぢゅ', dyo: 'ぢょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', ti2: 'てぃ', va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ', xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', xtu: 'っ', xtsu: 'っ',
  '-': 'ー',
};
const MAX = 4;

// Converts as much of `input` as possible. Returns the converted string;
// an unfinished romaji tail stays as-is.
export function toHiragana(input) {
  const s = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    // already kana (IME users), punctuation, spaces
    if (!/[a-z'-]/.test(c)) { out += c; i++; continue; }
    if (c === 'n') {
      const next = s[i + 1];
      // n' -> ん
      if (next === "'") { out += 'ん'; i += 2; continue; }
      // nn: before a vowel/y the second n starts the next kana (onna -> おんな);
      // otherwise (end, consonant) "nn" is just ん
      if (next === 'n') {
        if ('aiueoy'.includes(s[i + 2] || '_')) { out += 'ん'; i += 1; }
        else { out += 'ん'; i += 2; }
        continue;
      }
      // n before any other consonant -> ん
      if (next && !'aiueoy'.includes(next)) { out += 'ん'; i++; continue; }
    }
    // doubled consonant -> っ
    if (s[i + 1] === c && !'aiueon-\''.includes(c)) { out += 'っ'; i++; continue; }
    if (c === 't' && s[i + 1] === 'c' && s[i + 2] === 'h') { out += 'っ'; i++; continue; } // tchi
    let matched = false;
    for (let len = MAX; len > 0; len--) {
      const chunk = s.slice(i, i + len);
      if (T[chunk] && chunk !== 'ti2') { out += T[chunk]; i += len; matched = true; break; }
    }
    if (!matched) { out += s.slice(i); break; }   // unfinished tail
  }
  return out;
}

// Final conversion on submit: a trailing lone "n" becomes ん
export function finalize(input) {
  const h = toHiragana(input);
  return h.endsWith('n') ? h.slice(0, -1) + 'ん' : h;
}

export const isComplete = (s) => !/[a-z]/i.test(s);
