"""Glyph and geometry helpers for kit.py, plus the three original concepts (black first).

A  Orbit T     the capital T with the Orbit 21 ring: behind the top, in front of the bottom
B  Tachyon     a core with a ring that tapers into a trail behind a leading particle
C  Orbit t     lowercase t whose crossbar is the front arc of the orbit
"""
import math, os, sys
from fontTools.ttLib import TTCollection
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import unary_union
from shapely.affinity import rotate, translate

OUT = os.path.dirname(os.path.abspath(__file__))
V = sys.argv[1] if len(sys.argv) > 1 else 'v1'
coll = TTCollection('/System/Library/Fonts/Supplemental/Futura.ttc')
BOLD = coll.fonts[2]


class FlatPen(BasePen):
    def __init__(s, gs, sc, ox, oy):
        super().__init__(gs); s.sc, s.ox, s.oy = sc, ox, oy; s.cs = []; s.c = []
    def T(s, p): return (s.ox + p[0] * s.sc, s.oy - p[1] * s.sc)
    def _moveTo(s, p): s.c = [s.T(p)]
    def _lineTo(s, p): s.c.append(s.T(p))
    def _qCurveToOne(s, c1, p):
        p0 = s.c[-1]; c1 = s.T(c1); p = s.T(p)
        for i in range(1, 13):
            t = i / 12
            s.c.append(((1-t)**2*p0[0] + 2*(1-t)*t*c1[0] + t*t*p[0], (1-t)**2*p0[1] + 2*(1-t)*t*c1[1] + t*t*p[1]))
    def _curveToOne(s, c1, c2, p):
        p0 = s.c[-1]; c1, c2, p = s.T(c1), s.T(c2), s.T(p)
        for i in range(1, 17):
            t = i / 16
            s.c.append(((1-t)**3*p0[0] + 3*(1-t)**2*t*c1[0] + 3*(1-t)*t*t*c2[0] + t**3*p[0],
                        (1-t)**3*p0[1] + 3*(1-t)**2*t*c1[1] + 3*(1-t)*t*t*c2[1] + t**3*p[1]))
    def _closePath(s):
        if len(s.c) > 2: s.cs.append(s.c)
        s.c = []


def text_geom(text, size, x, baseline, tracking=0, anchor='start', font=BOLD):
    upm = font['head'].unitsPerEm; sc = size / upm; cmap = font.getBestCmap(); gs = font.getGlyphSet()
    width = sum(gs[cmap[ord(ch)]].width * sc + tracking for ch in text) - tracking
    pen_x = x - width / 2 if anchor == 'middle' else x
    polys = []
    for ch in text:
        g = gs[cmap[ord(ch)]]; pen = FlatPen(gs, sc, pen_x, baseline); g.draw(pen)
        shape = None
        for c in sorted(pen.cs, key=lambda c: -abs(Polygon(c).area)):
            P = Polygon(c).buffer(0); shape = P if shape is None else shape.symmetric_difference(P)
        if shape: polys.append(shape)
        pen_x += g.width * sc + tracking
    return unary_union(polys), width


def ellipse(cx, cy, rx, ry, a0=0, a1=360, n=240):
    return LineString([(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
                        cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)])


def path_d(g):
    polys = list(g.geoms) if hasattr(g, 'geoms') else [g]; d = ''
    for p in polys:
        if p.is_empty: continue
        for ring in [p.exterior] + list(p.interiors):
            pts = list(ring.coords); d += 'M' + ' '.join('%.2f %.2f' % (x, y) for x, y in pts[:-1]) + 'Z'
    return d


def svg(parts, title, vb='0 0 256 256'):
    body = ''.join('<path fill-rule="evenodd" d="%s" fill="%s"/>' % (path_d(g.simplify(0.12)), c) for g, c in parts)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s"><title>%s</title>%s</svg>' % (vb, title, body)


def center(geoms, cx=128, cy=128):
    """Translate all geoms together so their union's bbox is centred (optically 2px high)."""
    u = unary_union(geoms); x0, y0, x1, y1 = u.bounds
    dx, dy = cx - (x0 + x1) / 2, cy - 2 - (y0 + y1) / 2
    return [translate(g, dx, dy) for g in geoms]


TILT = -8
KNOCK = 6
W = 14


