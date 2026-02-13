#!/usr/bin/env bash
# wallet-cmd.sh — thin wrapper to call the Agent Wallet API
# Usage: wallet-cmd.sh <json_payload>
# Env: AGENT_WALLET_URL (default: http://localhost:8787)

set -euo pipefail

API="${AGENT_WALLET_URL:-http://localhost:8787}"
PAYLOAD="${1:?Usage: wallet-cmd.sh '<json_payload>'}"

curl -sf -X POST "${API}/api/commands" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}"
