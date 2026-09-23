#!/usr/bin/env python3
"""
build-data.py — builds the Nandoku Trainer's data and fonts in data/nandoku/.

Run locally whenever the sources update. Needs:

    git clone --depth 1 https://github.com/MarvNC/kanjidego-yomitan-anki
    IPAmj Mincho (ipamjm.ttf, IPA Font License v1.0), from https://moji.or.jp/mojikiban/font/
    Jigmo (Jigmo.ttf, Jigmo2.ttf, Jigmo3.ttf, CC0), from https://kamichikoichi.github.io/jigmo/
    pip install fonttools brotli

    python3 scripts/nandoku/build-data.py \
        --terms ../kanjidego-yomitan-anki/export/termData.json \
        --ipamj ../ipamjm.ttf --jigmo ../Jigmo

    More levels: pass --terms several times (same termData.json format).

Outputs:
    data/nandoku/terms.json        every question (format below)
    data/nandoku/fonts/*.woff2     "Nandoku Mincho": IPAmj Mincho subset to the
                                   characters used, split into chunks so a browser
                                   downloads only the chunks it needs; Jigmo fills
                                   characters IPAmj doesn't have (CJK Ext. G/H…)
    data/nandoku/fonts/fonts.css   the @font-face rules with unicode-range

terms.json:
    { "levels": { "05": 1700, … },
      "terms": [[id, term, reading, ask, pre, suf, alts, vars, meaning, note, level], …] }
    reading   the reading as listed (may contain kanji: 'あくる日')
    ask       the part that is typed (kana); pre/suf are fixed text shown around
              the answer box, e.g. '[あくる]日'
    alts      other accepted answers (別解), same shape as ask
    vars      other spellings of the term (別表記)
"""

import argparse
import json
import os
import re
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument('--terms', action='append', required=True)
ap.add_argument('--ipamj', required=True)
ap.add_argument('--jigmo', required=True, help='folder with Jigmo.ttf, Jigmo2.ttf, Jigmo3.ttf')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'nandoku'))
ap.add_argument('--chunk', type=int, default=240)
args = ap.parse_args()

OUT = os.path.abspath(args.out)
FONTS = os.path.join(OUT, 'fonts')
os.makedirs(FONTS, exist_ok=True)

# Scrape glitches in the wiki data: the reading repeats the tail of the term
READING_FIXES = {
    '躪り書き': 'にじりがき',
    '鬨の声': 'ときのこえ',
    '犂牛の喩え': 'りぎゅうのたとえ',
    '亥豕の譌': 'がいしのか',
}

KANA = re.compile(r'^[ぁ-ゟ゠-ヿー・]+$')
is_kana = lambda s: bool(KANA.match(s))
HAS_KANJI = re.compile('[㐀-鿿豈-﫿\U00020000-\U0003ffff々〆]')


def split_reading(term, reading):
    """Fixed text before/after the typed part, when the reading keeps some of
    the term's kanji ('あくる日' for '翌る日'): -> ('', 'あくる', '日')."""
    if is_kana(reading):
        return '', reading, ''
    n = 0
    while n < min(len(term), len(reading)) and term[n] == reading[n]:
        n += 1
    pre = reading[:n] if not is_kana(reading[:n] or 'あ') else ''
    m = 0
    while m < min(len(term), len(reading)) - len(pre) and term[-1 - m] == reading[-1 - m]:
        m += 1
    common = reading[len(reading) - m:] if m else ''
    # the fixed suffix starts at its first kanji; kana before it (okurigana,
    # particles) stays part of the answer
    k = next((i for i, ch in enumerate(common) if not is_kana(ch)), None)
    suf = common[k:] if k is not None else ''
    ask = reading[len(pre):len(reading) - len(suf)]
    return pre, ask, suf


terms = []
skipped = []
levels = Counter()
for path in args.terms:
    for i, e in enumerate(json.load(open(path, encoding='utf-8'))):
        term = e['termReading']['term']
        reading = READING_FIXES.get(term, e['termReading']['reading'])
        info = e['termInfo']
        level = e['termLevel']
        if not HAS_KANJI.search(term):
            # the game shows this word as an image of a character Unicode
            # doesn't have; as text it would give the answer away
            skipped.append(term)
            continue
        pre, ask, suf = split_reading(term, reading)
        if not is_kana(ask):
            print('skip (reading not kana):', term, reading)
            continue
        alts = []
        for a in info.get('別解', []):
            if pre and a.startswith(pre):
                a = a[len(pre):]
            if suf and a.endswith(suf):
                a = a[:-len(suf)]
            if is_kana(a) and a != ask and a not in alts:
                alts.append(a)
        tid = info.get('問題ID') or f'Lv{level}_x{i}'
        vars_ = [v for v in info.get('別表記', []) if not v.startswith('<')]
        terms.append([tid, term, reading, ask, pre, suf, alts, vars_,
                      info.get('意味', ''), info.get('追記', ''), level])
        levels[level] += 1

