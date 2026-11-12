"""Build the hand-authored character toon RGBA ramp from editable palette stops."""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PALETTE_PATH = ROOT / "tools" / "character_ramp_palette.json"
OUTPUT_PATH = ROOT / "public" / "textures" / "toon_character_ramp.png"


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def sample(stops: list[dict], x: float) -> tuple[int, int, int, int]:
    if x <= stops[0]["x"]:
        return tuple(stops[0]["rgba"])
    for left, right in zip(stops, stops[1:]):
        if x <= right["x"]:
            span = right["x"] - left["x"]
            weight = smoothstep((x - left["x"]) / span) if span else 1.0
            return tuple(
                round(a + (b - a) * weight)
                for a, b in zip(left["rgba"], right["rgba"])
            )
    return tuple(stops[-1]["rgba"])


def main() -> None:
    spec = json.loads(PALETTE_PATH.read_text(encoding="utf-8-sig"))
    width, height = int(spec["width"]), int(spec["height"])
    rows = spec["rows"]
    if len(rows) != height:
        raise ValueError(f"Expected {height} ramp rows, found {len(rows)}")

    image = Image.new("RGBA", (width, height))
    for y, row in enumerate(rows):
        stops = row["stops"]
        if stops[0]["x"] != 0 or stops[-1]["x"] != 1:
            raise ValueError(f"{row['name']} stops must span x=0..1")
        for x in range(width):
            image.putpixel((x, y), sample(stops, x / (width - 1)))

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUTPUT_PATH, optimize=False)
    print(f"Wrote {OUTPUT_PATH} ({width}x{height} RGBA)")


if __name__ == "__main__":
    main()
