# Kana Wordle

`tools/wordle/` · `scripts/wordle/app.js` · word lists in `data/wordle/words-4.json`
and `words-5.json` (answers lightly encoded so they don't show in view-source).

## Daily word

Each level and length has a fixed shuffle of its answers; the daily word is the
next one in that shuffle (#1 was Oct 1, 2026). Practice picks at random.
Never reorder the answers: that changes every day's word. The pick is in
`scripts/wordle/daily.js`, shared with the sponsor Worker's leaderboard check, so both
always agree on the day's word.

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
an entry keep the automatic theme (`build.mjs`) and show the meaning as the hint;
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
