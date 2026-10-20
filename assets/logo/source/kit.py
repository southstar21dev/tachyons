"""tachyons logo kit: concept B (Tachyon), in the southstar21 palette.

A core with an orbit that tapers into a trail behind a leading particle. The particle
crosses in front of the core; the trail passes behind it and fades out.
Writes every file into assets/logo/. Needs shapely + fonttools and macOS Futura.
"""
import math, os
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union
from shapely.affinity import rotate, translate, scale

from concepts import text_geom, path_d

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
os.makedirs(OUT, exist_ok=True)

DARK, CREAM, RING, TAN = '#1F1A17', '#F5ECD7', '#E6D8B8', '#A8946A'
TILT = -8


def tachyon(core_r=46, rx=114, ry=34, head=62, span=235, w_max=14, w_min=1.6, power=1.1,
            particle_r=13, knock=6, cx=128, cy=128):
    """Returns (ring, core) as shapely geometries."""
    core = Point(cx, cy).buffer(core_r, quad_segs=48)
    left, right, n = [], [], 360
    for i in range(n + 1):
        a = math.radians(head - span * i / n)
        w = (w_max - w_min) * (1 - i / n) ** power + w_min
        x, y = cx + rx * math.cos(a), cy + ry * math.sin(a)
        nx, ny = math.cos(a) / rx, math.sin(a) / ry
        L = math.hypot(nx, ny); nx, ny = nx / L, ny / L
        left.append((x + nx * w / 2, y + ny * w / 2)); right.append((x - nx * w / 2, y - ny * w / 2))
    trail = Polygon(left + right[::-1]).buffer(0)
    # Round the trail's tail so it ends in a point, not a cut.
    tail = left[-1][0] / 2 + right[-1][0] / 2, left[-1][1] / 2 + right[-1][1] / 2
    trail = trail.union(Point(tail).buffer(w_min / 2, quad_segs=8))
    hx, hy = cx + rx * math.cos(math.radians(head)), cy + ry * math.sin(math.radians(head))
    ring = unary_union([trail, Point(hx, hy).buffer(particle_r, quad_segs=32)])
    ring = rotate(ring, TILT, origin=(cx, cy))
    front = rotate(box(-50, cy, 306, 306), TILT, origin=(cx, cy))
    ring_front = ring.intersection(front)
    ring_back = ring.difference(front).difference(core.buffer(knock))
    core = core.difference(ring_front.buffer(knock))
    return unary_union([ring_back, ring_front]), core


def fit(geoms, size=256, margin=14, optical=2):
    """Scale and centre geoms together inside a size×size box (optically a touch high)."""
    x0, y0, x1, y1 = unary_union(geoms).bounds
    s = (size - 2 * margin) / max(x1 - x0, y1 - y0)
    out = [scale(g, s, s, origin=(x0, y0)) for g in geoms]
    x0, y0, x1, y1 = unary_union(out).bounds
    return [translate(g, size / 2 - (x0 + x1) / 2, size / 2 - optical - (y0 + y1) / 2) for g in out]


def svg(parts, title, vb, bg=None, radius=0):
    body = ''
    if bg:
        w, h = vb.split()[2:]
        body += '<rect width="%s" height="%s" rx="%s" fill="%s"/>' % (w, h, radius, bg)
    body += ''.join('<path fill-rule="evenodd" d="%s" fill="%s"/>' % (path_d(g.simplify(0.08)), c) for g, c in parts)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s"><title>%s</title>%s</svg>\n' % (vb, title, body)


def write(name, text):
    open(os.path.join(OUT, name), 'w').write(text)


MAIN = tachyon()
# Small-size cut for 16–48 px: heavier trail with a blunt tail, bigger particle, wider gaps.
SMALL = tachyon(core_r=48, span=200, w_max=22, w_min=9, power=0.9, particle_r=19, knock=10)

SCHEMES = {
    # name: (ring, core/word)
    'cream': (RING, CREAM),      # for dark backgrounds
    'darkroast': (TAN, DARK),    # for light backgrounds
    'black': ('#000', '#000'),
    'white': ('#fff', '#fff'),
}

sym = fit(list(MAIN))
small = fit(list(SMALL), margin=10)
for key, (ring_c, core_c) in SCHEMES.items():
    write(f'tachyons-symbol-{key}.svg', svg([(sym[0], ring_c), (sym[1], core_c)], f'tachyons symbol, {key}', '0 0 256 256'))
    write(f'tachyons-symbol-small-{key}.svg', svg([(small[0], ring_c), (small[1], core_c)], f'tachyons symbol, small cut, {key}', '0 0 256 256'))

# Tiles: app icon / avatar. Small cut is the favicon.
tile = fit(list(MAIN), margin=36)
write('tachyons-tile-darkroast.svg', svg([(tile[0], RING), (tile[1], CREAM)], 'tachyons tile', '0 0 256 256', DARK, 56))
write('tachyons-tile-cream.svg', svg([(tile[0], TAN), (tile[1], DARK)], 'tachyons tile, cream', '0 0 256 256', CREAM, 56))
fav = fit(list(SMALL), margin=22)
write('favicon.svg', svg([(fav[0], RING), (fav[1], CREAM)], 'tachyons favicon', '0 0 256 256', DARK, 56))


# Horizontal lockup: symbol, then "tachyons" in Futura Bold. Height 224, like southstar21's.
def lockup():
    word, _ = text_geom('tachyons', 132, 0, 0, tracking=-3)
    ring, core = MAIN
    x0, y0, x1, y1 = unary_union([ring, core]).bounds
    s = 132 / (y1 - y0)  # symbol height = word size
    ring, core = (translate(scale(g, s, s, origin=(x0, y0)), 24 - x0, 112 - (y1 - y0) / 2 - y0) for g in (ring, core))
    sx1 = unary_union([ring, core]).bounds[2]
    wx0, wy0, wx1, wy1 = word.bounds
    # Centre the word on the core's x-height band.
    word = translate(word, sx1 + 40 - wx0, 112 - (wy0 + wy1) / 2 + 6)
    return ring, core, word, '0 0 %.0f 224' % (word.bounds[2] + 24)


ring, core, word, vb = lockup()
for key, (ring_c, core_c) in SCHEMES.items():
    write(f'tachyons-horizontal-{key}.svg', svg([(ring, ring_c), (core, core_c), (word, core_c)], f'tachyons logo, {key}', vb))
w = float(vb.split()[2])

# Social preview for GitHub (1280x640): the lockup centred on dark roast.
s = 900 / w
parts = [(translate(scale(g, s, s, origin=(0, 0)), (1280 - 900) / 2, (640 - 224 * s) / 2 - 20), c)
         for g, c in ((ring, RING), (core, CREAM), (word, CREAM))]
tag, _ = text_geom('Claude Code plugins by southstar21', 34, 640, 470, anchor='middle', font=__import__('concepts').coll.fonts[0])
parts.append((tag, TAN))
write('social-preview.svg', svg(parts, 'tachyons social preview', '0 0 1280 640', DARK))
print('wrote', len(os.listdir(OUT)), 'files to', os.path.normpath(OUT))
