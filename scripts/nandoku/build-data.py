#!/usr/bin/env python3
"""
build-data.py — builds the Nandoku Trainer's data and fonts in data/nandoku/.

Run locally whenever the sources update. Needs:

    wiki-terms.json from parse-wiki.py (the fan wiki 漢字でGO！ 問題集 @wiki,
        https://w.atwiki.jp/yuia_sk/ — levels 1–8 and こころのリテラシー)
    git clone --depth 1 https://github.com/MarvNC/kanjidego-yomitan-anki
        (optional: other spellings, alternate answers and notes for levels 5–7)
    Mochiy Pop One (MochiyPopOne-Regular.ttf, OFL), from https://github.com/fontdasu/Mochiypop
    IPAmj Mincho (ipamjm.ttf, IPA Font License v1.0), from https://moji.or.jp/mojikiban/font/
    Jigmo (Jigmo.ttf, Jigmo2.ttf, Jigmo3.ttf, CC0), from https://kamichikoichi.github.io/jigmo/
    pip install fonttools brotli shapely skia-pathops

    python3 scripts/nandoku/build-data.py --wiki wiki-terms.json \
        --marvnc ../kanjidego-yomitan-anki/export/termData.json \
        --pop ../MochiyPopOne-Regular.ttf --ipamj ../ipamjm.ttf --jigmo ../Jigmo

Outputs:
    data/nandoku/terms.json        every question (format below)
    data/nandoku/fonts/*.woff2     "Nandoku Pop", a heavy rounded face close to the
                                   game's lettering: Mochiy Pop One, plus the rare
                                   kanji it lacks taken from IPAmj Mincho / Jigmo and
                                   thickened to match (embolden.py). Subset to the
                                   characters used and split into chunks so a
                                   browser downloads only the chunks it needs.
    data/nandoku/fonts/fonts.css   the @font-face rules with unicode-range

terms.json:
    { "sets": { "01": 100, …, "08": 99, "alt": …, "kokoro": … },
      "terms": [[id, term, segs, readings, meaning, note, vars, hint, tags, set, of, cores], …] }
    segs      the term split into [yellow, white, yellow, …] runs as the game colours
              it (white: okurigana and given parts); [] = colour kanji/kana automatically
    readings  accepted answers, full readings in kana; the first is the main one
    vars      other spellings (別表記)
    hint      answer length the game gives (N文字指定), 0 if none
    tags      categories from the wiki (動物, 地名・建造物, …)
    set       '01'…'08', 'kokoro' (こころのリテラシー), or 'alt': every other spelling
              as its own question, with the readings and meaning of the word it spells
    of        for 'alt' questions, the id of that word ('' otherwise)
    cores     readings of the yellow part alone (とちぎ for 栃木県), also accepted
"""

import argparse
import json
import os
import re
from collections import Counter

ap = argparse.ArgumentParser()
ap.add_argument('--wiki', required=True, help='output of parse-wiki.py')
ap.add_argument('--marvnc', help="MarvNC's export/termData.json")
ap.add_argument('--pop', required=True, help='MochiyPopOne-Regular.ttf')
ap.add_argument('--ipamj', required=True)
ap.add_argument('--jigmo', required=True, help='folder with Jigmo.ttf, Jigmo2.ttf, Jigmo3.ttf')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'nandoku'))
ap.add_argument('--chunk', type=int, default=240)
args = ap.parse_args()

OUT = os.path.abspath(args.out)
FONTS = os.path.join(OUT, 'fonts')
os.makedirs(FONTS, exist_ok=True)

KANA = re.compile(r'^[ぁ-ゟ゠-ヿー・]+$')
is_kana = lambda s: bool(KANA.match(s))
HAS_KANJI = re.compile('[\u3400-\u9fff\uf900-\ufaff\U00020000-\U0003ffff々〆〇]')
DESCRIPTION = re.compile(r'[\u2ff0-\u2fff\[\]{}<>?？〓■]')


def clean_reading(r):
    # wiki typos like '(ぐうぞうすうはい}' or a stray 'ｋ'
    return re.sub(r'[^ぁ-ゟ゠-ヿー・]', '', r)