def orbit(cx, cy, rx, ry, w=W):
    full = rotate(ellipse(cx, cy, rx, ry).buffer(w / 2, quad_segs=8), TILT, origin=(cx, cy))
    front = rotate(ellipse(cx, cy, rx, ry, 0, 180).buffer(w / 2, quad_segs=8), TILT, origin=(cx, cy))
    return full, front


def weave(glyph, full, front):
    """Ring behind the glyph's top, in front of its bottom, with knockout gaps."""
    ring = full.difference(glyph.buffer(KNOCK, join_style=2)).union(front)
    glyph = glyph.difference(front.buffer(KNOCK))
    return ring, glyph


# A: Orbit T
def concept_a():
    T, _ = text_geom('T', 176, 128, 196, anchor='middle')
    full, front = orbit(128, 136, 116, 30)
    return center(list(weave(T, full, front)))


# B: Tachyon. Core sphere, ring tapering into a trail behind a leading particle.
def concept_b():
    cx, cy, rx, ry = 128, 132, 114, 34
    core = Point(cx, cy).buffer(46, quad_segs=32)
    head = 62  # the particle crosses the front of the core, lower right
    span = 235
    left, right = [], []
    n = 300
    for i in range(n + 1):
        a = math.radians(head - span * i / n)
        w = 14 * (1 - i / n) ** 1.1 + 0.5
        x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
        nx, ny = math.cos(a) / rx, math.sin(a) / ry; L = math.hypot(nx, ny); nx, ny = nx / L, ny / L
        left.append((x + nx * w / 2, y + ny * w / 2)); right.append((x - nx * w / 2, y - ny * w / 2))
    trail = Polygon(left + right[::-1]).buffer(0)
    hx, hy = cx + rx * math.cos(math.radians(head)), cy + ry * math.sin(math.radians(head))
    particle = Point(hx, hy).buffer(13, quad_segs=24)
    ring = unary_union([trail, particle])
    ring = rotate(ring, TILT, origin=(cx, cy))
    # Front half passes over the core; back half goes behind it.
    front_zone = rotate(box(0, cy, 256, 256), TILT, origin=(cx, cy))
    ring_front = ring.intersection(front_zone)
    ring_back = ring.difference(front_zone).difference(core.buffer(KNOCK))
    core = core.difference(ring_front.buffer(KNOCK))
    return center([unary_union([ring_back, ring_front]), core])


# C: Orbit t. The crossbar is the orbit's front arc.
def concept_c():
    t, _ = text_geom('t', 210, 128, 206, anchor='middle')
    x0, y0, x1, y1 = t.bounds
    # Keep the stem only: the narrowest vertical band of the glyph below the crossbar.
    probe = t.intersection(box(0, y1 - 20, 256, y1 - 18)).bounds
    stem = t.intersection(box(probe[0], 0, probe[2], 256))
    bar_y = t.intersection(box(x0, 0, probe[0] - 1, 256)).centroid.y
    full, front = orbit((probe[0] + probe[2]) / 2, bar_y, 78, 19, w=16)
    return center(list(weave(stem, full, front)))


def lockup(sym_geoms, name):
    """Symbol at left, 'tachyons' in Futura Bold at right; height 256."""
    word, ww = text_geom('tachyons', 96, 0, 0, tracking=-2)
    sx0, sy0, sx1, sy1 = unary_union(sym_geoms).bounds
    s = 200 / (sy1 - sy0)
    from shapely.affinity import scale
    sym = [scale(g, s, s, origin=(sx0, sy0)) for g in sym_geoms]
    sym = [translate(g, 28 - sx0, 28 - sy0) for g in sym]
    wx0, wy0, wx1, wy1 = word.bounds
    sb = unary_union(sym).bounds
    word = translate(word, sb[2] + 36 - wx0, 128 - (wy0 + wy1) / 2)
    width = word.bounds[2] + 28
    return sym, word, '0 0 %.0f 256' % width


if __name__ == '__main__':
    for key, fn in (('a', concept_a), ('b', concept_b), ('c', concept_c)):
        g = fn()
        open(f'{OUT}/concept-{key}-{V}.svg', 'w').write(svg([(x, '#000') for x in g], f'tachyons concept {key.upper()}'))
        sym, word, vb = lockup(g, key)
        open(f'{OUT}/concept-{key}-lockup-{V}.svg', 'w').write(
            svg([(x, '#000') for x in sym] + [(word, '#000')], f'tachyons concept {key.upper()} lockup', vb))
        print('wrote', key)
