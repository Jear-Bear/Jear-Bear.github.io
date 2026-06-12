/* tools.js — manifest + renderer for the Tools index.
 *
 * Adding a new tool:
 *   1. Drop the tool in /tools/<slug>/
 *   2. Add one entry to TOOLS below
 *   3. (Optional) put a thumb.png (16:9) in the tool's folder —
 *      if missing, the tile falls back to the glyph automatically.
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

  grid.innerHTML = TOOLS.map((t) => {
    const accent = t.accent || 'var(--page-color)';
    const thumb = `./${t.slug}/${t.thumb || 'thumb.png'}`;
    return `
      <a class="tool-tile" href="./${t.slug}/" style="--tile-color:${accent}">
        <div class="tool-thumb">
          <img src="${thumb}" alt="" loading="lazy"
               onerror="this.style.display='none'; this.parentElement.classList.add('placeholder');" />
          <span class="tool-thumb-glyph" lang="ja" aria-hidden="true">${t.glyph || t.title[0]}</span>
        </div>
        <div class="tool-body">
          <h2 class="tool-title">${t.title}<span class="arrow"> →</span></h2>
          <p class="tool-desc">${t.description}</p>
          ${t.tags && t.tags.length
            ? `<div class="tool-tags">${t.tags.map((tag) => `<span class="tool-tag">${tag}</span>`).join('')}</div>`
            : ''}
        </div>
      </a>`;
  }).join('');

  // Self-contained staggered entrance — dynamically injected elements can't
  // use the site's .reveal system (site.js has already collected those).
  grid.querySelectorAll('.tool-tile').forEach((el, i) => {
    setTimeout(() => el.classList.add('is-in'), 80 + i * 90);
  });
})();
