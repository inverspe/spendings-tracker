"""Regenerate the app icons and iPhone launch screens. Python 3, no packages.

    python tools/make_images.py

Writes icons/*.png and icons/icon.svg, one launch screen per iPhone size in
light and dark under icons/splash/, and refreshes the <link> tags between the
"splash:start" and "splash:end" comments in index.html.

The mark is the app's cash jar: an open mason jar outline with a stack of bills
filling its lower half, pale mint on note green. Shapes are signed-distance
rounded boxes, so edges are anti-aliased without a graphics library.
"""
import math, os, re, struct, sys, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'icons')
SPLASH = os.path.join(ICONS, 'splash')

BG = (0x17, 0x69, 0x4A)
GLASS = (0xE3, 0xF2, 0xE9)
CASH = (0x8F, 0xD9, 0xB2)
PAPER = {'light': (0xF1, 0xF4, 0xEF), 'dark': (0x0E, 0x15, 0x11)}  # the app's page colours

# Geometry as fractions of the icon size: (centre x, centre y, half width, half height, corner radius)
BODY = (0.5, 0.585, 0.215, 0.225, 0.085)
RIM = (0.5, 0.29, 0.14, 0.05, 0.03)
STROKE = 0.036
CASH_TOP = 0.55             # top of the bill stack
BILL_GAPS = (0.635, 0.715)  # thin background lines between stacked bills
GAP = 0.016

# iPhone screens in CSS pixels, with pixel ratio. A launch screen only shows
# when its media query matches the device exactly.
IPHONES = [
    (320, 568, 2),   # SE (1st generation)
    (375, 667, 2),   # 8, SE (2nd and 3rd generation)
    (414, 736, 3),   # 8 Plus
    (375, 812, 3),   # X, XS, 11 Pro, 12 mini, 13 mini
    (414, 896, 2),   # XR, 11
    (414, 896, 3),   # XS Max, 11 Pro Max
    (390, 844, 3),   # 12, 12 Pro, 13, 13 Pro, 14
    (428, 926, 3),   # 12 Pro Max, 13 Pro Max, 14 Plus
    (393, 852, 3),   # 14 Pro, 15, 15 Pro, 16
    (430, 932, 3),   # 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
    (402, 874, 3),   # 16 Pro
    (440, 956, 3),   # 16 Pro Max
]


def box(px, py, spec, size):
    cx, cy, hw, hh, r = (v * size for v in spec)
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def cover(d):
    """Coverage of a pixel whose centre is d units outside a shape."""
    return min(1.0, max(0.0, 0.5 - d))


def render(size, corner_f=None):
    """The icon as RGBA bytes; corner_f rounds the corners (transparent outside)."""
    out = bytearray(size * size * 4)
    sw = STROKE * size
    inner = sw / 2 + 0.03 * size  # gap between glass and cash
    for y in range(size):
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            alpha = 1.0
            if corner_f:
                alpha = cover(box(px, py, (0.5, 0.5, 0.5, 0.5, corner_f), size))
                if alpha == 0.0:
                    continue
            color = list(BG)
            d_body = box(px, py, BODY, size)
            cash = cover(d_body + inner) * cover(CASH_TOP * size - py)
            for g in BILL_GAPS:
                cash *= 1 - cover(abs(py - g * size) - GAP * size / 2)
            glass = max(cover(abs(d_body) - sw / 2), cover(box(px, py, RIM, size)))
            for layer, amount in ((CASH, cash), (GLASS, glass)):
                for i in range(3):
                    color[i] += (layer[i] - color[i]) * amount
            i = (y * size + x) * 4
            out[i:i + 4] = bytes((round(color[0]), round(color[1]), round(color[2]), round(alpha * 255)))
    return out


def png_bytes(width, height, rows, color_type):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    raw = b''.join(b'\x00' + row for row in rows)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, color_type, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def write_icon_png(path, size, rgba):
    stride = size * 4
    data = png_bytes(size, size, [bytes(rgba[y * stride:(y + 1) * stride]) for y in range(size)], 6)
    with open(path, 'wb') as f:
        f.write(data)


