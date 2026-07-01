#!/usr/bin/env bash
# Fetch a SMALL development planet extract via remote HTTP range requests.
# Never downloads the full ~137GB planet build - that only ever happens on the
# server via the ansible data playbook.
#
# Usage:
#   scripts/dev-data.sh                 # worldwide z0-6 extract (a few hundred MB)
#   scripts/dev-data.sh --uk            # UK bbox at z0-12 for county-level testing
#   scripts/dev-data.sh --bbox "<minLon,minLat,maxLon,maxLat>" --maxzoom N
set -euo pipefail
cd "$(dirname "$0")/.."

GO_PMTILES_VERSION="1.30.3"
BIN="bin/pmtiles"
OUT="data/planet.pmtiles"

MAXZOOM=6
BBOX=""
if [[ "${1:-}" == "--uk" ]]; then
  BBOX="-8.6,49.9,1.8,60.9"
  MAXZOOM=12
elif [[ "${1:-}" == "--bbox" ]]; then
  BBOX="$2"
  MAXZOOM="${4:-10}"
fi

if [[ ! -x "$BIN" ]]; then
  echo "fetching go-pmtiles ${GO_PMTILES_VERSION}..."
  mkdir -p bin
  curl -sL "https://github.com/protomaps/go-pmtiles/releases/download/v${GO_PMTILES_VERSION}/go-pmtiles_${GO_PMTILES_VERSION}_Linux_x86_64.tar.gz" \
    | tar -xzf - -C bin pmtiles
fi

LATEST=$(curl -s https://build-metadata.protomaps.dev/builds.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin)[-1]['key'])")
echo "latest planet build: ${LATEST}"

mkdir -p data
if [[ -f "$OUT" ]]; then
  echo "removing existing $OUT"
  rm -f "$OUT"
fi

ARGS=(extract "https://build.protomaps.com/${LATEST}" "$OUT" "--maxzoom=${MAXZOOM}")
if [[ -n "$BBOX" ]]; then
  ARGS+=("--bbox=${BBOX}")
fi
"$BIN" "${ARGS[@]}"

echo "dev planet ready at $OUT"
"$BIN" show "$OUT" | head -12
