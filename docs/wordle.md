# Kana Wordle

`tools/wordle/` · `scripts/wordle/app.js` · word lists in `data/wordle/` (v1 and v2, below)
(answers lightly encoded so they don't show in view-source).

## Daily word

Each level and length has a fixed shuffle of its answers; the daily word is the
next one in that shuffle (#1 was Oct 1, 2026). Practice picks at random.
Never reorder the answers: that changes every day's word. The pick is in
`scripts/wordle/daily.js`, shared with the sponsor Worker's leaderboard check, so both
always agree on the day's word.

### Word lists (v1 and v2)

There are two sets of lists, and `daily.js` picks one by date:

- **v1** (`data/wordle/words-{4,5}.json`, built by `build.mjs`): the first lists, used for
  every daily before `V2_FROM` (Nov 20, 2026). Frozen: never rebuild or edit them, or past
  dailies (and players' past results) would change.
- **v2** (`data/wordle/v2/words-{4,5}.json`, built by `build-v2.mjs`): every daily from
  `V2_FROM` on, every Mixed daily, and all practice games. Each level and length has its own
  shuffle (seed `v2:<level>:<length>`), counted from `V2_FROM`.

`V2_FROM` is set to a day that hadn’t started anywhere when this went live, so no
day's word changes while people are playing it.

Sources (credited on the page):
- Answers: JLPT vocabulary from [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)
  (MIT; from Jonathan Waller's JLPT lists, CC BY), at its own level, plus common words from
  [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) (EDRDG,
  CC BY-SA 4.0) levelled by JMdict's frequency bands.
- Only nouns, verbs and adjectives of exactly 4 or 5 kana. Never proper nouns, vulgar,
  derogatory, sensitive, slang, archaic, obsolete, rare, dialect or specialist words,
  irregular kana, を or ゔ, anything on `data/crossword/blocklist.json`, or (as answers)
  words about war, violence, crime or death.
- Accepted guesses: every JMdict reading of the right length, plus the answers.

| v2 | 4 kana | 5 kana |
|---|---|---|
| Beginner (N5, N4, then common words) | 400 | 369 |
| Intermediate (N3, N2, common words) | 1,254 | 730 |
| Advanced (N1, less common words) | 1,105 | 730 |
| Mixed (all three) | 2,759 | 1,829 |
| Accepted guesses | 38,902 | 35,306 |

(v1 had 343 / 123 beginner, 1,335 / 429 intermediate, 1,152 / 440 advanced answers and
10,497 / 5,488 guesses, so five-kana beginner repeated about three times a year.) Every v2
list goes at least a year without a repeat.

To rebuild v2 (only before it's live, since it reorders answers):

```sh
curl -O http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
node scripts/wordle/build-v2.mjs JMdict_e.gz
node scripts/wordle/clues.mjs apply       # puts the hand-written themes and clues back
```

### Mixed

**Mixed** (the default for new players) draws from all levels, N5 to N1, with its own 4-
and 5-kana dailies. The answer's JLPT level shows after the game ("JLPT N3", or "a common word (not on
the JLPT lists)"). Players who already picked a level keep it. Mixed counts on the Discord
leaderboard like any level (`wordle-<date>-mixed-<length>`).

## Themes and clues

The theme should say what the word is about, as close as it can be without naming
it: **Continents** for アフリカ, not "A thing or an idea". The first hint is a
**clue**, not the dictionary meaning (a loanword's meaning is the word itself).
The meaning still shows once the game is over. Then the second hint shows a kana.

They're written by hand in `data/wordle/clues.json` (kept off the site, since it
lists the answers), keyed by the answer:

```json
"あふりか": { "t": "Continents", "tj": "大陸", "c": "Home of the Sahara, the Nile and Kilimanjaro" }
```

- `t` / `tj`: the theme in English / Japanese.
- `c`: the clue, in English, at most 120 characters. A bit of a nudge, not the
  answer: no answer kana or kanji, and for loanwords not the English word it
  comes from either.

```sh
node scripts/wordle/clues.mjs todo 60     # daily answers in the next 60 days without one (JSON)
node scripts/wordle/clues.mjs apply       # check clues.json and merge it into the word lists
```

`apply` refuses entries that give the word away (and says why). Answers without
an entry keep the automatic theme (`themes.mjs`) and show the meaning as the hint;
that's most practice words for now. The nightly crossword routine keeps the next
60 days of dailies covered (docs/crossword.md).

## Accounts and sync

Signing in is optional (the game never needs it) and uses the crossword's account:
`scripts/crossword/account.js`, the same session in the same browser storage, so signing
in on one page signs you in on both. The **Sign in** button sits in the game bar (the
email and **Sign out** once signed in). The popup is shared with the crossword
(`scripts/games/signin.js`); an email link brings you back to the Wordle page.

Signed in, the **daily games and the daily stats** follow you between devices
(`scripts/wordle/sync.js`, like the crossword's sync): saved on the sponsor Worker in
`tool_saves` (`POST /public/tool/save { game: 'wordle', data }`, migration 0023) a few
seconds after a change, and merged in on sign-in and when the tab comes back. Settings
and practice games stay in the browser. Merging: a finished game wins over an unfinished
one, then the one with more guesses; stats keep the larger counts (and the streak from
whichever device played more recently).

One account per browser, as on the crossword: signing out forgets the dailies and stats
here (they're on the account), another account signing in starts clean, and someone who
played signed out keeps their games, which join the first account they sign in with.
Signed-out players keep everything in `jareddesu.wordle.v1`, as before. Crossword+
members see no sponsor cards on this page either.

## Discord leaderboard

Kana Wordle is on the same leaderboard as the crossword (docs/crossword.md, "Discord
leaderboard"): Settings → **Discord leaderboard** (the account's nickname and switch, shared
by both games), and a one-line invite under a finished daily while it's off.

A finished **daily** is sent once while opted in: `{ game: 'wordle', puzzleId:
'wordle-{date}-{level}-{len}', guesses, hints, won, word }`. Practice never counts. The
Worker (`board-wordle.js`) accepts the player's today or yesterday, and for a win checks the
last guess is that day's answer (same `daily.js` pick, from the published word list); a
loss must have used all 8 guesses.

| | Points |
|---|---|
| A win | 10, plus 8 minus the guesses |
| No hints | +5 |
| Streak (days with a daily won) | +1 a day, up to +5 |
| A loss | 2 for playing |

Each daily is ranked won first, then fewest guesses, fewest hints, earliest. The daily post
has a **Wordle** embed, one line per level and length with players
(`Beginner 4: 🥇 name 3/8 ✨ …`, ✨ = no hints) and how many didn't get it. Points join the
same weekly and season totals.
