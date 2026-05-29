"""Generate LIFE_OS PWA icons from assets/life-os-logo.png."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "life-os-logo.png"
OUT = ROOT / "icons"
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
FAVICON_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main():
    OUT.mkdir(exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")

    for size in SIZES:
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(OUT / f"icon-{size}.png", "PNG")

    image.save(ROOT / "favicon.ico", sizes=FAVICON_SIZES)
    print(f"Generated LIFE_OS icons from {SOURCE}")


if __name__ == "__main__":
    main()
