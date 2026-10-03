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
- **Links** shared across chapters (tools, sponsors, friends’
  channels) live in `LINKS` in `scripts/guide/build.py`. Use
  `{{link:name}}` in a chapter.
- **Videos:** `<yt id="VIDEO_ID">Title</yt>`, loaded only when clicked.
- **Widgets:** `<div data-widget="name"></div>`. The widgets live in
  `scripts/guide/guide.js` (`W.name`).
- **Styles:** `styles/guide.css`. The accent is 瑠璃色 #2a62b0. The chart
  colors were checked for colorblind safety in light and dark mode.

Reader progress (chapters read, the pinned “why”, checklists) is saved in
the reader’s browser under `jareddesu.guide.v1`.

## Voice

The guide should read like Jared talking, edited: an opinionated walkthrough
of how he learned, not a course pitch. When adding or editing text:

- Write in paragraphs, first person, the way he talks in the unscripted videos
  (Q&A streams, AJATT updates). Stories and reasons carry the point.
- No punchy one-line "lessons", teaser lines ("Here's the thing:"), or
  rhythmic triplets. Lists only for real steps or resources.
- No TL;DR boxes or stat tiles. Callout boxes only if something truly needs to
  stand apart (there are none right now).
- Only claims and stories that are in his videos or that he has confirmed.
  The source transcripts are the rough notes.
- Keep the widgets and video embeds; they carry a lot of the explaining.

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

- No affiliate links: italki makes a unique tracking link per collab, so
  Migaku and italki link to their plain sites.
- Captions folded in (Oct 2026): keyboard layout, Netflix on your phone,
  worst language exchange, Stray, the Q&A livestream, 15 ways to say “I”,
  2025 trends, Nagoya week 1, Locals React, Practice with Natives (Ohana),
  JLPT/CEFR update, scam ads, YouTube & anime workflow, 7 reading tricks,
  and AJATT updates #1–3. Still not covered: *Can a Tutor Help You Speak
  Like a Native?*, *Japanese Fluency in 2026*, and *How Polite Can Japanese
  Really Get?* (no captions sent yet); *Learning Japanese is Easier Than
  You Think* has no transcript, so it stays embedded only.

## Quick edits

- **Word count on the mountain** (start-here chapter): `WORDS` in
  `W.mountain` in `scripts/guide/guide.js`. The peak stone is always 凪.
- **Video thumbnails** use YouTube’s full-HD `maxresdefault.jpg`; if a video
  doesn’t have one, `guide.js` falls back to `hqdefault.jpg` automatically.
