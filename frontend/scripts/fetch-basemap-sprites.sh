#!/usr/bin/env bash
# Vendor the Protomaps sprite sheets for every flavour the style picker offers.
set -euo pipefail
cd "$(dirname "$0")/.."

base="https://raw.githubusercontent.com/protomaps/basemaps-assets/main/sprites/v4"
dest="public/basemaps-assets/sprites/v4"
mkdir -p "$dest"

for flavour in light dark white grayscale black; do
  for scale in "" "@2x"; do
    for ext in json png; do
      file="${flavour}${scale}.${ext}"
      echo "fetching ${file}"
      curl -fsSL "${base}/${file}" -o "${dest}/${file}"
    done
  done
done
