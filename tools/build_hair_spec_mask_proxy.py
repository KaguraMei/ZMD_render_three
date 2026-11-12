"""Build a restrained hair highlight mask from the verified Hair UV and P map.

P.A is used as the smoothness response, then clipped to the exact Hair UV
coverage. The result is an editable proxy, not an original SpecularMask.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UV_LAYOUT = ROOT.parent / "庄方宜" / "render_export" / "_work" / "source_uv_layouts_no_futa.json"
PARAMS = ROOT / "public" / "textures" / "T_actor_zhuangfy_hair_01_P.png"
OUTPUT = ROOT / "public" / "textures" / "T_actor_zhuangfy_hair_01_SpecMask_Proxy.png"
PREVIEW = ROOT / "tools" / "hair_spec_mask_proxy_preview.png"


def smoothstep(value: float, low: float, high: float) -> float:
    t = min(1.0, max(0.0, (value - low) / max(high - low, 1e-6)))
    return t * t * (3.0 - 2.0 * t)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uv-layout", type=Path, default=DEFAULT_UV_LAYOUT)
    args = parser.parse_args()

    layout = json.loads(args.uv_layout.read_text(encoding="utf-8-sig"))
    hair = layout.get("Hair")
    if not hair or not hair.get("polygons"):
        raise ValueError(f"No Hair UV polygons in {args.uv_layout}")

    params = Image.open(PARAMS).convert("RGBA")
    width, height = params.size
    smoothness = params.getchannel("A")
    smoothness = smoothness.point(lambda v: round(smoothstep(v / 255.0, 0.18, 0.58) * 255))
    antialias = 2
    coverage_large = Image.new("L", (width * antialias, height * antialias), 0)
    draw = ImageDraw.Draw(coverage_large)
    for polygon in hair["polygons"]:
        points = [
            (round(float(u) * (width * antialias - 1)), round((1.0 - float(v)) * (height * antialias - 1)))
            for u, v in polygon
        ]
        if len(points) >= 3:
            draw.polygon(points, fill=255)
    coverage = coverage_large.resize((width, height), Image.Resampling.LANCZOS)
    mask = ImageChops.multiply(smoothness, coverage).filter(ImageFilter.GaussianBlur(0.45))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    rgba = Image.merge("RGBA", (mask, mask, mask, Image.new("L", (width, height), 255)))
    rgba.save(OUTPUT, optimize=True)

    # A source-channel and resulting-mask pair makes the derivation reviewable.
    thumb = (512, 512)
    source_preview = smoothness.resize(thumb, Image.Resampling.NEAREST)
    mask_preview = mask.resize(thumb, Image.Resampling.NEAREST)
    preview = Image.new("RGB", (thumb[0] * 2, thumb[1] + 28), (26, 28, 34))
    preview.paste(Image.merge("RGB", (source_preview,) * 3), (0, 28))
    preview.paste(Image.merge("RGB", (mask_preview,) * 3), (thumb[0], 28))
    labels = ImageDraw.Draw(preview)
    labels.text((8, 7), "P.A smoothness response", fill=(232, 234, 240))
    labels.text((thumb[0] + 8, 7), "Hair UV clipped spec proxy", fill=(232, 234, 240))
    preview.save(PREVIEW)
    print(f"Wrote {OUTPUT} ({width}x{height} RGBA)")
    print(f"Wrote {PREVIEW}; source P.A gated and clipped to Hair UV coverage")


if __name__ == "__main__":
    main()
