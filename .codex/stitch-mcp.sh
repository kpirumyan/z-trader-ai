#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$project_dir/.env.local"

if [[ ! -f "$env_file" ]]; then
  echo "Stitch MCP: missing $env_file" >&2
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ -z "${STITCH_API_KEY:-}" ]]; then
  echo "Stitch MCP: STITCH_API_KEY is missing in .env.local" >&2
  exit 1
fi

exec pnpm --silent dlx mcp-remote https://stitch.googleapis.com/mcp \
  --header "X-Goog-Api-Key: ${STITCH_API_KEY}"
