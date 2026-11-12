"""Export source Body UV triangles with inward ray-cast thickness samples.

Run inside Blender: blender -b source.blend --python export_body_thickness.py -- --out FILE.json
This reads the blend file and writes only the requested JSON file.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


def arguments() -> dict[str, str]:
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    result = {}
    for i, arg in enumerate(tail[:-1]):
        if arg == "--out":
            result["out"] = tail[i + 1]
    return result


def main() -> None:
    out = arguments().get("out")
    if not out:
        raise SystemExit("Missing --out JSON_PATH")

    obj = bpy.data.objects.get("ZhuangFangyi_Body")
    if obj is None or obj.type != "MESH":
        raise RuntimeError("Source mesh ZhuangFangyi_Body was not found")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        uv_layer = mesh.uv_layers.get("UV0") or mesh.uv_layers.active
        if uv_layer is None:
            raise RuntimeError("Source body has no UV layer")

        skin_material_indices = {
            index for index, slot in enumerate(obj.material_slots)
            if slot.material and "skin" in slot.material.name.lower()
        }
        if not skin_material_indices:
            skin_material_indices = {0}

        triangles = [tri for tri in mesh.loop_triangles if tri.material_index in skin_material_indices]
        used_vertices = {vertex_index for tri in triangles for vertex_index in tri.vertices}
        max_thickness = 0.05
        epsilon = max(1.0e-5, max_thickness * 0.004)
        fallback = 0.0075
        thickness = {}
        hit_count = 0
        for vertex_index in used_vertices:
            vertex = mesh.vertices[vertex_index]
            normal = vertex.normal.normalized()
            origin = vertex.co - normal * epsilon
            hit, location, _normal, _face_index = evaluated.ray_cast(
                origin, -normal, distance=max_thickness, depsgraph=depsgraph,
            )
            if hit:
                distance = max(epsilon, min(max_thickness, (location - origin).length))
                hit_count += 1
            else:
                distance = fallback
            thickness[vertex_index] = min(1.0, distance / max_thickness)

        output_triangles = []
        for tri in triangles:
            corners = []
            for loop_index, vertex_index in zip(tri.loops, tri.vertices):
                uv = uv_layer.data[loop_index].uv
                corners.append([float(uv.x), float(uv.y), thickness[vertex_index]])
            output_triangles.append(corners)

        result = {
            "source": bpy.data.filepath,
            "object": obj.name,
            "evaluated_vertices": len(mesh.vertices),
            "skin_material_indices": sorted(skin_material_indices),
            "uv_layer": uv_layer.name,
            "max_thickness": max_thickness,
            "fallback_thickness": fallback,
            "vertex_count": len(used_vertices),
            "ray_hit_count": hit_count,
            "ray_hit_ratio": hit_count / max(len(used_vertices), 1),
            "triangles": output_triangles,
        }
        path = Path(out)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
        print(
            f"Wrote {path}: {len(output_triangles)} UV triangles, "
            f"{hit_count}/{len(used_vertices)} inward ray hits"
        )
    finally:
        evaluated.to_mesh_clear()


if __name__ == "__main__":
    main()
