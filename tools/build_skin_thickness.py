"""Rasterize Blender ray-cast thickness samples into the source Body UV map."""
from __future__ import annotations

import argparse
import json
from array import array
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT.parent / "庄方宜" / "render_export" / "_work" / "body_skin_thickness_triangles.json"
OUTPUT = ROOT / "public" / "textures" / "T_actor_zhuangfy_body_01_Thickness_Proxy.png"
PREVIEW = ROOT / "tools" / "skin_thickness_preview.png"


def rasterize_triangles(triangles: list[list[list[float]]], size: int) -> tuple[Image.Image, Image.Image]:
    total = array("f", [0.0]) * (size * size)
    count = array("H", [0]) * (size * size)
    coverage = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(coverage)

    for triangle in triangles:
        points = [
            (float(u) * (size - 1), (1.0 - float(v)) * (size - 1), float(t))
            for u, v, t in triangle
        ]
        (x0, y0, t0), (x1, y1, t1), (x2, y2, t2) = points
        draw.polygon([(round(x0), round(y0)), (round(x1), round(y1)), (round(x2), round(y2))], fill=255)
        denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denom) < 1e-8:
            continue
        min_x = max(0, int(min(x0, x1, x2)))
        max_x = min(size - 1, int(max(x0, x1, x2)) + 1)
        min_y = max(0, int(min(y0, y1, y2)))
        max_y = min(size - 1, int(max(y0, y1, y2)) + 1)
        for y in range(min_y, max_y + 1):
            py = y + 0.5
            for x in range(min_x, max_x + 1):
                px = x + 0.5
                w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom
                w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom
                w2 = 1.0 - w0 - w1
                if min(w0, w1, w2) >= -1e-5:
                    index = y * size + x
                    total[index] += max(0.0, min(1.0, w0 * t0 + w1 * t1 + w2 * t2))
                    count[index] += 1

    pixels = bytearray(size * size)
    sums = total
    for i, n in enumerate(count):
        if n:
            pixels[i] = round(max(0.0, min(1.0, sums[i] / n)) * 255)
    # This is a low-confidence geometry estimate (most vertices use fallback
    # thickness), so soften sparse ray hits before using them as a shader weight.
    depth = Image.frombytes("L", (size, size), bytes(pixels)).filter(ImageFilter.GaussianBlur(2.0))
    coverage = coverage.filter(ImageFilter.GaussianBlur(0.55))
    return depth, coverage


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()

    data = json.loads(args.data.read_text(encoding="utf-8-sig"))
    depth, coverage = rasterize_triangles(data["triangles"], args.size)
    image = Image.merge("RGBA", (depth, depth, depth, coverage))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, optimize=True)

    preview = Image.new("RGB", (args.size, args.size + 36), (26, 28, 34))
    preview.paste(depth.convert("RGB"), (0, 36), coverage)
    ImageDraw.Draw(preview).text(
        (8, 10),
        f"Body thickness proxy  ·  ray hit {data['ray_hit_ratio']:.1%}  ·  max {data['max_thickness']:.3f} source units",
        fill=(230, 232, 238),
    )
    preview.save(PREVIEW)
    print(f"Wrote {OUTPUT} ({args.size}x{args.size} RGBA)")
    print(f"Ray hit ratio: {data['ray_hit_ratio']:.1%}; UV triangles: {len(data['triangles'])}")


if __name__ == "__main__":
    main()
