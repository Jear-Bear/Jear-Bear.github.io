#!/usr/bin/env python3
"""
build-data.py — builds the Kanji Trainer's data files in data/kanji/.

Run once locally (or whenever the sources update). Needs three git clones:

    git clone --depth 1 https://github.com/mifunetoshiro/kanjium
    git clone --depth 1 https://github.com/KanjiVG/kanjivg
    git clone --depth 1 https://github.com/davidluzgouveia/kanji-data

    python3 scripts/kanji/build-data.py --kanjium ../kanjium --kanjivg ../kanjivg --kanjidata ../kanji-data

Outputs (all derived data is CC BY-SA; see data/kanji/LICENSE.md):
    data/kanji/meta.json         sets (jōyō, jinmeiyō, JLPT, Kanken, school grade) + look-alikes
    data/kanji/index-core.json   details for jōyō + jinmeiyō kanji (loaded first)
    data/kanji/index-extra.json  details for every other kanji (loaded only when needed)
    data/kanji/k/<hex>.json      per kanji: stroke paths + common words (loaded on demand)

Index entry (array, to keep the files small):
    [strokes, on, kun, meaning, jlpt, kanken, freq, hasStrokeData]
    on / kun: readings joined with '、'; kun okurigana marked with '.', e.g. 'まな.ぶ'
Word entry: [word, reading, meaning, frequency 0–3, jlpt 0–5]
"""

import argparse
import json
import os
import re
import sqlite3
from datetime import date

ap = argparse.ArgumentParser()
ap.add_argument('--kanjium', required=True)
ap.add_argument('--kanjivg', required=True)
ap.add_argument('--kanjidata', required=True)
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'kanji'))
args = ap.parse_args()

OUT = os.path.abspath(args.out)
os.makedirs(os.path.join(OUT, 'k'), exist_ok=True)

con = sqlite3.connect(os.path.join(args.kanjium, 'data', 'kanjidb.sqlite'))
kd_json = json.load(open(os.path.join(args.kanjidata, 'kanji.json'), encoding='utf-8'))

# The official jōyō list prints 𠮟 and 剝; everyday text, fonts and KanjiVG use
# 叱 and 剥 (the list allows both). Use the everyday forms, official readings.
ALIAS = {'𠮟': '叱', '剝': '剥'}

GRADE = {  # kanjium grade label -> school grade (7–10 = JHS 1–3, high school)
    'Kyōiku-Jōyō (1st grade of primary school)': 1,
    'Kyōiku-Jōyō (2nd grade of primary school)': 2,
    'Kyōiku-Jōyō (3rd grade of primary school)': 3,
    'Kyōiku-Jōyō (4th grade of primary school)': 4,
    'Kyōiku-Jōyō (5th grade of primary school)': 5,
    'Kyōiku-Jōyō (6th grade of primary school)': 6,
    'Jōyō (1st grade of junior high school)': 7,
    'Jōyō (2nd grade of junior high school)': 8,
    'Jōyō (3rd grade of junior high school)': 9,
    'Jōyō (high school)': 10,
}
# Kanken 10級–2級 follow the jōyō school-grade split exactly (2020 allocation):
# 10級 = grade 1 … 5級 = grade 6, 4級 = JHS1, 3級 = JHS2, 準2級 = JHS3, 2級 = high school
KANKEN_BY_GRADE = {1: '10', 2: '9', 3: '8', 4: '7', 5: '6', 6: '5', 7: '4', 8: '3', 9: 'p2', 10: '2'}
FREQ = {'Very common': 3, 'Common': 2, 'Uncommon': 1, 'Rare': 0}


def clean_on(s):
    s = re.sub(r'\([^)]*\)', '', s or '').replace('*', '')
    return [r.strip() for r in s.split('、') if r.strip()]


def clean_kun(s):
    s = (s or '').replace('（', '.').replace('）', '').replace('*', '')
    return [r.strip() for r in s.split('、') if r.strip()]


