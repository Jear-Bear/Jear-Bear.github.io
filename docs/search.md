# Search (SEO) and where ads go

What the site does so people searching "Japanese crossword", "Japanese Wordle",
"Japanese practice" or "practice Japanese free" find it, and the rule for putting ads on
pages other than the crossword.

## The pages and what each one targets

| Page | Searches it's written for | Title starts with |
|---|---|---|
| `/tools/` | Japanese practice, practice Japanese free | Free Japanese Practice |
| `/tools/crossword/` | Japanese crossword, kana / kanji crossword | Free Daily Japanese Crossword |
| `/tools/wordle/` | Japanese Wordle, kana Wordle | Japanese Wordle |
| `/tools/kana/` | hiragana / katakana practice | Hiragana and Katakana Practice |
| `/tools/kanji/` | kanji practice, JLPT kanji | Free Kanji Practice |
| `/tools/jis/` | JIS keyboard typing practice | JIS Keyboard Kana Typing Practice |

Each has a matching meta description, a canonical URL, and the crossword, Wordle and
Tools pages have link-preview images (`images/og/*.jpg`, 1200×630) and JSON-LD.
The crossword and Wordle switch their tab title and description to Japanese when the
page is in Japanese (`setMeta` in each `app.js`); Google indexes the English.

**The Tools page is the hub.** Its tool list is plain HTML (it used to be drawn by
`scripts/tools.js`, which search engines see late or not at all), and it has a
"Where to start" section by level that links each tool with the words people search
for. To add a tool, copy an entry in `tools/index.html`.

**Home page.** The canvas menu can't be read by search engines or screen readers, so
the page has a screen-reader nav with the same links (About, Guide, Projects,
Contact), plus a real title and description. The canvas menu has no Tools link; adding
one there would send the home page's weight to the hub.

**Short links** for videos and the preview images: `jareddesu.com/crossword` and
`jareddesu.com/wordle` (noindex redirects, not in the sitemap).

## After changing titles

Google Search Console → URL inspection → Request indexing, for each changed page.
Titles usually update in days; rankings take weeks. Check Search Console →
Performance → Queries every couple of weeks to see which searches show the pages and
at what position.

What moves rankings most from here is links from other sites: resource lists
(r/LearnJapanese wiki, Tofugu, awesome-japanese lists), forum and Discord posts, and
your video descriptions.

## Ads on other tools

Ads are only on the crossword (`scripts/crossword/ads.js`, off until AdSense approves
the site; see docs/crossword-plus.md). The other tools don't get them yet: with
AdSense paying very roughly $1–5 per 1,000 page views on a site like this, a page needs
about **3,000 views a month** (100 a day) before an ad earns more than a few dollars,
and below that it mostly costs the page goodwill.

Numbers for Oct 20 – Nov 18, 2026 (Sponsor desk → Traffic):

| Page | Views / 30 days | Ads? |
|---|---|---|
| Crossword | 8,676 | yes (built, off until approved) |
| Tools | 2,364 | no: it's the doorway to the tools |
| Kanji Trainer | 712 | not yet |
| Wordle | 567 | not yet |
| Kana Trainer | 229 | not yet |
| Nandoku, JIS | under 60 | no |

When a game page (Wordle) passes ~3,000 a month, give it the same treatment as the
crossword: one labelled slot below the game, never in or over the board, never on the
result, never for Crossword+ members. Trainers that need focus (Kana, Kanji, Nandoku,
JIS) should stay ad-free longer: an ad next to a timed drill or handwriting practice
gets in the way more than it earns. Keep AdSense's Auto ads off so nothing places itself.
