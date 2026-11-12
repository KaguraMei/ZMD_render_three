"""Print GLB node/primitive metadata relevant to the eye geometry."""
from __future__ import annotations

import json
import struct
from pathlib import Path

GLB = Path(__file__).resolve().parents[1] / "public" / "models" / "ZhuangFangyi_render_tangent.glb"


def read_json(path: Path) -> dict:
    data = path.read_bytes()
    offset = 12
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8:offset + 8 + length]
        if kind == 0x4E4F534A:
            return json.loads(chunk.decode("utf-8"))
        offset += 8 + length
    raise ValueError("GLB JSON chunk not found")


def main() -> None:
    gltf = read_json(GLB)
    materials = gltf.get("materials", [])
    accessors = gltf.get("accessors", [])
    print(f"GLB: {GLB}")
    for node in gltf.get("nodes", []):
        if "eye" not in node.get("name", "").lower():
            continue
        print("NODE", node.get("name"), "mesh", node.get("mesh"), "children", node.get("children", []))
        mesh_index = node.get("mesh")
        if mesh_index is None:
            continue
        for primitive in gltf["meshes"][mesh_index].get("primitives", []):
            material_index = primitive.get("material")
            attrs = primitive.get("attributes", {})
            print(
                "  PRIMITIVE",
                materials[material_index].get("name") if material_index is not None else None,
                "vertices", accessors[attrs["POSITION"]].get("count") if "POSITION" in attrs else None,
                "indices", accessors[primitive["indices"]].get("count") if "indices" in primitive else None,
                "position bounds", accessors[attrs["POSITION"]].get("min") if "POSITION" in attrs else None,
                accessors[attrs["POSITION"]].get("max") if "POSITION" in attrs else None,
                "attrs", sorted(attrs),
            )


if __name__ == "__main__":
    main()
