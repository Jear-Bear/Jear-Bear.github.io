/* tools.js — manifest + renderer for the Tools index.
 *
 * Adding a new tool:
 *   1. Drop the tool in /tools/<slug>/
 *   2. Add one entry to TOOLS below (the glyph is shown large on the index;
 *      thumb is only used elsewhere, e.g. for sharing)
 */

const TOOLS = [
  {
    slug: 'kana',
    title: 'Kana Trainer',
    description:
      'Fast, adaptive kana recognition with built-in spaced repetition. ' +
      'Tracks your personal trouble pairs (シ↔ツ, ぬ↔め…) and lets you test into your level.',
    tags: ['hiragana', 'katakana', 'SRS'],
    glyph: 'あ',
    accent: '#5b5bd6',          // each tool's --page-color carries onto its tile
    thumb: 'thumb.svg',          // relative to the tool folder; defaults to thumb.png
  },
  {
    slug: 'kanji',
    title: 'Kanji Trainer',
    description:
      'Jōyō, jinmeiyō, JLPT, Kanken or your own list (paste, CSV or Excel). ' +
      'Meanings, readings, common words and handwriting with stroke-order ' +
      'checking, on a spaced-repetition schedule.',
    tags: ['kanji', 'writing', 'JLPT', 'Kanken'],
    glyph: '漢',
    accent: '#42602d',
    thumb: 'thumb.svg',
  },
  {
    slug: 'nandoku',
    title: 'Nandoku Trainer',
    description:
      'Every level of 漢字でGO!, 1 through 8, plus the 別表記 spellings: ' +
      '10,000+ words shown the way the game shows them. Type the reading, ' +
      'pick the meaning, or play a timed challenge run.',
    tags: ['kanji', 'readings', '漢字でGO!'],
    glyph: '難',
    accent: '#165e83',
    thumb: 'thumb.svg',
  },
  {
    slug: 'jis',
    title: 'JIS Grind',
    description:
      'Drill the JIS kana layout until it\'s muscle memory. A kana appears, ' +
      'you hit the matching physical key (detected by position, so your IME ' +
      'stays put). Weak kana surface more often.',
    tags: ['JIS', 'typing', 'kana'],
    glyph: 'ぬ',                 // the first key on a JIS keyboard
    accent: '#e4332b',
    thumb: 'thumb.svg',
  }
  /*
  {
    slug: 'pitch',
    title: 'Pitch Mirror',
    description:
      'See your Japanese pitch accent. Hear a native pattern, record yourself, ' +
      'and watch your pitch contour drawn live over the target — words, sentences, ' +
      'or your own mined audio.',
    tags: ['pitch accent', 'speaking', 'audio'],
    glyph: '声',
    accent: '#8b7bd8',
    thumb: 'thumb.svg',
  },
  */
  // {
  //   slug: 'pitch',
  //   title: 'Pitch Accent Trainer',
  //   description: 'Hear it, mark it, check it.',
  //   tags: ['listening', 'pitch'],
  //   glyph: '声',
  //   accent: '#36a06b',
  // },
];

(function renderTools() {
  const grid = document.getElementById('tools-grid');
  if (!grid) return;

  // A catalogue entry per tool: its character set large, like a type
  // specimen, with the tool's own colour as a small stamp
  grid.innerHTML = TOOLS.map((t) => {
    const accent = t.accent || 'var(--page-color)';
    return `
      <li class="tool-entry" style="--tile-color:${accent}">
        <a class="tool-link" href="./${t.slug}/">
          <span class="tool-glyph" lang="ja" aria-hidden="true">${t.glyph || t.title[0]}</span>
          <span class="tool-body">
            <span class="tool-title">${t.title}</span>
            <span class="tool-desc">${t.description}</span>
            ${t.tags && t.tags.length
              ? `<span class="tool-tags">${t.tags.map((tag) => `<span class="tool-tag">${tag}</span>`).join('')}</span>`
              : ''}
          </span>
          <span class="tool-open">Open <span aria-hidden="true">→</span></span>
        </a>
      </li>`;
  }).join('');
})();
