// deck-worker.js — builds a My deck puzzle off the main thread (deck.js).
// In: { words: [{ a, w, r, m }], kind: 'kana' | 'kanji', size, seed }
// Out: { ok: true, p: draft } or { ok: false, error }

import { buildFree } from './freeform.mjs?v=1';

self.onmessage = (e) => {
  const { words, kind, size, seed } = e.data;
  try {
    self.postMessage({ ok: true, p: buildFree({ size, level: 'deck', kind, words, seed, attempts: 30 }) });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message });
  }
};