ids = Counter(t[0] for t in terms)
assert all(v == 1 for v in ids.values()), [k for k, v in ids.items() if v > 1]

with open(os.path.join(OUT, 'terms.json'), 'w', encoding='utf-8') as f:
    json.dump({'levels': dict(sorted(levels.items())), 'terms': terms}, f, ensure_ascii=False, separators=(',', ':'))
print('terms', len(terms), dict(sorted(levels.items())), f'(skipped {len(skipped)} image-only words)')

# ---------------------------------------------------------------- fonts
from fontTools.ttLib import TTFont
from fontTools import subset

VS = set(range(0xFE00, 0xFE10)) | set(range(0xE0100, 0xE01F0))
BASE = set(range(0x3041, 0x3097)) | set(range(0x30A1, 0x30FB)) | set(map(ord, 'ー々〆ヶ・「」『』（）、。〜'))

ipamj_cmap = TTFont(args.ipamj, lazy=True).getBestCmap()
jigmo = []
for name in ('Jigmo.ttf', 'Jigmo2.ttf', 'Jigmo3.ttf'):
    p = os.path.join(args.jigmo, name)
    jigmo.append((p, TTFont(p, lazy=True).getBestCmap()))

# Characters in order of first use: main terms level by level, then the other
# spellings (only shown on the answer card)
order, seen, uses, ivs_bases = [], set(), Counter(), set()
for pass_ in ('main', 'vars'):
    for t in sorted(terms, key=lambda t: t[10]):
        texts = [t[1]] if pass_ == 'main' else t[7]
        for s in texts:
            cps = [ord(c) for c in s]
            for j, cp in enumerate(cps):
                if cp in VS:
                    if j:
                        ivs_bases.add(cps[j - 1])
                    continue
                uses[cp] += 1
                if cp not in seen:
                    seen.add(cp)
                    order.append(cp)

chunks = [sorted(BASE | ivs_bases | {cp for cp in order if uses[cp] >= 4 and cp in ipamj_cmap})]
first = set(chunks[0])
rest = [cp for cp in order if cp not in first and cp in ipamj_cmap]
for i in range(0, len(rest), args.chunk):
    chunks.append(rest[i:i + args.chunk])
fallback = {p: [] for p, _ in jigmo}
missing = []
for cp in order:
    if cp in ipamj_cmap:
        continue
    src = next((p for p, cm in jigmo if cp in cm), None)
    (fallback[src] if src else missing).append(cp)
if missing:
    print('no font has:', ''.join(map(chr, missing)))


def ranges(cps):
    cps = sorted(set(cps))
    out, start, prev = [], None, None
    for cp in cps + [None]:
        if start is not None and (cp is None or cp != prev + 1):
            out.append(f'U+{start:X}' if start == prev else f'U+{start:X}-{prev:X}')
            start = None
        if cp is not None and start is None:
            start = cp
        prev = cp
    return ','.join(out)


FAMILY = 'Nandoku Mincho'


def build(src, cps, out_name, with_vs=False):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = []            # rename below (IPA license: derived fonts get a new name)
    opts.notdef_outline = True
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(cps) + (sorted(VS) if with_vs else []))
    sub.subset(font)
    name = font['name']
    name.names = []
    for nid, val in ((1, FAMILY), (2, 'Regular'), (4, FAMILY), (6, 'NandokuMincho-Regular')):
        name.setName(val, nid, 3, 1, 0x409)
    subset.save_font(font, os.path.join(FONTS, out_name), opts)
    return os.path.getsize(os.path.join(FONTS, out_name))


for f in os.listdir(FONTS):
    if f.endswith('.woff2'):
        os.remove(os.path.join(FONTS, f))

css = ['/* Generated by scripts/nandoku/build-data.py. "Nandoku Mincho" is a subset of',
       '   IPAmj Mincho (IPA Font License v1.0) with Jigmo (CC0) for characters IPAmj',
       '   lacks. See LICENSE.md. */']
total = 0
for i, cps in enumerate(chunks):
    name = f'm{i:02d}.woff2'
    size = build(args.ipamj, cps, name, with_vs=(i == 0))
    total += size
    rng = ranges(cps + (sorted(VS) if i == 0 else []))
    css.append(f"@font-face{{font-family:'{FAMILY}';src:url('{name}') format('woff2');font-display:swap;unicode-range:{rng}}}")
for j, (p, cps) in enumerate((p, c) for p, c in fallback.items() if c):
    name = f'j{j:02d}.woff2'
    size = build(p, cps, name)
    total += size
    css.append(f"@font-face{{font-family:'{FAMILY}';src:url('{name}') format('woff2');font-display:swap;unicode-range:{ranges(cps)}}}")

with open(os.path.join(FONTS, 'fonts.css'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(css) + '\n')
print(f'fonts: {len(chunks)} IPAmj chunks + {sum(1 for c in fallback.values() if c)} Jigmo, {total / 1e6:.2f} MB total')
