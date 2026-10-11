# Kana Wordle

`tools/wordle/` · `scripts/wordle/app.js` · word lists in `data/wordle/words-4.json`
and `words-5.json` (answers lightly encoded so they don't show in view-source).

## Daily word

Each level and length has a fixed shuffle of its answers; the daily word is the
next one in that shuffle (#1 was Oct 1, 2026). Practice picks at random.
Never reorder the answers: that changes every day's word.

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
