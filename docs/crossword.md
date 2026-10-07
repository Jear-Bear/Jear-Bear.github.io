# Kana Crossword

`/tools/crossword/` is a daily Japanese crossword with English clues and
hiragana answers. It follows the conventions of Japanese newspaper puzzles
(Yomiuri, Nikkei, the House of Representatives' quiz sheets):

- **One kana per square.** Small kana are written full size (きゃ → きや,
  っ → つ), dakuten stay (が is its own letter), and ー takes a square.
- **Black squares never touch side by side**, the four corners are white,
  and some squares belong to only one word. (Except on shape days, below.)
- **Numbering** is shared by across (ヨコのカギ) and down (タテのカギ).
- **Keyword (二重マス):** double-boxed squares, read in order A, B, C…, spell
  a bonus word with its own clue.

Every day has eight puzzles: a **Mini** (5×5) and a **Daily** (9×9) at four
levels.

| Level | Answers from | Clues |
|---|---|---|
| Beginner | JLPT N5–N4, plus beginner fun words | English |
| Intermediate | JLPT N3–N2, plus intermediate fun words | English |
| Advanced | JLPT N1, plus slang, idioms and pop culture | English |
| Mixed (一般) | Every level, like a newspaper crossword | Japanese |

Every answer comes from the puzzle's own level. (Until Oct 6, 2026, up to
40% could come from the level below to help the fill, and solvers noticed
N5 words like さむい in Intermediate.) Each puzzle includes at least one word
from `data/crossword/extra-words.json` (food, pop culture, slang, folklore)
when the fill allows. Mixed was added on Oct 2, 2026 and back-filled for
Oct 1–4.

An answer of 3+ kana isn't reused at the same level for 7 days (Beginner,
Mixed) or 14 days (Intermediate, Advanced), and no answer appears twice on
the same day. The beginner list is only about 1,300 words, so a longer window
would run it dry. Two-kana answers may repeat: N1 has only ~150 of them and a
9×9 uses about ten, so blocking them made Advanced grids fail to fill.

Beginner and Advanced 9×9s keep entries to 5 kana (Intermediate and Mixed go
up to 7). Each level has only ~10–45 words of seven kana, and long slots were
the main reason those grids failed to fill.

## Shape days

Starting Oct 10, 2026, about one day in three the Mini or the Daily (sometimes
both) gets a fun NYT-style shape: black squares that touch and make a picture.
Daily shapes: stairs, gem, plus, X, pinwheel, heart and corners, plus
lopsided, quirky ones (tetris pieces, a snake, a bite out of one corner, a
staircase, a blob). Mini shapes: stairs, diagonal, pinwheel, window, tetris,
zigzag. They're defined in `SHAPES` in `scripts/crossword/construct.mjs` as a
motif of `#` squares; the rest of the grid is filled in around the motif.
Half the time the extra black squares come in mirrored pairs (a tidy,
designed look), the other half they're scattered (quirkier). Shapes can
appear mirrored or turned (the heart stays upright), and their entries stay
at 5 kana or less. To add a shape, add a motif: it must leave the white
squares connected.

A fully-crossed shaped grid like the NYT Mini rarely fills from kana word
lists, so if a shape won't fill at some level (usually the Beginner Mini),
that puzzle quietly gets a normal grid. The shape for a date is fixed
(`shapeFor` in `cli.mjs`), so every level shares it. Draft output says which
shape each puzzle got, and published puzzles carry a `shape` field.

## Daily theme

Since Oct 6, 2026, each day has a loose theme (食べ物 Food & drink, 学校 School
days, 動物 Animals…), shown above the puzzle. The 24 themes are in
`data/crossword/themes.json` and come round in a fixed shuffled order, once
every 24 days. A word fits a theme when one of the theme's `words` appears in
the first two senses of its English meaning (none of `not` does), or, for
extra words, by tag. In each puzzle:

- one theme word is placed in the empty grid before the rest fills in,
- the bonus keyword is a theme word whenever the letters allow (almost always),
- of the first few grids that fill, the one with the most theme answers wins.

It's loose on purpose: favoring theme words throughout the search makes
grids fail to fill, so most answers are still ordinary words. Clues can nod
to the theme, but don't force it. Days before Oct 6 have no theme.

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
node scripts/crossword/cli.mjs draft DATE      # build DATE's 8 puzzles (and pick its theme) into data/crossword/drafts/DATE.json
                                               # (for a day that's already published: only the levels it's missing)