def clean_meaning(s, limit=3):
    s = re.sub(r'\(kokuji\)', '', s or '')
    parts = [p.strip() for p in s.split(';') if p.strip()]
    return '; '.join(parts[:limit])


def clean_word_meaning(s):
    """'[noun, する verb] {1} school;academy;{2} …' -> 'school; academy'"""
    s = re.sub(r'\[[^\]]*\]', '', s or '')
    m = re.split(r'\{\d+\}', s)
    first = next((x for x in m if x.strip()), '')
    first = re.sub(r'\([^)]*\)', '', first)
    glosses = [g.strip() for g in first.split(';') if g.strip()]
    out = '; '.join(glosses[:3])
    return out[:70].rstrip(' ;,')


def jlpt_num(s):
    m = re.match(r'N(\d)', s or '')
    return int(m.group(1)) if m else 0


def freq_num(s):
    return FREQ.get((s or '').rstrip('*'), 0)


# ---------------------------------------------------------------- kanji
rows = con.execute(
    'select kanji, grade, jlpt, kanken, strokes, reg_on, reg_kun, onyomi, kunyomi, '
    'compact_meaning, meaning, frequency from kanjidict').fetchall()

info = {}
for (k, grade, jlpt, kanken, strokes, reg_on, reg_kun, on, kun, cm, meaning, freq) in rows:
    char = ALIAS.get(k, k)
    official = bool(reg_on or reg_kun)
    rec = info.get(char, {})
    if rec.get('official') and not official:
        continue  # keep the official jōyō row when both forms exist
    info[char] = {
        'official': official,
        'grade': GRADE.get(grade or ''),
        'kanken_raw': kanken or '',
        'strokes': int(strokes) if str(strokes or '').isdigit() else 0,
        'on': clean_on(reg_on) if official else clean_on(on)[:3],
        'kun': clean_kun(reg_kun) if official else clean_kun(kun)[:4],
        'meaning': clean_meaning(cm or meaning),
        'freq': int(freq) if str(freq or '').isdigit() else 0,
    }

# Jinmeiyō (KANJIDIC2 grades 9 and 10, via kanji-data) and JLPT (Tanos lists, via kanji-data)
jinmeiyo = [k for k, v in kd_json.items() if v.get('grade') in (9, 10)]
jlpt = {k: v.get('jlpt_new') or 0 for k, v in kd_json.items()}
for k in jinmeiyo:
    if k not in info:  # shouldn't happen, but fall back to kanji-data details
        v = kd_json[k]
        info[k] = {'official': False, 'grade': None, 'kanken_raw': '', 'strokes': v.get('strokes') or 0,
                   'on': [r for r in (v.get('readings_on') or [])][:3],
                   'kun': [r for r in (v.get('readings_kun') or [])][:4],
                   'meaning': '; '.join((v.get('meanings') or [])[:3]), 'freq': v.get('freq') or 0}

joyo = sorted([k for k, v in info.items() if v['grade']], key=lambda k: (info[k]['grade'], info[k]['freq'] or 9999))
joyo_set = set(joyo)
jinmeiyo = sorted(set(jinmeiyo) - joyo_set, key=lambda k: info[k]['freq'] or 9999)


def kanken(k):
    g = info[k]['grade']
    if g:
        return KANKEN_BY_GRADE[g]
    raw = info[k]['kanken_raw']
    return {'pre-1': 'p1', '1': '1'}.get(raw, '1' if raw else '')


# ---------------------------------------------------------------- strokes
def stroke_paths(char):
    for c in [char] + [a for a, b in ALIAS.items() if b == char]:
        path = os.path.join(args.kanjivg, 'kanji', f'{ord(c):05x}.svg')
        if os.path.exists(path):
            svg = open(path, encoding='utf-8').read()
            strokes = re.findall(r'<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*? d="([^"]+)"', svg)
            if strokes:
                return [d for _, d in sorted(strokes, key=lambda t: int(t[0]))]
    return None


