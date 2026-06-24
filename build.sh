#!/bin/bash
set -e

TWEEGO="tools/tweego.exe"
SRC="src/passages"
SCRIPTS="src/scripts"
STYLES="src/styles"
OUT="dist/index.html"

mkdir -p dist

# JS files in src/scripts are passed as sources so Tweego includes them as
# SugarCube user scripts (same scope as the engine). CSS files are modules.
"$TWEEGO" -f sugarcube-2 -o "$OUT" "$SRC" "$SCRIPTS" \
  --module="$STYLES/base.css" \
  --module="$STYLES/ui.css" \
  --module="$STYLES/theme-default.css" \
  --module="$STYLES/theme-light.css" \
  --module="$STYLES/pixel-art.css"

echo "Build complete: $OUT"
