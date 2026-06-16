// clips.js — curated seed library. All synthetic (target = the accent pattern
// rendered as a glide tone), so what matters is pattern correctness. Real audio
// can be swapped in per-clip later by setting `audio` and precomputing `contour`.
//
// pattern.kind: 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka'
// pattern.drop: mora after which pitch falls (0 = heiban). odaka = mora count.
// moras: array used for the per-mora track labels.

export const CLIPS = [
  // ── classic minimal pairs (same kana, different accent) ──────────────
  { id: 'hashi-1', text: '箸', reading: 'はし', moras: ['は', 'し'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, pair: 'hashi', gender: 'f', genre: 'common', source: 'curated' },
  { id: 'hashi-2', text: '橋', reading: 'はし', moras: ['は', 'し'], type: 'word',
    pattern: { kind: 'odaka', drop: 2 }, pair: 'hashi', gender: 'f', genre: 'common', source: 'curated' },
  { id: 'hashi-0', text: '端', reading: 'はし', moras: ['は', 'し'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, pair: 'hashi', gender: 'f', genre: 'common', source: 'curated' },

  { id: 'ame-1', text: '雨', reading: 'あめ', moras: ['あ', 'め'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, pair: 'ame', gender: 'm', genre: 'common', source: 'curated' },
  { id: 'ame-0', text: '飴', reading: 'あめ', moras: ['あ', 'め'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, pair: 'ame', gender: 'm', genre: 'common', source: 'curated' },

  { id: 'kaki-1', text: '牡蠣', reading: 'かき', moras: ['か', 'き'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, pair: 'kaki', gender: 'f', genre: 'common', source: 'curated' },
  { id: 'kaki-0', text: '柿', reading: 'かき', moras: ['か', 'き'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, pair: 'kaki', gender: 'f', genre: 'common', source: 'curated' },

  { id: 'ima-1', text: '今', reading: 'いま', moras: ['い', 'ま'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, gender: 'm', genre: 'common', source: 'curated' },

  // ── common vocabulary (single, no pair) ──────────────────────────────
  { id: 'watashi', text: '私', reading: 'わたし', moras: ['わ', 'た', 'し'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, gender: 'f', genre: 'common', source: 'curated' },
  { id: 'sensei', text: '先生', reading: 'せんせい', moras: ['せ', 'ん', 'せ', 'い'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, gender: 'm', genre: 'common', source: 'curated' },
  { id: 'gakusei', text: '学生', reading: 'がくせい', moras: ['が', 'く', 'せ', 'い'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, gender: 'f', genre: 'common', source: 'curated' },
  { id: 'nihongo', text: '日本語', reading: 'にほんご', moras: ['に', 'ほ', 'ん', 'ご'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, gender: 'm', genre: 'common', source: 'curated' },
  { id: 'tabemono', text: '食べ物', reading: 'たべもの', moras: ['た', 'べ', 'も', 'の'], type: 'word',
    pattern: { kind: 'nakadaka', drop: 2 }, gender: 'f', genre: 'common', source: 'curated' },
  { id: 'tomodachi', text: '友達', reading: 'ともだち', moras: ['と', 'も', 'だ', 'ち'], type: 'word',
    pattern: { kind: 'heiban', drop: 0 }, gender: 'm', genre: 'casual', source: 'curated' },
  { id: 'genki', text: '元気', reading: 'げんき', moras: ['げ', 'ん', 'き'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, gender: 'f', genre: 'casual', source: 'curated' },
  { id: 'kirei', text: '綺麗', reading: 'きれい', moras: ['き', 'れ', 'い'], type: 'word',
    pattern: { kind: 'atamadaka', drop: 1 }, gender: 'f', genre: 'casual', source: 'curated' },

  // ── short sentences (shadowing) ──────────────────────────────────────
  { id: 's-ohayou', text: 'おはよう', reading: 'おはよう', moras: ['お', 'は', 'よ', 'う'], type: 'sentence',
    pattern: { kind: 'nakadaka', drop: 2 }, gender: 'm', genre: 'casual', source: 'curated' },
  { id: 's-arigatou', text: 'ありがとう', reading: 'ありがとう', moras: ['あ', 'り', 'が', 'と', 'う'], type: 'sentence',
    pattern: { kind: 'nakadaka', drop: 4 }, gender: 'f', genre: 'casual', source: 'curated' },
  { id: 's-genki', text: 'お元気ですか', reading: 'おげんきですか', moras: ['お', 'げ', 'ん', 'き', 'で', 'す', 'か'], type: 'sentence',
    pattern: { kind: 'nakadaka', drop: 4 }, gender: 'f', genre: 'common', source: 'curated' },
];

export const GENRES = ['common', 'casual', 'anime', 'news', 'mined'];
