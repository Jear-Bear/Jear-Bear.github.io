"""
rebolden.py — rebuilds only the thickened rare-kanji chunks (b*.woff2) of
"Nandoku Pop" after a change to embolden.py, keeping each chunk's characters
(read from fonts.css) so fonts.css and the pop chunks stay as they are.

    python3 scripts/nandoku/rebolden.py --ipamj ../ipamjm.ttf --jigmo ../Jigmo
"""
import argparse, os, re, sys
from fontTools.ttLib import TTFont
from fontTools import subset
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from embolden import embolden

ap = argparse.ArgumentParser()
ap.add_argument('--ipamj', required=True)
ap.add_argument('--jigmo', required=True, help='folder with Jigmo.ttf, Jigmo2.ttf, Jigmo3.ttf')
ap.add_argument('--fonts', default=os.path.join(os.path.dirname(__file__), '../../data/nandoku/fonts'))
ap.add_argument('--keep', type=float, help='override embolden.KEEP_SPACE (for comparing)')
ap.add_argument('--only', help='comma-separated chunk names to rebuild, e.g. b00,b05')
args = ap.parse_args()
if args.keep is not None:
    import embolden as _e
    _e.KEEP_SPACE = args.keep

FAMILY = 'Nandoku Pop'
css = open(os.path.join(args.fonts, 'fonts.css'), encoding='utf-8').read()
chunks = re.findall(r"url\('(b\d+)\.woff2'\).*?unicode-range:([^}]+)\}", css)
sources = [args.ipamj] + [os.path.join(args.jigmo, n) for n in ('Jigmo.ttf', 'Jigmo2.ttf', 'Jigmo3.ttf')]
cmaps = [(p, TTFont(p, lazy=True).getBestCmap()) for p in sources]


def expand(ranges):
    out = []
    for r in ranges.split(','):
        r = r.strip()[2:]
        a, _, b = r.partition('-')
        out += list(range(int(a, 16), int(b or a, 16) + 1))
    return out


for name, ranges in chunks:
    if args.only and name not in args.only.split(','):
        continue
    cps = expand(ranges)
    src = next(p for p, cm in cmaps if all(cp in cm for cp in cps))   # the build keeps one source per chunk
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.name_IDs = []
    opts.notdef_outline = True
    opts.hinting = False
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=cps)
    sub.subset(font)
    glyf, gs = font['glyf'], font.getGlyphSet()
    upm = font['head'].unitsPerEm
    for cp, gname in font.getBestCmap().items():
        g = embolden(gs, gname, upm, (font['hmtx'][gname][0] / 2, upm * 0.38))
        g.recalcBounds(glyf)
        glyf[gname] = g
    nm = font['name']
    nm.names = []
    for nid, val in ((1, FAMILY), (2, 'Regular'), (4, FAMILY), (6, 'NandokuPop-Regular')):
        nm.setName(val, nid, 3, 1, 0x409)
    out = os.path.join(args.fonts, f'{name}.woff2')
    subset.save_font(font, out, opts)
    print(f'{name}: {len(cps)} glyphs from {os.path.basename(src)}, {os.path.getsize(out) // 1024} KB')
