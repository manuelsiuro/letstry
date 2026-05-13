#!/usr/bin/env bash
# Optimize one or more GLB files for the web.
#
# Usage:
#   ./scripts/optimize-glb.sh path/to/input.glb [more.glb ...]
#
# Output: writes optimized GLBs to public/assets/models/<basename>.glb
#
# Pipeline:
#   1. dedup    — share materials/textures across primitives
#   2. prune    — drop unused materials/meshes
#   3. weld     — merge duplicate vertices
#   4. resize   — clamp textures to 1024px max
#   5. draco    — mesh compression
#
# Requires `@gltf-transform/cli` (devDep). KTX2 (BasisU) compression is
# available via `gltf-transform uastc` once a basisu encoder is on PATH —
# add that step manually if you need smaller textures.
#
# Blender export settings that work with this script:
#   File > Export > glTF 2.0 (.glb)
#   - Format: glTF Binary (.glb)
#   - Include: Limit to: Selected Objects (recommended)
#   - Transform: +Y Up
#   - Geometry: Apply Modifiers, UVs, Normals, Tangents
#   - Material: Export Materials, Compression: NONE (we Draco-compress below)
#   - Animation: only if you exported skinned meshes
set -euo pipefail

OUT_DIR="public/assets/models"
mkdir -p "$OUT_DIR"

if ! command -v gltf-transform >/dev/null 2>&1; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "error: gltf-transform not found and npx unavailable" >&2
    exit 1
  fi
  CMD=(npx --yes @gltf-transform/cli)
else
  CMD=(gltf-transform)
fi

for IN in "$@"; do
  if [[ ! -f "$IN" ]]; then
    echo "skip (not found): $IN" >&2
    continue
  fi
  BASENAME=$(basename "$IN")
  TMP=$(mktemp -t glb-opt.XXXXXX.glb)
  OUT="$OUT_DIR/$BASENAME"

  echo "→ optimizing $IN"
  "${CMD[@]}" dedup "$IN" "$TMP"
  "${CMD[@]}" prune "$TMP" "$TMP"
  "${CMD[@]}" weld "$TMP" "$TMP"
  "${CMD[@]}" resize --width 1024 --height 1024 "$TMP" "$TMP"
  "${CMD[@]}" draco "$TMP" "$OUT"
  rm -f "$TMP"

  SIZE=$(du -h "$OUT" | cut -f1)
  echo "  done → $OUT ($SIZE)"
done

echo "all done."
