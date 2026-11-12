"""Build a UV-matched, geometry-derived face refine proxy.

The original SdfRefineTex and TrickTex are absent from both Blender scenes.
This asset only derives coverage and edge regions from the source Face UVs; it
does not claim to recreate the original hand-painted values.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UV_LAYOUT = ROOT.parent / "庄方宜" / "render_export" / "_work" / "source_uv_layouts_no_futa.json"
OUTPUT = ROOT / "public" / "textures" / "T_actor_zhuangfy_face_01_Refine_Proxy.png"
PREVIEW = ROOT / "tools" / "face_refine_proxy_preview.png"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uv-layout", type=Path, default=DEFAULT_UV_LAYOUT)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()

    layout = json.loads(args.uv_layout.read_text(encoding="utf-8-sig"))
    face = layout.get("Face")
    if not face or not face.get("polygons"):
        raise ValueError(f"No Face UV polygons in {args.uv_layout}")

    size = args.size
    scale = 4
    hi = size * scale
    coverage_hi = Image.new("L", (hi, hi), 0)
    draw = ImageDraw.Draw(coverage_hi)
    for polygon in face["polygons"]:
        points = [
            (round(float(u) * (hi - 1)), round((1.0 - float(v)) * (hi - 1)))
            for u, v in polygon
        ]
        if len(points) >= 3:
            draw.polygon(points, fill=255)

    coverage = coverage_hi.resize((size, size), Image.Resampling.LANCZOS)
    # A is a softly antialiased edge band from the actual Face mesh UV islands.
    eroded = coverage.filter(ImageFilter.MinFilter(25))
    edge = ImageChops.subtract(coverage, eroded).filter(ImageFilter.GaussianBlur(1.4))

    rgba = Image.merge("RGBA", (coverage, Image.new("L", (size, size), 0), coverage, edge))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    rgba.save(OUTPUT, optimize=True)

    # Show R/G/B/A as four labeled grayscale tiles for channel inspection.
    tile = 320
    preview = Image.new("RGB", (tile * 2, tile * 2 + 40), (26, 28, 34))
    labels = ("R  SSS coverage", "G  normal refinement (neutral)", "B  shadow area", "A  UV edge rim")
    for i, (channel, label) in enumerate(zip(rgba.split(), labels)):
        x, y = (i % 2) * tile, (i // 2) * tile + 20
        enlarged = channel.resize((tile, tile), Image.Resampling.NEAREST)
        preview.paste(Image.merge("RGB", (enlarged, enlarged, enlarged)), (x, y))
        ImageDraw.Draw(preview).text((x + 6, y - 16), label, fill=(230, 232, 238))
    preview.save(PREVIEW)
    print(f"Wrote {OUTPUT} ({size}x{size} RGBA)")
    print(f"Wrote {PREVIEW}")


if __name__ == "__main__":
    main()
