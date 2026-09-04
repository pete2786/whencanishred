#!/usr/bin/env bash
# Rasterize every frame in social/out/ to PNG with the Chrome already installed.
#
# No npm dependency, because this repo has no package.json and is better for it.
# Chrome's --screenshot captures the whole viewport, and social/make.mjs sizes
# each page to exactly its frame, so there is nothing to crop.
#
#   node social/make.mjs && social/render.sh
#
# Fonts come from Google, so the first run needs a network. Chrome is given a
# moment to finish webfont layout before the shot -- without it, Anton has not
# landed and every frame rasterizes in the fallback face.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  for c in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME=/path/to/chrome" >&2; exit 1; }

shopt -s nullglob
pages=("$OUT"/*.html)
[ ${#pages[@]} -gt 0 ] || { echo "no frames in $OUT -- run: node social/make.mjs" >&2; exit 1; }

for page in "${pages[@]}"; do
  name="$(basename "$page" .html)"
  # The frame's own dimensions, read back off the page rather than tracked here.
  size="$(sed -n 's/.*width:\([0-9]*\)px; height:\([0-9]*\)px; overflow.*/\1,\2/p' "$page" | head -1)"
  [ -n "$size" ] || { echo "  ! $name: could not read size" >&2; continue; }

  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --virtual-time-budget=4000 \
    --default-background-color=00000000 \
    --window-size="$size" \
    --screenshot="$OUT/$name.png" \
    "file://$page" >/dev/null 2>&1

  if [ -f "$OUT/$name.png" ]; then
    echo "  $name.png  ${size/,/×}"
  else
    echo "  ! $name: no screenshot produced" >&2
  fi
done

echo
echo "PNGs in $OUT"