def good_spelling(v, readings):
    return bool(v) and not DESCRIPTION.search(v) and HAS_KANJI.search(v) and v not in readings


# Supplement from MarvNC's export (levels 5–7): other spellings, 別解, notes.
# IDs were reassigned when the game swapped questions, so match on the word.
marvnc = {}
if args.marvnc:
    for e in json.load(open(args.marvnc, encoding='utf-8')):
        marvnc.setdefault(e['termReading']['term'], e)

terms, skipped = [], Counter()
for e in json.load(open(args.wiki, encoding='utf-8')):
    term = e['term']
    readings = []
    for r in e['readings']:
        r = clean_reading(r)
        if r and r not in readings:
            readings.append(r)
    if not HAS_KANJI.search(term):
        skipped['no kanji (image-only word)'] += 1
        continue
    if not readings or any(not is_kana(r) for r in readings):
        skipped['no usable reading'] += 1
        continue
    vars_ = [v for v in e['vars'] if good_spelling(v, readings)]
    note = e['note']
    meaning = e['meaning']
    m = marvnc.get(term)
    if m:
        info = m['termInfo']
        for v in info.get('別表記', []):
            if good_spelling(v, readings) and v != term and v not in vars_:
                vars_.append(v)
        if is_kana(m['termReading']['reading']):
            for a in info.get('別解', []):
                if is_kana(a) and a not in readings:
                    readings.append(a)
        note = note or info.get('追記', '')
        meaning = meaning or info.get('意味', '')
    segs = e['segs'] if len(e['segs']) > 1 else []
    # Only when the yellow part is all kanji: then the wiki's red marks on the
    # word and on its reading line up (ほほ笑む marks む differently in each)
    yellow_ok = segs and not any(is_kana(ch) for run in segs[0::2] for ch in run)
    cores = [c for c in map(clean_reading, e.get('cores', [])) if c and is_kana(c) and c not in readings] if yellow_ok else []
    terms.append([e['id'], term, segs, readings, meaning, note, vars_, e['hint'], e['tags'], e['set'], '', cores])

# ---------------------------------------------------------------- 別表記 set
# Every other spelling becomes its own question, unless it's already a word
# in the list. A spelling shared by several words accepts all their readings.
main_terms = {t[1] for t in terms}
alt_rows = {}
for t in terms:
    tid, term, segs, readings, meaning, note, vars_, hint, tags, set_, _, _ = t
    for j, v in enumerate(vars_):
        if v in main_terms:
            continue
        if v in alt_rows:
            row = alt_rows[v]
            row[3] += [r for r in readings if r not in row[3]]
            if row[7] and row[7] != hint:
                row[7] = 0
            continue
        others = [term] + [x for x in vars_ if x != v]
        alt_rows[v] = [f'{tid}_v{j + 1}', v, [], list(readings), meaning, note, others, hint, list(tags), 'alt', tid, []]
terms.extend(alt_rows.values())

sets = Counter(t[9] for t in terms)
ids = Counter(t[0] for t in terms)
assert all(v == 1 for v in ids.values()), [k for k, v in ids.items() if v > 1]

with open(os.path.join(OUT, 'terms.json'), 'w', encoding='utf-8') as f:
    json.dump({'sets': dict(sorted(sets.items())), 'terms': terms}, f, ensure_ascii=False, separators=(',', ':'))
print('terms', len(terms), dict(sorted(sets.items())), 'skipped', dict(skipped))

# ---------------------------------------------------------------- fonts
import sys
from fontTools.ttLib import TTFont
from fontTools import subset
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embolden import embolden

FAMILY = 'Nandoku Pop'
VS = set(range(0xFE00, 0xFE10)) | set(range(0xE0100, 0xE01F0))
BASE = (set(range(0x3041, 0x3097)) | set(range(0x30A1, 0x30FB)) | set(range(0x21, 0x7F))
        | set(map(ord, 'ー々〆ヶ・「」『』（）、。〜〇')))

