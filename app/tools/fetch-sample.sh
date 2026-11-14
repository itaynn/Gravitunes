#!/bin/sh
# Download a small sample of SVS 5152 (Near surface Ozone) frames + color bar,
# then make 1024x512 PNG copies for the browser (macOS `sips`; else ImageMagick `convert`).
# Usage (from repo root): sh app/tools/fetch-sample.sh [STEP] [download|resize|all]
#   STEP = take every STEP-th of the 372 hourly frames (default 16 -> 24 frames, ~150 MB originals).
set -e
STEP=${1:-16}
WHAT=${2:-all}
BASE=https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005152
OUT=data/nasa-svs/5152
mkdir -p "$OUT/frames" "$OUT/web"
NUMS=""
i=1
while [ $i -le 372 ]; do NUMS="$NUMS $(printf %08d $i)"; i=$((i + STEP)); done

if [ "$WHAT" != resize ]; then
  [ -s "$OUT/O3_colorbar_plain.png" ] || curl -fsS -o "$OUT/O3_colorbar_plain.png" "$BASE/O3_colorbar_plain.png"
  for n in $NUMS; do
    f="$OUT/frames/$n.png"
    [ -s "$f" ] || { echo "get $n"; curl -fsS -o "$f" "$BASE/frames/2048x1024_2x1_12p/MC02_stage4_GMAO_O3_2048x1024_en-hwtool/$n.png"; }
  done
fi

if [ "$WHAT" != download ]; then
  cp "$OUT/O3_colorbar_plain.png" "$OUT/web/colorbar.png"
  LIST=""
  for n in $NUMS; do
    w="$OUT/web/$n.png"
    if [ ! -s "$w" ]; then
      t="${TMPDIR:-/tmp}/gravitunes-$n.png"
      if command -v sips >/dev/null; then sips -z 512 1024 "$OUT/frames/$n.png" --out "$t" >/dev/null
      else convert "$OUT/frames/$n.png" -resize 1024x512 "$t"; fi
      mv "$t" "$w"
    fi
    LIST="$LIST{\"file\":\"$n.png\",\"hour\":$(expr $n - 1 || true)},"
  done
  # Manifest read by app/core/datasets.js. hour = hours after 2026-10-29 05:00 EDT (frame 1).
  printf '{"start":"2026-10-29T05:00:00-04:00","frames":[%s]}\n' "${LIST%,}" > "$OUT/web/frames.json"
  echo "done: $(ls "$OUT/web" | wc -l) files in $OUT/web"
fi
