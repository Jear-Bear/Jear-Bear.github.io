#!/usr/bin/env python3
"""audio.py — turns Jared's chapter recordings into synced audio for the guide.

Drop a recording in guide/audio/raw/ (any format ffmpeg reads: m4a, mp3,
wav, ...), named after the chapter, either its web address or its number:

    guide/audio/raw/your-why.m4a        the chapter at /guide/your-why/
    guide/audio/raw/chapter-2.mp3       "Chapter 2" as shown on the site

For each one this writes
    guide/audio/<slug>.mp3              compressed, loudness-normalized audio
    guide/audio/<slug>.words.json       every spoken word with its start/end time
and deletes the raw file. build.py then lines the spoken words up with the
chapter text, so later text edits only need a rebuild, not a new recording.

Runs in .github/workflows/guide-audio.yml (free GitHub runner, CPU only).
Locally:  pip install faster-whisper   (and ffmpeg on PATH)
          python3 scripts/guide/audio.py [--model small.en]
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "guide" / "_chapters"
AUDIO = ROOT / "guide" / "audio"
RAW = AUDIO / "raw"
EXTS = {".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".flac", ".webm", ".mp4", ".mov", ".caf", ".aiff", ".aif"}


def chapter_slugs():
    # Source files are 00-start-here.html …; the site shows them as Chapter 1 …
    return [f.stem[3:] for f in sorted(SRC.glob("[0-9][0-9]-*.html"))]


def slug_for(path, slugs):
    name = path.stem.lower().strip()
    name = re.sub(r"[\s_]+", "-", name)
    for s in sorted(slugs, key=len, reverse=True):   # "your-why" inside "02-your-why-take3"
        if s in name:
            return s
    m = re.search(r"(\d+)", name)
    if m and 1 <= int(m.group(1)) <= len(slugs):
        return slugs[int(m.group(1)) - 1]
    return None


def ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg   # local fallback
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found")


def encode(src, dst):
    # Mono MP3 at 56 kbps is plenty for a voice and plays in every browser.
    # loudnorm evens out the volume so every chapter sounds the same.
    subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
                    "-vn", "-ac", "1", "-ar", "44100", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                    "-c:a", "libmp3lame", "-b:a", "56k", str(dst)], check=True)


def transcribe(path, model_name):
    from faster_whisper import WhisperModel
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(path), language="en", word_timestamps=True,
                                      vad_filter=True, beam_size=5,
                                      condition_on_previous_text=False)
    words = []
    for seg in segments:
        for w in seg.words or []:
            words.append([w.word.strip(), round(float(w.start), 2), round(float(w.end), 2)])
    return words, round(float(info.duration), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="small.en")
    args = ap.parse_args()

    slugs = chapter_slugs()
    files = [p for p in sorted(RAW.glob("*")) if p.suffix.lower() in EXTS] if RAW.exists() else []
    if not files:
        print("No recordings in guide/audio/raw/")
        return
    done = []
    for p in files:
        slug = slug_for(p, slugs)
        if not slug:
            print(f"::warning::{p.name}: can't tell which chapter this is. Name it like your-why.m4a or chapter-2.m4a")
            continue
        print(f"{p.name} → {slug}")
        out = AUDIO / f"{slug}.mp3"
        encode(p, out)
        words, dur = transcribe(out, args.model)
        (AUDIO / f"{slug}.words.json").write_text(json.dumps(
            {"model": args.model, "duration": dur, "words": words}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8")
        print(f"  {len(words)} words, {dur / 60:.1f} min")
        p.unlink()
        done.append(slug)
    print("Processed: " + ", ".join(done) if done else "Nothing processed")


if __name__ == "__main__":
    main()
