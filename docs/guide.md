# Jared’s Ultimate Japanese Guide

`/guide/` replaced the blog. The old blog page lives at `/archive/blog/`
(not indexed), and `/blog/` redirects to the guide.

## Editing

Chapters are HTML fragments in `guide/_chapters/` (Jekyll doesn’t publish
folders starting with `_`). The front page is `guide/_chapters/hub.html`.
After any edit, rebuild:

```
python3 scripts/guide/build.py
```

This writes `guide/index.html` and `guide/<slug>/index.html`, using the
site header and footer from `tools/crossword/index.html`. Commit both the
fragment and the built pages.

- **New chapter:** add `NN-slug.html` with a `<!--META {...} -->` line at
  the top (title, ja, kanji, minutes, stage, lede). The number sets the order.
- **Links** shared across chapters (affiliate links, tools, friends’
  channels) live in `LINKS` in `scripts/guide/build.py`. Use
  `{{link:name}}` in a chapter.
- **Videos:** `<yt id="VIDEO_ID">Title</yt>`, loaded only when clicked.
- **Widgets:** `<div data-widget="name"></div>`. The widgets live in
  `scripts/guide/guide.js` (`W.name`).
- **Styles:** `styles/guide.css`. The accent is 瑠璃色 #2a62b0. The chart
  colors were checked for colorblind safety in light and dark mode.

Reader progress (chapters read, the pinned “why”, checklists) is saved in
the reader’s browser under `jareddesu.guide.v1`.

## Screenshots and photos to add

Each placeholder shows a dashed box until the image exists. Drop the file
at `images/guide/<name>` and it replaces the box automatically. No rebuild
is needed.

| File | Chapter | What |
|---|---|---|
| `host-family.jpg` | 1 · Find your why | Morioka / the trip back to see the host family |
| `ime-conversion.png` | 2 · Kana and typing | IME converting にほんご → 日本語 with the candidate list |
| `kaishi-card.png` | 3 · Starter kit | A Kaishi 1.5K card, front and back |
| `anki-card-front.png` | 4 · Toolbox | A mined sentence card, front and back |
| `yomitan-popup.png` | 4 · Toolbox | Yomitan popup with the add button and frequency |
| `asbplayer-crunchyroll.png` | 4 · Toolbox | asbplayer subtitles on an anime with a Yomitan popup |
| `gsm-setup.png` | 6 · Immersion | Game Sentence Miner over a visual novel |
| `bookshelf.jpg` | 7 · Reading | Japanese bookshelf / Bookworm volumes |
| `praat-ohayou.png` | 10 · Speaking | Praat: your おはようございます vs a native speaker |
| `toggl-week.png` | 11 · Your life in Japanese | A week of immersion hours |
| `japan-trip.jpg` | 11 · Your life in Japanese | A recent Japan trip |

## Still to fill in

- Chapter 6 tier list: the name of the horror-game Let’s Player (“name TBD”).
- The italki link in `LINKS` is the plain site. Swap in an affiliate link
  if there is one.
- Videos whose transcripts weren’t available yet (the AJATT updates #1–3,
  *Easier Than You Think*, *Practice with Natives*, *7 Reading Tricks*,
  the tutor, Netflix, scams, 2026 goals, keyboard, Nagoya, Locals React,
  worst language exchange, 15 ways to say “I”, keigo, JLPT update). Some are
  embedded already; their content can be folded in once the captions are
  exported.
