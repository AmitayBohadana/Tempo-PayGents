#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  evm-usdc-link.sh --to <0x...> --amount <decimal> [--chain-id <id>] [--token <0x...>] [--wallet <rabby|metamask>] [--base-url <url>]

Example:
  evm-usdc-link.sh --to 0x1111111111111111111111111111111111111111 --amount 10 --chain-id 8453 --wallet rabby --base-url https://agent-wallet-demo-production.up.railway.app
USAGE
}

TO=""
AMOUNT=""
CHAIN_ID="8453"
TOKEN=""
WALLET="rabby"
BASE_URL="https://agent-wallet-demo-production.up.railway.app"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TO="${2:-}"; shift 2 ;;
    --amount) AMOUNT="${2:-}"; shift 2 ;;
    --chain-id) CHAIN_ID="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --wallet) WALLET="$(echo "${2:-}" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$TO" || -z "$AMOUNT" ]]; then
  echo "Missing required args --to and --amount." >&2
  usage
  exit 1
fi

if [[ ! "$TO" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo "Invalid EVM recipient address: $TO" >&2
  exit 1
fi

if [[ ! "$AMOUNT" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Invalid amount: $AMOUNT" >&2
  exit 1
fi

if [[ ! "$CHAIN_ID" =~ ^[0-9]+$ ]]; then
  echo "Invalid chain id: $CHAIN_ID" >&2
  exit 1
fi

if [[ "$WALLET" != "rabby" && "$WALLET" != "metamask" ]]; then
  echo "--wallet must be rabby or metamask" >&2
  exit 1
fi

if [[ -z "$TOKEN" ]]; then
  case "$CHAIN_ID" in
    1) TOKEN="0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ;;
    8453) TOKEN="0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913" ;;
    11155111) TOKEN="0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" ;;
    84532) TOKEN="0x036CbD53842c5426634e7929541eC2318f3dCf7e" ;;
    *)
      echo "No default USDC token for chain id $CHAIN_ID. Provide --token." >&2
      exit 1
      ;;
  esac
fi

if [[ ! "$TOKEN" =~ ^0x[a-fA-F0-9]{40}$ ]]; then
  echo "Invalid token address: $TOKEN" >&2
  exit 1
fi

AMOUNT_BASE_UNITS="$(node -e '
const amount = process.argv[1];
const decimals = 6;
if (!/^\d+(\.\d+)?$/.test(amount)) process.exit(2);
const [whole, fracRaw = ""] = amount.split(".");
if (fracRaw.length > decimals) process.exit(3);
const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
const value = BigInt(whole) * (10n ** 6n) + BigInt(frac || "0");
process.stdout.write(value.toString());
' "$AMOUNT")"

BASE_URL="${BASE_URL%/}"
PAGE_URL="${BASE_URL}/evm-usdc.html?chainId=${CHAIN_ID}&token=${TOKEN}&to=${TO}&amount=${AMOUNT}&decimals=6&symbol=USDC"
METAMASK_DEEPLINK="https://link.metamask.io/send/${TOKEN}@${CHAIN_ID}/transfer?address=${TO}&uint256=${AMOUNT_BASE_UNITS}"

if [[ "$WALLET" == "metamask" ]]; then
  RECOMMENDED_URL="$METAMASK_DEEPLINK"
else
  RECOMMENDED_URL="$PAGE_URL"
fi

SHORT_TO="${TO:0:8}...${TO: -6}"

cat <<JSON
{
  "intent": {
    "chain": "evm",
    "chainId": ${CHAIN_ID},
    "token": "${TOKEN}",
    "symbol": "USDC",
    "decimals": 6,
    "to": "${TO}",
    "amountHuman": "${AMOUNT}",
    "amountBaseUnits": "${AMOUNT_BASE_UNITS}"
  },
  "pageUrl": "${PAGE_URL}",
  "metamaskDeepLink": "${METAMASK_DEEPLINK}",
  "recommendedUrl": "${RECOMMENDED_URL}",
  "messageTemplate": "Payment request: ${AMOUNT} USDC to ${SHORT_TO}. Open wallet and approve only if recipient and amount are exact."
}
JSON
