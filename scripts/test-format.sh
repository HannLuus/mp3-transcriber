#!/usr/bin/env bash
# Smoke-test format-text with a long transcript (defaults to Esti recording in Downloads).
set -euo pipefail

API_BASE="${TRANSCRIBE_API_BASE:-http://localhost:3000/api}"
SAMPLE="${1:-/home/hann/Downloads/Esti recording.txt}"
MODE="${2:-clean}"

if [[ ! -f "$SAMPLE" ]]; then
  echo "Sample file not found: $SAMPLE"
  exit 1
fi

echo "Formatting $(wc -c < "$SAMPLE") bytes from $(basename "$SAMPLE") mode=$MODE ..."
START=$(date +%s)

# shellcheck disable=SC2016
TRANSCRIPT=$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1], encoding="utf-8", errors="replace").read()))' "$SAMPLE")

RESP=$(curl -s -w "\nHTTP:%{http_code}" -X POST "${API_BASE}/format-text" \
  -H 'Content-Type: application/json' \
  -d "{\"transcript\":$TRANSCRIPT,\"mode\":\"$MODE\"}")

HTTP=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "$HTTP"
echo "$BODY" | head -c 500
echo ""
END=$(date +%s)
echo "Done in $((END - START))s"

echo "$HTTP" | grep -q 'HTTP:200' || exit 1
echo "$BODY" | grep -q '"text":' || exit 1
echo "format-text smoke OK"
