#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  tron-intent.sh --to <T...> --amount <decimal> --asset <TRX|TRC20> [--token <T...>] [--decimals <n>] [--memo <text>]

Examples:
  tron-intent.sh --to TVjs... --amount 25 --asset TRX --memo "order-123"
  tron-intent.sh --to TVjs... --amount 15.5 --asset TRC20 --token TXLA... --decimals 6
USAGE
}

TO=""
AMOUNT=""
ASSET=""
TOKEN=""
DECIMALS=""
MEMO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to) TO="${2:-}"; shift 2 ;;
    --amount) AMOUNT="${2:-}"; shift 2 ;;
    --asset) ASSET="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --decimals) DECIMALS="${2:-}"; shift 2 ;;
    --memo) MEMO="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ -z "$TO" || -z "$AMOUNT" || -z "$ASSET" ]]; then
  echo "Missing required args." >&2
  usage
  exit 1
fi

if [[ ! "$TO" =~ ^T[1-9A-HJ-NP-Za-km-z]{25,40}$ ]]; then
  echo "Invalid TRON address format for --to: $TO" >&2
  exit 1
fi

if [[ ! "$AMOUNT" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Invalid --amount: $AMOUNT" >&2
  exit 1
fi

ASSET_UPPER="$(echo "$ASSET" | tr '[:lower:]' '[:upper:]')"
if [[ "$ASSET_UPPER" != "TRX" && "$ASSET_UPPER" != "TRC20" ]]; then
  echo "--asset must be TRX or TRC20" >&2
  exit 1
fi

if [[ "$ASSET_UPPER" == "TRC20" ]]; then
  if [[ -z "$TOKEN" || -z "$DECIMALS" ]]; then
    echo "TRC20 mode requires --token and --decimals" >&2
    exit 1
  fi
  if [[ ! "$TOKEN" =~ ^T[1-9A-HJ-NP-Za-km-z]{25,40}$ ]]; then
    echo "Invalid TRON token address format for --token: $TOKEN" >&2
    exit 1
  fi
  if [[ ! "$DECIMALS" =~ ^[0-9]+$ ]]; then
    echo "Invalid --decimals: $DECIMALS" >&2
    exit 1
  fi
fi

AMOUNT_BASE_UNITS="$(node -e '
const amount = process.argv[1];
const decimals = Number(process.argv[2]);
if (!Number.isFinite(decimals) || decimals < 0) process.exit(2);
const [whole, fracRaw = ""] = amount.split(".");
if (!/^\d+$/.test(whole) || !/^\d*$/.test(fracRaw)) process.exit(3);
const frac = (fracRaw + "0".repeat(decimals)).slice(0, decimals);
const value = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(frac || "0");
process.stdout.write(value.toString());
' "$AMOUNT" "$([[ "$ASSET_UPPER" == "TRX" ]] && echo 6 || echo "$DECIMALS")")"

NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
TOKEN_JSON="null"
DECIMALS_JSON="null"
if [[ "$ASSET_UPPER" == "TRC20" ]]; then
  TOKEN_JSON="\"$TOKEN\""
  DECIMALS_JSON="$DECIMALS"
fi

SHORT_TO="${TO:0:6}...${TO: -4}"
ASSET_LABEL="$ASSET_UPPER"
if [[ "$ASSET_UPPER" == "TRC20" ]]; then
  ASSET_LABEL="TRC20"
fi

cat <<JSON
{
  "intent": {
    "chain": "tron",
    "assetType": "$ASSET_UPPER",
    "to": "$TO",
    "token": $TOKEN_JSON,
    "amountHuman": "$AMOUNT",
    "amountBaseUnits": "$AMOUNT_BASE_UNITS",
    "decimals": $DECIMALS_JSON,
    "memo": "$MEMO",
    "createdAt": "$NOW"
  },
  "messageTemplate": "Payment request: $AMOUNT $ASSET_LABEL to $SHORT_TO. Open wallet, review recipient+amount, and approve only if exact.",
  "deeplinkCandidates": {
    "walletConnectNote": "Use your wallet's WalletConnect session to present this intent as a transaction request.",
    "tronLinkNote": "Use TronLink deeplink/injected provider flow in your bot client to open the wallet confirmation."
  }
}
JSON
