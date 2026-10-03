# Pitch Mirror

The pitch accent trainer at `/tools/pitch/`. Everything runs in the browser:
the mic is analyzed frame by frame and nothing is uploaded.

## Files

- `tools/pitch/index.html`: the page. `tools/pitch/audio/*.mp3`: recorded clips.
- `scripts/pitch/app.js`: UI, playback, recording, drawing.
- `scripts/pitch/engine/pitch-detect.js`: pitch detection (McLeod pitch
  method: normalized autocorrelation, 70–500 Hz).
- `scripts/pitch/engine/contour.js`, `scoring.js`: relative-pitch curves and
  the two scores (where the pitch drops, and shape closeness).
- `scripts/pitch/data/clips.js`: the clip library. **Generated**, don't edit.
- `scripts/pitch/build/`: the scripts that build the library.

## How it scores

Every attempt gets a **shape match** from 0 to 100: the correlation between
your pitch curve and the target's, so it only cares where your voice rises
and falls, not how high it is. For words with a recording, the score is the
average of your match against the native speaker and against the textbook
pattern, so a quirk in one recording can't carry a wrong pattern. 40+ passes,
75+ is "really close". (On the library, 40 lets about 77% of correct-pattern
attempts through and about 6% of wrong-pattern ones.) Sentences and your own
clips are scored against the recording alone.

The pitch detector (`pitch-detect.js`) and the trace cleanup in `contour.js`
(octave-jump fixes) run the same way on the page, in the build and in tests.

## Where the recordings come from

Lingua Libre speakers on Wikimedia Commons (CC0, CC BY 4.0 or CC BY-SA 4.0;
each clip's author and license are listed in the page's "Voices" section).
Accents come from [Kanjium](https://github.com/mifunetoshiro/kanjium)
(CC BY-SA 4.0). A word recording is only kept if its pitch drop lands where
the dictionary says AND its whole shape matches the textbook pattern (shape
match 60+). That's strict on purpose: out of ~400 candidate recordings, about
50 words made it, plus 24 everyday phrases. Recordings by "I JethroBT" are
left out (likely not a native speaker). Classic minimal pairs nobody has
recorded yet play a guide tone instead.

Real speech is messy (vowels go silent between voiceless consonants, voices
sag at the end of a word), so the automatic checks will miss some good
recordings and could let an odd one through. If one sounds wrong, add its
Commons title to the skip list in `make-clips.mjs`.

## Rebuilding the library

1. `scripts/pitch/build/candidates.json` lists the recordings to try. Add
   Commons files there (title, url, license, author, text, plus `reading` and
   `accent` for words).
2. Run the **Pitch Mirror audio** workflow (Actions tab → Run workflow). It
   downloads and encodes them on GitHub's servers (Wikimedia rate-limits
   bulk downloads from most other places) and pushes the results to the
   throwaway branch `pitch-audio-build`: `audio/`, `library.json`,
   `traces.json` (each recording's pitch track) and `rejected.json`. It stops
   after 20 minutes and picks up where it left off on the next run.
3. Grab that branch (`git fetch origin pitch-audio-build` then
   `git archive origin/pitch-audio-build | tar -x -C /tmp/pitch-build`) and run
   `node scripts/pitch/build/make-clips.mjs /tmp/pitch-build`. That picks the
   clips, regenerates `clips.js` and copies the MP3s into `tools/pitch/audio/`.
   Bump the `?v=` numbers in `index.html` and the `app.js` imports.
