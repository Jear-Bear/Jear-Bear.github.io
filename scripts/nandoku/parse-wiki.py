#!/usr/bin/env python3
"""
parse-wiki.py — turns saved pages of the fan wiki 漢字でGO！ 問題集 @wiki
(https://w.atwiki.jp/yuia_sk/) into a word list for build-data.py.

The wiki sits behind a browser check, so save the pages from a browser first
(the #wikibody element's HTML, or the whole page) as <dir>/<page number>.html,
for the page numbers in PAGES below. Then:

    python3 scripts/nandoku/parse-wiki.py <dir> > wiki-terms.json

Each wiki entry looks like:

    <h3>ID:Lv05_0001　はびこる</h3>            reading(s), '、'-separated; red = kana the
                                                game shows in white (okurigana, given parts)
    テキスト：<red>…</red>…                     the word as the game shows it
    意味：…   別表記：…   別読み：…   補足：…   元作品：…
    3文字指定　動物                             answer length hint, categories
    ※この問題は現在非表示です！                 no longer asked in the game → skipped

Output: a list of
    { id, set, term, segs, readings, meaning, note, vars, hint, tags }
where segs splits term into alternating [yellow, white, yellow, …] runs, as the
game colours them.
"""

import html
import json
import os
import re
import sys

# wiki page number -> set ('01'…'08', or a casual-mode set)
PAGES = {
    27: '01', 28: '02', 29: '03', 30: '04', 54: '04', 55: '04', 56: '04',
    21: '05', 47: '05', 49: '05', 50: '05', 51: '05',
    23: '06', 43: '06', 44: '06', 16: '07', 36: '07', 17: '08',
    37: 'kokoro',      # こころのリテラシー (casual mode)
}
RED = re.compile(r'<span style="color:\s*(?:red|#F54738);?">(.*?)</span>', re.S | re.I)
JUNK_TAGS = re.compile(r'imageプラグイン|いいね|^タグ|^漢字でGO$|^問題集$|^レベル\d|^ID[:：]|^[:：]|[()（）]|全\d|追加|用例|。$|^Lv')


def plain(fragment):
    s = re.sub(r'<rp>.*?</rp>', '', fragment, flags=re.S)
    s = re.sub(r'<rt>(.*?)</rt>', r'(\1)', s, flags=re.S)       # ruby -> base(reading)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s).replace(' ', ' ')
    return re.sub(r'\s*\(\s*', '(', re.sub(r'\s*\)\s*', ')', s)).strip()


def segments(fragment):
    """Split marked-up text into [yellow, white, yellow, …] runs."""
    fragment = re.sub(r'<!--.*?-->', '', fragment, flags=re.S)
    out, pos = [''], 0
    for m in RED.finditer(fragment):
        out[-1] += plain(fragment[pos:m.start()])
        out.append(plain(m.group(1)))
        out.append('')
        pos = m.end()
    out[-1] += plain(fragment[pos:])
    while len(out) > 1 and out[-1] == '':
        out.pop()
    # merge accidental empty white runs
    merged = [out[0]]
    for i in range(1, len(out), 2):
        white, yellow = out[i], out[i + 1] if i + 1 < len(out) else None
        if white == '' and yellow is not None:
            merged[-1] += yellow
        else:
            merged.append(white)
            if yellow is not None:
                merged.append(yellow)
    return [re.sub(r'\s+', '', s) for s in merged]


def split_list(s):
    return [x.strip() for x in re.split(r'[、,，/／]', s) if x.strip()]


def parse_page(path, set_):
    src = open(path, encoding='utf-8').read()
    parts = re.split(r'<h3[^>]*>(.*?)</h3>', src, flags=re.S)
    entries = []
    for i in range(1, len(parts), 2):
        head = re.sub(r'\s+', ' ', plain(parts[i]))
        m = re.match(r'ID[:：]\s*(?:Lv(\d+)_)?(\d+)\s*(.*)', head)
        if not m:
            continue
        num = int(m.group(2))
        reading_text = re.sub(r'\s+', '', m.group(3))
        reading_text = re.sub(r'等$', '', reading_text)
        body = parts[i + 1]
        if '現在非表示' in body:
            continue
        e = {
            'id': f'{"Lv" + set_ if set_.isdigit() else set_}_{num:04d}',
            'set': set_, 'term': '', 'segs': [], 'readings': split_list(reading_text),
            'meaning': '', 'note': [], 'vars': [], 'hint': 0, 'tags': [],
        }
        for line in re.split(r'<br\s*/?>|</div>|<div[^>]*>', body):
            text = plain(line)
            if not text:
                continue
            key, _, val = text.partition('：') if '：' in text[:8] else ('', '', text)
            if key == 'テキスト':
                frag = line.split('テキスト：', 1)[1] if 'テキスト：' in line else val
                frag = re.split(r'　IDS：|\s+IDS：|IDS：', frag)[0]
                e['segs'] = segments(frag)
                e['term'] = ''.join(e['segs'])
            elif key == '意味':
                e['meaning'] = val
            elif key == '別表記':
                e['vars'] += split_list(val)
            elif key == '別読み':
                e['readings'] += [r for r in split_list(re.sub(r'\s+', '', val)) if r not in e['readings']]
            elif key in ('補足', '元作品'):
                e['note'].append(val.replace('🔗典拠', '').replace('🔗リンク', '').strip())
            elif key in ('典拠', 'IDS', 'タグ'):
                continue
            else:
                for tok in re.split(r'[　\s]+', text):
                    n = re.match(r'(\d+)文字指定', tok)
                    if n:
                        e['hint'] = int(n.group(1))
                    elif tok and not JUNK_TAGS.search(tok) and len(tok) <= 12:
                        e['tags'].append(tok)
        e['note'] = ' '.join(x for x in e['note'] if x)
        if e['term'] and e['readings']:
            entries.append(e)
    return entries


def main():
    folder = sys.argv[1]
    out, seen = [], set()
    for page, set_ in PAGES.items():
        path = os.path.join(folder, f'{page}.html')
        if not os.path.exists(path):
            print(f'missing page {page} ({set_})', file=sys.stderr)
            continue
        for e in parse_page(path, set_):
            if e['id'] in seen:
                continue
            seen.add(e['id'])
            out.append(e)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=0)


if __name__ == '__main__':
    main()