pop_cmap = TTFont(args.pop, lazy=True).getBestCmap()
ipamj_cmap = TTFont(args.ipamj, lazy=True).getBestCmap()
jigmo = []
for name in ('Jigmo.ttf', 'Jigmo2.ttf', 'Jigmo3.ttf'):
    p = os.path.join(args.jigmo, name)
    jigmo.append((p, TTFont(p, lazy=True).getBestCmap()))

# Characters in order of first use: the questions set by set, then any other
# spellings that aren't questions themselves (shown on the answer card). Variation selectors are left out:
# the pop face has one form per character.
order, seen, uses = [], set(), Counter()
for pass_ in ('main', 'vars'):
    for t in sorted(terms, key=lambda t: t[9]):
        for s in ([t[1]] if pass_ == 'main' else t[6]):
            for c in s:
                cp = ord(c)
                if cp in VS or cp < 0x80:
                    continue
                if pass_ == 'main':
                    uses[cp] += 1
                if cp not in seen:
                    seen.add(cp)
                    order.append(cp)

pop_order = [cp for cp in order if cp in pop_cmap]
first = sorted({cp for cp in BASE if cp in pop_cmap} | {cp for cp in pop_order if uses[cp] >= 4})
chunks = [('pop', args.pop, first)]
rest = [cp for cp in pop_order if cp not in set(first)]
for i in range(0, len(rest), args.chunk):
    chunks.append(('pop', args.pop, rest[i:i + args.chunk]))

# Everything the pop face lacks: thickened from IPAmj Mincho, else Jigmo
by_src = {args.ipamj: []}
by_src.update({p: [] for p, _ in jigmo})
missing = []
for cp in order:
    if cp in pop_cmap:
        continue
    src = args.ipamj if cp in ipamj_cmap else next((p for p, cm in jigmo if cp in cm), None)
    (by_src[src] if src else missing).append(cp)
if missing:
    print('no font has:', ''.join(map(chr, missing)))
for src, cps in by_src.items():
    for i in range(0, len(cps), args.chunk):
        chunks.append(('bold', src, cps[i:i + args.chunk]))


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


def build(kind, src, cps, out_name):
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*'] if kind == 'pop' else []
    opts.name_IDs = []            # renamed below (the IPA license requires a new name)
    opts.notdef_outline = True
    opts.hinting = False
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    if kind == 'bold':
        glyf, gs = font['glyf'], font.getGlyphSet()
        upm = font['head'].unitsPerEm
        for cp, gname in font.getBestCmap().items():
            g = embolden(gs, gname, upm, (font['hmtx'][gname][0] / 2, upm * 0.38))
            g.recalcBounds(glyf)
            glyf[gname] = g
    name = font['name']
    name.names = []
    for nid, val in ((1, FAMILY), (2, 'Regular'), (4, FAMILY), (6, 'NandokuPop-Regular')):
        name.setName(val, nid, 3, 1, 0x409)
    subset.save_font(font, os.path.join(FONTS, out_name), opts)
    return os.path.getsize(os.path.join(FONTS, out_name))


for f in os.listdir(FONTS):
    if f.endswith('.woff2'):
        os.remove(os.path.join(FONTS, f))

css = ['/* Generated by scripts/nandoku/build-data.py. "Nandoku Pop": Mochiy Pop One',
       '   (OFL) plus rare kanji from IPAmj Mincho (IPA Font License v1.0) and Jigmo',
       '   (CC0), thickened to match. See ../LICENSE.md. */']
total = 0
counts = Counter()
for kind, src, cps in chunks:
    tag = 'p' if kind == 'pop' else 'b'
    out_name = f'{tag}{counts[tag]:02d}.woff2'
    counts[tag] += 1
    total += build(kind, src, cps, out_name)
    css.append(f"@font-face{{font-family:'{FAMILY}';src:url('{out_name}') format('woff2');font-display:block;unicode-range:{ranges(cps)}}}")
    print(out_name, len(cps), flush=True)

with open(os.path.join(FONTS, 'fonts.css'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(css) + '\n')
print(f'fonts: {counts["p"]} pop chunks + {counts["b"]} thickened, {total / 1e6:.2f} MB total')
