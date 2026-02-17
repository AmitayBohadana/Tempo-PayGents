---
name: evm-usdc-wallet-poc
description: EVM USDC payment POC skill. Use when the user wants Walter/bot to request a USDC transfer and open MetaMask or Rabby wallet approval on phone.
---

# EVM USDC Wallet POC Skill

Use this skill when the user asks for a direct EVM wallet-approval payment flow.

Goal:

1. Agent receives payment instruction.
2. Agent generates a payment link payload.
3. User taps link on phone.
4. Wallet opens and user approves the USDC transfer.

This is intentionally POC-grade. It does not include backend policy enforcement.

## Supported Wallet Paths

1. **MetaMask mobile deeplink**:
   - Uses MetaMask official deeplink format.
   - Best option for one-tap wallet open from chat.
2. **Rabby / injected wallet path**:
   - Uses `/evm-usdc.html` page with `window.ethereum`.
   - Works in Rabby extension or Rabby in-app browser.

## Inputs Required

Before creating payment links collect:

1. recipient (`0x...`)
2. amount (`decimal string`, e.g. `10`)
3. chain id (`1`, `8453`, `11155111`, `84532`)
4. optional token override (if not standard USDC)

## Command

Generate links:

```bash
skills/evm-usdc-wallet-poc/scripts/evm-usdc-link.sh \
  --to 0x1111111111111111111111111111111111111111 \
  --amount 10 \
  --chain-id 8453 \
  --wallet rabby \
  --base-url https://agent-wallet-demo-production.up.railway.app
```

The script outputs:

- `intent` (normalized payment request)
- `pageUrl` (Rabby/injected-wallet flow)
- `metamaskDeepLink` (direct MetaMask open)
- `recommendedUrl` (based on preferred wallet)
- `messageTemplate` for the bot

## Sending Guidance

When replying to user:

1. State recipient + amount clearly.
2. Send `recommendedUrl`.
3. If user is on MetaMask, also send `metamaskDeepLink`.
4. Safety text: "Reject if recipient or amount is not exact."

## Reality Check

- User must still approve in wallet.
- Bot cannot force-send funds.
- No on-chain policy guardrails in this POC mode.
