#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/supabase/functions"
HOST="${TRANSCRIBE_VPS_HOST:-}"
REMOTE_PATH="${TRANSCRIBE_VPS_FUNCTIONS_PATH:-/home/deno/functions-transcribe}"
SSH_KEY="${TRANSCRIBE_VPS_SSH_KEY:-$HOME/.ssh/hetzner_vps}"

if [[ -z "$HOST" ]]; then
  echo "Set TRANSCRIBE_VPS_HOST (e.g. user@your-vps.example.com)" >&2
  exit 1
fi

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

echo "Deploying to ${HOST}:${REMOTE_PATH} …"
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  "$SRC/" "${HOST}:${REMOTE_PATH}/"

if [[ -n "${TRANSCRIBE_VPS_RESTART_CMD:-}" ]]; then
  ssh "${SSH_OPTS[@]}" "$HOST" "$TRANSCRIBE_VPS_RESTART_CMD"
fi

"${ROOT}/scripts/verify-deploy.sh"
echo "Deploy complete."
