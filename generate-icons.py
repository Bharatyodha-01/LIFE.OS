"""Generate LIFE-OS PWA icons from assets/life-os-logo.png."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "assets" / "life-os-logo.png"
OUT = ROOT / "icons"
SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
FAVICON_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def fit_on_transparent_canvas(image, size):
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    fitted = image.copy()
    fitted.thumbnail((size, size), Image.Resampling.LANCZOS)
    x = (size - fitted.width) // 2
    y = (size - fitted.height) // 2
    canvas.alpha_composite(fitted, (x, y))
    return canvas


def main():
    OUT.mkdir(exist_ok=True)
    image = Image.open(SOURCE).convert("RGBA")

    for size in SIZES:
        resized = fit_on_transparent_canvas(image, size)
        resized.save(OUT / f"icon-{size}.png", "PNG")

    favicon = fit_on_transparent_canvas(image, 256)
    favicon.save(ROOT / "favicon.ico", sizes=FAVICON_SIZES)
    print(f"Generated LIFE-OS icons from {SOURCE}")


if __name__ == "__main__":
    main()
