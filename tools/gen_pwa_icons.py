import os
import struct
import zlib


def make_png(path, size):
    # 背景圆角方块 + 白色爪印（主掌 + 3 趾）
    bg = (79, 70, 229)      # indigo #4F46E5
    fg = (255, 255, 255)
    px = [[bg for _ in range(size)] for _ in range(size)]
    radius = int(size * 0.22)

    def inside_round(x, y):
        # 圆角矩形
        r = radius
        w, h = size, size
        if r <= 0 or (r <= x < w - r) or (r <= y < h - r):
            return True
        cx = r if x < r else w - 1 - r
        cy = r if y < r else h - 1 - r
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

    def fill_circle(cx, cy, rad, color):
        r2 = rad * rad
        for y in range(int(cy - rad), int(cy + rad) + 1):
            for x in range(int(cx - rad), int(cx + rad) + 1):
                if 0 <= x < size and 0 <= y < size and (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                    if inside_round(x, y):
                        px[y][x] = color

    s = size
    pad = s * 0.52
    toes = [(0.34, 0.30), (0.66, 0.30), (0.50, 0.22)]
    fill_circle(s * 0.5, s * 0.55, pad, fg)
    for tx, ty in toes:
        fill_circle(s * tx, s * ty, s * 0.135, fg)

    # PNG 编码
    raw = b""
    for y in range(size):
        raw += b"\x00" + b"".join(bytes(px[y][x]) for x in range(size))
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, size)

svg = """<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect x="0" y="0" width="512" height="512" rx="113" fill="#4F46E5"/>
<circle cx="256" cy="282" r="133" fill="#FFFFFF"/>
<circle cx="174" cy="154" r="69" fill="#FFFFFF"/>
<circle cx="338" cy="154" r="69" fill="#FFFFFF"/>
<circle cx="256" cy="113" r="69" fill="#FFFFFF"/>
</svg>"""

outdir = r"D:\StudyPet\public"
os.makedirs(outdir, exist_ok=True)
make_png(os.path.join(outdir, "pwa-192.png"), 192)
make_png(os.path.join(outdir, "pwa-512.png"), 512)
with open(os.path.join(outdir, "pwa-icon.svg"), "w", encoding="utf-8") as f:
    f.write(svg)
print("wrote svg")