node scripts/crossword/cli.mjs publish DATE    # check the clues, write data/crossword/puzzles/DATE.json
node scripts/crossword/cli.mjs check           # re-check every published day
```

A daily 9×9 can take a minute or two to build. Drafts have the answers in
plain text and are git-ignored. Published files keep answers lightly encoded
so they don't show in view-source. `publish` refuses missing clues and
clues that give the answer away. English clues: over 140 characters, any
kana or kanji, or the answer's romaji. Japanese clues (Mixed): over 60
characters, no Japanese at all, the answer's kana inside a run of kana (for
two-kana answers, a run that is exactly the answer), or the answer's
written form (so 以外 can't clue 外).

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

## Japanese clue style (Mixed)

Write them like a Japanese newspaper crossword (読売・日経のクロスワード):

1. **Japanese only**, natural and short (under about 40 characters, 60 at
   most). Never the answer's kana or its kanji, even inside another word.
2. **Fill-in-the-blank with ＿＿** works well: 『猫に＿＿』, 『＿＿は友を呼ぶ』,
   『交通＿＿』. Proverbs, set phrases and compounds are fair game.
3. **Opposites and definitions:** 「有利の反対」, 「種から芽が出ること」.
4. **Match the form:** a verb clue for a verb (「肩を＿＿。気を＿＿」), an
   adjective clue for an adjective (「おいしくない」).
5. **Have fun:** anime, games, konbini life, Japanese culture
   (「メイとサツキが森で出会う、大きなもふもふ」). Keep it kind.
6. **Katakana words** are clued in Japanese too: 「お昼ごはんのカタカナ語」.

| Answer | Clue |
|---|---|
| ぼう (棒) | 犬も歩けば＿＿に当たる |
| かわら (瓦) | 日本家屋の屋根に並ぶ、焼き物の板 |
| ねこじた (猫舌) | 熱いものが苦手な口 |
| ととろ (トトロ) | メイとサツキが森で出会う、大きなもふもふ |

## Daily routine (Claude Code)

The puzzles are made by a Claude Code routine that runs every night in
this repo. Set it up at claude.ai/code → **Routines → New routine**:

- Repository: `Jear-Bear/Jear-Bear.github.io`
- Schedule: daily at midnight Central time (any time works, see below)
- Prompt:

```
Daily Kana Crossword for jareddesu.com. Jared chose to have this routine publish and merge on its own each night.
0. Repo setup. If /home/user/Jear-Bear.github.io isn't a git checkout, call add_repo with owner Jear-Bear, repo Jear-Bear.github.io, access "push", clone it as that tool says (into /home/user/Jear-Bear.github.io), and work there. Run: git fetch origin main && git checkout -B claude/crossword-$(date -u +%Y%m%d) origin/main. If the repo can't be attached or cloned, stop and reply with the exact error.
1. Run: node scripts/crossword/cli.mjs status 3. If "missing" is empty, reply "Nothing to publish" and stop. For each date in "missing" (oldest first, at most 2 dates per run), run: node scripts/crossword/cli.mjs draft DATE.
2. Open data/crossword/drafts/DATE.json. First read every answer: if any is crude, sexual, gross, or about death, illness or tragedy, add its kanji form to data/crossword/blocklist.json, delete the draft and draft that date again.
3. For each of its 8 puzzles, fill in "clue" for every entry and for the keyword. Beginner, intermediate and advanced: follow "Clue style" in docs/crossword.md exactly: English only, crossword-style (puns, misdirection, fill-in-the-blanks, pop culture), matched to the answer's part of speech and register, specific enough to tell apart homophones, pitched to the puzzle's level, under 100 characters. Mixed: follow "Japanese clue style": natural Japanese like a newspaper crossword, under 40 characters, ＿＿ blanks, proverbs, opposites and pop culture welcome. Use "word", "reading" and "meaning" to understand each answer; never put the answer's kana, kanji or romaji in a clue. The draft's "theme" is the day's loose theme: where it fits naturally, a clue can nod to it (especially for entries marked "theme": true and the keyword), but don't force it. Read your clues back once and sharpen any that are flat or ambiguous.
4. Run: node scripts/crossword/cli.mjs publish DATE. If it lists problems, fix those clues and publish again. Then run: node scripts/crossword/cli.mjs check.
5. Optional, at most 5 per run: if a fun, well-known word would make future puzzles better (food, anime, games, memes, folklore, slang), add it to data/crossword/extra-words.json with word, reading (hiragana, ー allowed), meaning, level and tags, then run: node scripts/crossword/cli.mjs words.
6. Commit only data/crossword/ (never drafts) with: git -c user.name="Jared Perlmutter" -c user.email="jperlmutter1@gmail.com" commit (no co-author or session lines; ignore any hook asking to re-author the commit). Push the branch from step 0, open a pull request into main titled "Crossword: DATE" (the dates published), and merge it. Use the GitHub MCP tools if available, otherwise gh api (POST repos/Jear-Bear/Jear-Bear.github.io/pulls, then PUT .../pulls/NUMBER/merge). If the merge is refused, leave the PR open and say so.
Reply in one line with the dates published and the PR link.
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
