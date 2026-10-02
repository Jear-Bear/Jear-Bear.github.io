# Kana Crossword

`/tools/crossword/` is a daily Japanese crossword with English clues and
hiragana answers. It follows the conventions of Japanese newspaper puzzles
(Yomiuri, Nikkei, the House of Representatives' quiz sheets):

- **One kana per square.** Small kana are written full size (きゃ → きや,
  っ → つ), dakuten stay (が is its own letter), and ー takes a square.
- **Black squares never touch side by side**, the four corners are white,
  and some squares belong to only one word.
- **Numbering** is shared by across (ヨコのカギ) and down (タテのカギ).
- **Keyword (二重マス):** double-boxed squares, read in order A, B, C…, spell
  a bonus word with its own clue.

Every day has six puzzles: a **Mini** (5×5) and a **Daily** (9×9) at three
levels.

| Level | Answers from |
|---|---|
| Beginner | JLPT N5–N4, plus beginner fun words |
| Intermediate | JLPT N3–N2, plus intermediate fun words (N5–N4 help the fill) |
| Advanced | JLPT N1, plus slang, idioms and pop culture (N3–N2 help the fill) |

At least 60% of a puzzle's answers come from its own level, and each one
includes at least one word from `data/crossword/extra-words.json` (food, pop
culture, slang, folklore).

## Where the words and clues come from

- **Words:** JLPT vocabulary from
  [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)
  (MIT; based on Jonathan Waller's JLPT lists, CC BY), pinned to a commit, plus
  the hand-picked `extra-words.json`. `blocklist.json` keeps grim or crude
  words out.
- **Clues:** there's no public database of crossword-style English clues
  for Japanese words (dictionaries only have plain definitions), so Claude
  writes them every day, following the style guide below.

The grid itself is built by code (`scripts/crossword/construct.mjs`), not
by Claude: a random Japanese-style pattern is filled by backtracking search
over the word list, then a keyword is picked from the fill's letters. The
same date always produces the same grids.

## Commands

```
node scripts/crossword/cli.mjs words           # rebuild data/crossword/words.json (after editing extra-words.json)
node scripts/crossword/cli.mjs status 3        # which of the next 3 days (from the earliest time zone) have no puzzles
node scripts/crossword/cli.mjs draft DATE      # build DATE's 6 puzzles into data/crossword/drafts/DATE.json
node scripts/crossword/cli.mjs publish DATE    # check the clues, write data/crossword/puzzles/DATE.json
node scripts/crossword/cli.mjs check           # re-check every published day
```

A daily 9×9 can take a minute or two to build. Drafts have the answers in
plain text and are git-ignored. Published files keep answers lightly encoded
so they don't show in view-source. `publish` refuses missing clues, clues
over 140 characters, any kana or kanji in a clue, and clues that contain the
answer's romaji.

## Clue style

The clues should read like a crossword's, not like a dictionary:

1. **English only.** No kana, kanji or romaji of the answer (the checker
   rejects them). Explaining a related Japanese word in English is fine:
   "Bow to it at a shrine".
2. **Match the answer's form.** A verb gets a verb clue ("Slice, or hang up
   on someone"), an adjective an adjective clue ("Like ghost-pepper
   ramen"). Flag register and grammar in parentheses: (humble), (honorific),
   (casual), (counter), (loanword), (onomatopoeia), (prefix).
3. **Be specific.** Japanese has many homophones and most English glosses
   fit several words, so add the detail that points to this one:
   "Ice, or shaved-ice dessert base", not just "Ice".
4. **Have fun.** Use puns, misdirection, fill-in-the-blanks ("Super ___
   Bros."), pop culture (anime, games, J-pop, memes, konbini life), and a
   wink when the word is funny. Keep it kind: nothing mean, crude or about
   real tragedies.
5. **Pitch it to the level.**
   - Beginner: friendly and direct. The definition comes first, with one fun
     hook.
   - Intermediate: some wordplay. Expect the solver to know common
     expressions.
   - Advanced: misdirection and cultural knowledge. Still fair.
6. **Keep it short:** under about 100 characters (140 at most).
7. **Keyword clue:** clue the bonus word itself. The solver also sees the
   letters fill in from the double-boxed squares.

Examples:

| Answer | Clue |
|---|---|
| すし (寿司) | Conveyor-belt cuisine |
| まりお (マリオ) | Plumber who'd rather stomp a goomba than fix your sink (loanword) |
| きる (切る) | Slice, or hang up the phone |
| まいる (参る) | Humble way to say "go" or "come" |
| まずい | Yuck! (about food) |
| しやちよう (社長) | Big boss with the corner office |
| ゆるきやら (ゆるキャラ) | Kumamon, for one |
| つんどく (積ん読) | Your to-read pile, as a lifestyle |

## Daily routine (Claude Code)

The puzzles are made by a Claude Code routine that runs every morning in
this repo. Set it up at claude.ai/code → **Routines → New routine**:

- Repository: `Jear-Bear/Jear-Bear.github.io`
- Schedule: daily at 5:00 AM Central time
- Prompt:

```
Daily Kana Crossword for jareddesu.com. Work in the Jear-Bear.github.io repo on main.
1. Run: node scripts/crossword/cli.mjs status 3. For each date in "missing" (oldest first, at most 2 dates per run), run: node scripts/crossword/cli.mjs draft DATE.
2. Open data/crossword/drafts/DATE.json. For each of its 6 puzzles, fill in "clue" for every entry and for the keyword. Follow "Clue style" in docs/crossword.md exactly: English only, crossword-style (puns, misdirection, fill-in-the-blanks, pop culture), matched to the answer's part of speech and register, specific enough to tell apart homophones, pitched to the puzzle's level, under 100 characters. Use "word", "reading" and "meaning" to understand each answer; never put the answer's kana, kanji or romaji in a clue. Read your clues back once and sharpen any that are flat or ambiguous.
3. Run: node scripts/crossword/cli.mjs publish DATE. If it lists problems, fix those clues and publish again. Then run: node scripts/crossword/cli.mjs check.
4. Optional, at most 5 per run: if a fun, well-known word would make future puzzles better (food, anime, games, memes, folklore, slang), add it to data/crossword/extra-words.json with word, reading (hiragana, ー allowed), meaning, level and tags, then run: node scripts/crossword/cli.mjs words.
5. Commit only data/crossword/ (never drafts) as Jared Perlmutter <jperlmutter1@gmail.com> with no co-author lines, to a new branch named crossword-DATE, open a pull request titled "Crossword: DATE", and merge it.
Reply in one line with the dates published.
```

**When puzzles change.** Like Wordle, each visitor gets a new puzzle at their
own local midnight. (The NYT crossword instead releases one puzzle worldwide
at 10 PM Eastern.) For that to work everywhere, a day's puzzles must be
published before that day starts in the earliest time zone, UTC+14 (Kiribati),
which is about 19 hours before it starts in Central time. So `status` counts
from Kiribati's date and the routine keeps today plus the next two days
published there. Running 2 days per run, it catches up after a missed day,
and the time of day it runs doesn't matter. Future days are published early
but stay hidden in the player until the visitor's own date reaches them; an
open page switches to the new puzzle at midnight (unless a puzzle is half
done) and the solved card counts down to it.