# ---------------------------------------------------------------- words
words_by = {}
for (k, word, reading, meaning, jl, fr) in con.execute(
        'select kanji, jukugo, reading, meaning, jlpt, frequency from jukugo'):
    words_by.setdefault(ALIAS.get(k, k), []).append((word, reading, clean_word_meaning(meaning), freq_num(fr), jlpt_num(jl)))
# Single-kanji words with okurigana (学ぶ, 高い…)
for (k, word, reading, meaning, jl, fr) in con.execute(
        'select kanji, okurigana, reading, meaning, jlpt, frequency from edict'):
    if word and word != k and reading and not re.search(r'[ァ-ヶ]', reading):
        words_by.setdefault(ALIAS.get(k, k), []).append((word, reading, clean_word_meaning(meaning), freq_num(fr), jlpt_num(jl)))


def top_words(char, n=8):
    seen, out = set(), []
    for w in sorted(words_by.get(char, []), key=lambda w: (-w[3], -(w[4] or 0), len(w[0]))):
        if w[0] in seen or not w[1] or not w[2]:
            continue
        seen.add(w[0])
        out.append(list(w))
        if len(out) >= n:
            break
    return out


# ---------------------------------------------------------------- write
def entry(k):
    v = info[k]
    return [v['strokes'], '、'.join(v['on']), '、'.join(v['kun']), v['meaning'], jlpt.get(k, 0), kanken(k),
            v['freq'], 1 if stroke_paths_cache.get(k) else 0]


all_chars = sorted(info, key=lambda k: (0 if k in joyo_set else 1, info[k]['freq'] or 99999, k))
stroke_paths_cache = {}
for k in all_chars:
    stroke_paths_cache[k] = stroke_paths(k)
    detail = {'s': stroke_paths_cache[k] or [], 'w': top_words(k)}
    with open(os.path.join(OUT, 'k', f'{ord(k):05x}.json'), 'w', encoding='utf-8') as f:
        json.dump(detail, f, ensure_ascii=False, separators=(',', ':'))

core_chars = [k for k in all_chars if k in joyo_set or k in set(jinmeiyo)]
extra_chars = [k for k in all_chars if k not in set(core_chars)]
for name, chars in (('index-core.json', core_chars), ('index-extra.json', extra_chars)):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump({k: entry(k) for k in chars}, f, ensure_ascii=False, separators=(',', ':'))

def by(pred, pool):
    return ''.join(k for k in pool if pred(k))

lookalikes = {}
for (k, others) in con.execute('select * from lookalikes'):
    lookalikes[ALIAS.get(k, k)] = ''.join(ALIAS.get(o, o) for o in (others or '').split(',') if o)

sets = {
    'joyo': ''.join(joyo),
    'jinmeiyo': ''.join(jinmeiyo),
    'jlpt': {str(n): by(lambda k, n=n: jlpt.get(k) == n, all_chars) for n in (5, 4, 3, 2, 1)},
    'kanken': {lv: by(lambda k, lv=lv: kanken(k) == lv, all_chars)
               for lv in ('10', '9', '8', '7', '6', '5', '4', '3', 'p2', '2', 'p1', '1')},
    'grade': {str(g): by(lambda k, g=g: info[k]['grade'] == g, joyo) for g in range(1, 11)},
}
meta = {
    'version': 1,
    'built': date.today().isoformat(),
    'counts': {'kanji': len(all_chars), 'core': len(core_chars), 'extra': len(extra_chars),
               'withStrokes': sum(1 for k in all_chars if stroke_paths_cache[k]),
               'words': sum(len(top_words(k)) for k in all_chars)},
    'sets': sets,
    'lookalikes': lookalikes,
}
with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, separators=(',', ':'))

print(json.dumps(meta['counts']))
print('jōyō', len(joyo), 'jinmeiyō', len(jinmeiyo))
print('JLPT', {n: len(s) for n, s in sets['jlpt'].items()})
print('Kanken', {lv: len(s) for lv, s in sets['kanken'].items()})
