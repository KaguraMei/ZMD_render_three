"""Paint a subtle cheek-blush TrickTex proxy in the source Face UV layout."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
UV_COVERAGE = ROOT / "public" / "textures" / "T_actor_zhuangfy_face_01_Refine_Proxy.png"
FACE_ALBEDO = ROOT / "public" / "textures" / "T_actor_zhuangfy_face_01_D.png"
OUTPUT = ROOT / "public" / "textures" / "T_actor_zhuangfy_face_01_Trick_Proxy.png"
PREVIEW = ROOT / "tools" / "face_trick_proxy_preview.png"


def cheek_alpha(center_x: float, center_y: float, rx: float, ry: float) -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(mask)
    px = center_x * SIZE
    py = center_y * SIZE
    draw.ellipse((px - rx * SIZE, py - ry * SIZE, px + rx * SIZE, py + ry * SIZE), fill=180)
    return mask.filter(ImageFilter.GaussianBlur(radius=rx * SIZE * 0.42))


def main() -> None:
    # The Face UV albedo places the eyes at y≈0.42, nose at y≈0.54,
    # and mouth at y≈0.63 in image coordinates. Keep blush below the eyes.
    alpha = ImageChops.lighter(
        cheek_alpha(0.305, 0.535, 0.055, 0.026),
        cheek_alpha(0.695, 0.535, 0.055, 0.026),
    )
    alpha = ImageChops.lighter(alpha, cheek_alpha(0.5, 0.55, 0.019, 0.014).point(lambda v: round(v * 0.25)))

    coverage = Image.open(UV_COVERAGE).convert("RGBA").getchannel("R")
    alpha = ImageChops.multiply(alpha, coverage)
    tint = Image.new("RGB", (SIZE, SIZE), (226, 107, 127))
    trick = Image.merge("RGBA", (*tint.split(), alpha))
    trick.save(OUTPUT, optimize=True)

    base = Image.open(FACE_ALBEDO).convert("RGBA")
    composite = Image.alpha_composite(base, trick)
    composite.save(PREVIEW, optimize=True)
    print(f"Wrote {OUTPUT} ({SIZE}x{SIZE} RGBA)")
    print(f"Wrote {PREVIEW}")


if __name__ == "__main__":
    main()
