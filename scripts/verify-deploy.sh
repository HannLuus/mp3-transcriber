#!/usr/bin/env bash
set -euo pipefail

API_BASE="${TRANSCRIBE_API_BASE:-${1:-http://localhost:3000/api}}"

echo "Checking health at ${API_BASE}/health ..."
body="$(curl -sf "${API_BASE}/health")"
echo "$body" | grep -q '"ok":true' && echo "Health OK" || {
  echo "Health check failed: $body"
  exit 1
}

if [[ -n "${SMOKE_AUDIO:-}" && -f "${SMOKE_AUDIO}" ]]; then
  echo "Smoke transcribe: ${SMOKE_AUDIO} ..."
  curl -sf -X POST \
    -F "file=@${SMOKE_AUDIO}" \
    -F "language=en" \
    "${API_BASE}/transcribe" | head -c 200
  echo ""
  echo "Transcribe smoke OK (truncated output)"
fi

echo "All checks passed."