def write_splash_png(path, width, height, paper, icon_rgba, s):
    """A plain page-coloured screen with the app icon just above the centre."""
    bg = bytes(paper)
    x0 = (width - s) // 2
    y0 = round(height * 0.44 - s / 2)
    left, right = bg * x0, bg * (width - x0 - s)
    icon_rows = []
    for iy in range(s):
        mid = bytearray()
        for ix in range(s):
            r, g, b, a = icon_rgba[(iy * s + ix) * 4:(iy * s + ix) * 4 + 4]
            if a == 255:
                mid += bytes((r, g, b))
            elif a == 0:
                mid += bg
            else:
                mid += bytes(round(c * a / 255 + p * (1 - a / 255)) for c, p in zip((r, g, b), paper))
        icon_rows.append(left + bytes(mid) + right)
    solid = bg * width
    rows = [icon_rows[y - y0] if y0 <= y < y0 + s else solid for y in range(height)]
    with open(path, 'wb') as f:
        f.write(png_bytes(width, height, rows, 2))


def svg_markup(size=64, corner=14):
    def rect(spec, **attrs):
        cx, cy, hw, hh, r = (v * size for v in spec)
        extra = ' '.join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
        return f'<rect x="{cx - hw:.2f}" y="{cy - hh:.2f}" width="{2 * hw:.2f}" height="{2 * hh:.2f}" rx="{r:.2f}" {extra}/>'

    cx, cy, hw, hh, r = BODY
    inset = STROKE / 2 + 0.03
    cash_spec = (cx, (CASH_TOP + cy + hh - inset) / 2, hw - inset, (cy + hh - inset - CASH_TOP) / 2, max(r - inset, 0.01))
    gaps = ''.join(
        f'<rect x="0" y="{(g - GAP / 2) * size:.2f}" width="{size}" height="{GAP * size:.2f}" fill="#17694a"/>' for g in BILL_GAPS)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">
  <rect width="{size}" height="{size}" rx="{corner}" fill="#17694a"/>
  {rect(cash_spec, fill="#8fd9b2")}
  {gaps}
  {rect(BODY, fill="none", stroke="#e3f2e9", stroke_width=f"{STROKE * size:.2f}")}
  {rect(RIM, fill="#e3f2e9")}
</svg>
'''


def make_icons():
    os.makedirs(ICONS, exist_ok=True)
    # "any" icons: rounded square, used by desktop installs and the browser tab.
    write_icon_png(os.path.join(ICONS, 'icon-192.png'), 192, render(192, corner_f=0.22))
    write_icon_png(os.path.join(ICONS, 'icon-512.png'), 512, render(512, corner_f=0.22))
    # Maskable + Apple: full-bleed square; the OS applies its own mask.
    write_icon_png(os.path.join(ICONS, 'icon-maskable-512.png'), 512, render(512))
    write_icon_png(os.path.join(ICONS, 'apple-touch-icon.png'), 180, render(180))
    with open(os.path.join(ICONS, 'icon.svg'), 'w', newline='\n') as f:
        f.write(svg_markup())


def make_splash():
    os.makedirs(SPLASH, exist_ok=True)
    tags = []
    for w, h, ratio in IPHONES:
        pw, ph = w * ratio, h * ratio
        s = round(pw * 0.22 / 2) * 2
        icon = render(s, corner_f=0.22)
        device = f'(device-width: {w}px) and (device-height: {h}px) and (-webkit-device-pixel-ratio: {ratio}) and (orientation: portrait)'
        for scheme in ('light', 'dark'):
            name = f'splash-{pw}x{ph}-{scheme}.png'
            write_splash_png(os.path.join(SPLASH, name), pw, ph, PAPER[scheme], icon, s)
            tags.append(f'<link rel="apple-touch-startup-image" media="(prefers-color-scheme: {scheme}) and {device}" href="icons/splash/{name}">')
    return tags


def patch_index(tags):
    path = os.path.join(ROOT, 'index.html')
    with open(path, encoding='utf-8', newline='') as f:
        html = f.read()
    nl = '\r\n' if '\r\n' in html else '\n'
    block = nl.join(['<!-- splash:start -->', *tags, '<!-- splash:end -->'])
    html, count = re.subn(r'<!-- splash:start -->.*?<!-- splash:end -->', lambda _: block, html, flags=re.S)
    if count != 1:
        sys.exit('index.html needs exactly one splash:start / splash:end pair')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(html)


if __name__ == '__main__':
    make_icons()
    patch_index(make_splash())
    print(f'wrote icons, {len(IPHONES) * 2} launch screens, and updated index.html')
