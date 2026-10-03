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

- **Words:** the attempt is split into one slice per mora, each slice is called
  high or low relative to the speaker's own range, and the drop has to land
  after the same mora as the dictionary accent. Odaka words look flat inside
  the word (the fall is on the next particle), so they're scored like heiban.
- **Sentences and your own clips:** there's no single drop, so they get a shape
  score from 0 to 100 (dynamic time warping against the recording's contour).

## Where the recordings come from

Lingua Libre speakers on Wikimedia Commons (CC0, CC BY 4.0 or CC BY-SA 4.0;
each clip's author and license are listed in the page's "Voices" section).
Accents come from [Kanjium](https://github.com/mifunetoshiro/kanjium)
(CC BY-SA 4.0). A recording is only kept if its pitch drop matches the
dictionary accent, using the same detector as the page. Classic minimal pairs
that nobody has recorded yet play a guide tone instead.

## Rebuilding the library

1. `scripts/pitch/build/candidates.json` lists the recordings to try. Add
   Commons files there (title, url, license, author, text, plus `reading` and
   `accent` for words).
2. Push. The **Pitch Mirror audio** workflow downloads, checks and encodes them
   on GitHub's servers and uploads a `pitch-audio` artifact (`audio/` +
   `library.json` + `rejected.json` with the reason each one was dropped).
3. Download the artifact, copy `audio/` into `tools/pitch/audio/`, then run
   `node scripts/pitch/build/make-clips.mjs path/to/library.json` to regenerate
   `clips.js`. Bump the `?v=` numbers in `index.html` and `app.js` imports.
