"""Generate PWA icons into ./icons/ — run: python generate-icons.py"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), 'icons')
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]


def write_png(path, size):
    def rgb(x, y, s):
        cx, cy = s / 2, s / 2
        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
        if d < s * 0.32:
            return (0, 255, 157)
        if d < s * 0.38:
            return (0, 200, 125)
        if d < s * 0.42:
            return (20, 30, 40)
        return (5, 6, 8)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    rows = []
    for y in range(size):
        row = b'\x00'
        for x in range(size):
            row += bytes(rgb(x, y, size))
        rows.append(row)
    raw = b''.join(rows)
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    data = chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    os.makedirs(OUT, exist_ok=True)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + data)


if __name__ == '__main__':
    for sz in SIZES:
        write_png(os.path.join(OUT, f'icon-{sz}.png'), sz)
    print('Generated icons in', OUT)
