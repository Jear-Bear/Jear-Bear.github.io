"""
embolden.py — thickens glyph outlines so rare kanji (drawn thin in IPAmj
Mincho / Jigmo) match the heavy pop style of Mochiy Pop One.

Outline -> flattened polygons -> overlaps resolved (skia-pathops) -> grown
with a round-joined buffer (shapely) -> TrueType contours. How much to grow
is chosen per glyph so its ink coverage matches what Mochiy Pop One uses
for a glyph of the same complexity (see INK_BY_PERIMETER).

    pip install fonttools shapely skia-pathops
"""
import pathops
from shapely.geometry import Polygon, MultiPolygon
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

def flatten(rec, steps=8):
    contours, cur, start = [], [], None
    def q(p0, p1, p2):
        return [((1-t)**2*p0[0]+2*(1-t)*t*p1[0]+t*t*p2[0], (1-t)**2*p0[1]+2*(1-t)*t*p1[1]+t*t*p2[1]) for t in [i/steps for i in range(1, steps+1)]]
    def c(p0, p1, p2, p3):
        return [((1-t)**3*p0[0]+3*(1-t)**2*t*p1[0]+3*(1-t)*t*t*p2[0]+t**3*p3[0], (1-t)**3*p0[1]+3*(1-t)**2*t*p1[1]+3*(1-t)*t*t*p2[1]+t**3*p3[1]) for t in [i/steps for i in range(1, steps+1)]]
    for op, args in rec:
        if op == 'moveTo':
            cur = [args[0]]
        elif op == 'lineTo':
            cur.append(args[0])
        elif op == 'qCurveTo':
            pts = list(args)
            if pts[-1] is None:  # all off-curve contour
                pts = pts[:-1]; 
                mids = [((pts[i][0]+pts[(i+1)%len(pts)][0])/2, (pts[i][1]+pts[(i+1)%len(pts)][1])/2) for i in range(len(pts))]
                cur = [mids[-1]]
                for i, p in enumerate(pts): cur += q(cur[-1], p, mids[i])
                continue
            p0 = cur[-1]
            offs, end = pts[:-1], pts[-1]
            for i, off in enumerate(offs):
                e = end if i == len(offs)-1 else ((off[0]+offs[i+1][0])/2, (off[1]+offs[i+1][1])/2)
                cur += q(p0, off, e); p0 = e
        elif op == 'curveTo':
            cur += c(cur[-1], *args)
        elif op in ('closePath', 'endPath'):
            if len(cur) > 2: contours.append(cur)
            cur = []
    return contours

def outline(glyphset, name):
    rec = DecomposingRecordingPen(glyphset)
    glyphset[name].draw(rec)
    contours = flatten(rec.value)
    # resolve nonzero overlaps with skia
    path = pathops.Path()
    pen = path.getPen()
    for cnt in contours:
        pen.moveTo(cnt[0])
        for p in cnt[1:]: pen.lineTo(p)
        pen.closePath()
    path.simplify(fix_winding=True)
    polys = []
    for cnt in path.contours:
        pts = []
        for verb, p in cnt.segments:
            if p: pts.append(p[-1])
        if len(pts) > 2: polys.append(pts)
    return polys

# Mochiy Pop One's ink coverage (area / em²) by outline perimeter (in ems) of
# the same character in IPAmj Mincho, measured on 400 characters both have
INK_BY_PERIMETER = [(4.5, 0.425), (8.2, 0.495), (9.6, 0.541), (10.35, 0.568), (10.85, 0.574),
                    (11.4, 0.586), (11.95, 0.594), (12.6, 0.595), (13.4, 0.612), (15.5, 0.615)]


def target_ink(perimeter):
    pts = INK_BY_PERIMETER
    if perimeter <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if perimeter <= x1:
            return y0 + (y1 - y0) * (perimeter - x0) / (x1 - x0)
    return pts[-1][1]


def embolden(glyphset, name, upm, center, scale=0.92, max_amount=0.075):
    """Returns a TrueType glyph: the outline grown until its ink matches
    Mochiy Pop One's for a glyph this complex, then scaled about `center`."""
    base = shape(glyphset, name)
    if base.is_empty:
        return TTGlyphPen(None).glyph()
    want = target_ink(base.length / upm) * upm * upm / (scale * scale)
    lo, hi = 0.0, max_amount * upm
    for _ in range(9):
        mid = (lo + hi) / 2
        if base.buffer(mid, join_style=1, quad_segs=4).area < want:
            lo = mid
        else:
            hi = mid
    geom = base.buffer(lo, join_style=1, quad_segs=4).simplify(upm / 700)
    cx, cy = center
    tt = TTGlyphPen(None)
    def ring(coords, ccw):
        pts = list(coords)[:-1]
        from shapely.geometry import LinearRing
        if LinearRing(pts).is_ccw != ccw: pts.reverse()
        pts = [(round(cx+(x-cx)*scale), round(cy+(y-cy)*scale)) for x, y in pts]
        tt.moveTo(pts[0])
        for p in pts[1:]: tt.lineTo(p)
        tt.closePath()
    geoms = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    for g in geoms:
        if g.is_empty: continue
        ring(g.exterior.coords, False)   # TrueType: outer clockwise
        for i in g.interiors: ring(i.coords, True)
    return tt.glyph()

def shape(glyphset, name):
    polys = outline(glyphset, name)
    shapes = sorted([Polygon(p).buffer(0) for p in polys], key=lambda s: -s.area)
    geom = Polygon()
    for s in shapes:
        depth = sum(1 for o in shapes if o is not s and o.area > s.area and o.contains(s.representative_point()))
        geom = geom.difference(s) if depth % 2 else geom.union(s)
    return geom
