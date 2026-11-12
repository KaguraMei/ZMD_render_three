"""Build a static art-directed approximation LUT for the skin response shader."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PALETTE = ROOT / "tools" / "skin_lut_palette.json"
OUTPUT = ROOT / "public" / "textures" / "toon_skin_lut.png"
PREVIEW = ROOT / "tools" / "skin_lut_preview.png"


def smoothstep(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def main() -> None:
    spec = json.loads(PALETTE.read_text(encoding="utf-8-sig"))
    width = int(spec["width"])
    stops = spec["stops"]
    image = Image.new("RGBA", (width, 1))
    for x in range(width):
        u = x / (width - 1)
        for left, right in zip(stops, stops[1:]):
            if u <= right["x"]:
                t = smoothstep((u - left["x"]) / (right["x"] - left["x"]))
                color = [round(a + (b - a) * t) for a, b in zip(left["rgba"], right["rgba"])]
                image.putpixel((x, 0), tuple(color))
                break
        else:
            image.putpixel((x, 0), tuple(stops[-1]["rgba"]))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT, optimize=True)
    strip = image.resize((768, 120), Image.Resampling.NEAREST)
    preview = Image.new("RGB", (768, 150), (26, 28, 34))
    preview.paste(strip.convert("RGB"), (0, 20))
    ImageDraw.Draw(preview).text((8, 5), "Skin LUT  ·  shadow → light", fill=(230, 232, 238))
    preview.save(PREVIEW)
    print(f"Wrote {OUTPUT} ({width}x1 RGBA)")
    print(f"Wrote {PREVIEW}")


if __name__ == "__main__":
    main()
