---
name: tron-payment-poc
description: TRON payment POC skill. Use when the user wants a fast no-backend flow where an agent creates a TRON transfer intent and sends a wallet/deeplink payload for the human to approve in their wallet.
---

# TRON Payment POC Skill

Use this skill for a minimal POC:

1. Agent receives a payment request.
2. Agent generates a TRON transfer intent payload.
3. Agent sends the user an "open wallet and approve" message.
4. User approves in wallet (TronLink or another TRON wallet).

This skill intentionally avoids backend lifecycle/state complexity.

## Quick Rules

- Target network: `TRON Mainnet` (`chain = tron` in this skill docs).
- Asset types:
  - Native TRX transfer
  - TRC20 transfer (e.g. USDT)
- Never promise auto-execution. The user must still approve in wallet.
- Always show recipient + amount + token + short risk warning before sending link payload.

## Inputs You Must Collect

Before generating payload:

1. Recipient address (`T...`)
2. Amount (decimal string)
3. Asset:
   - `TRX`, or
   - TRC20 contract address (`T...`)
4. Optional memo/order id text

If any field is missing, ask for it.

## Commands

Use the helper script:

```bash
skills/tron-payment-poc/scripts/tron-intent.sh \
  --to TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 25 \
  --asset TRX \
  --memo "order-123"
```

TRC20 example:

```bash
skills/tron-payment-poc/scripts/tron-intent.sh \
  --to TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --amount 15.5 \
  --asset TRC20 \
  --token TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --decimals 6 \
  --memo "shirt-order"
```

The script returns:

- `intent` object
- `messageTemplate` you can send to the user
- `deeplinkCandidates` placeholders to fill with wallet-specific formats

## User Message Pattern

When sharing with user, keep this format:

1. What will be paid (amount + token)
2. To whom (truncated address)
3. Explicit action:
   - "Tap Open Wallet"
   - "Review details and approve in your wallet"
4. Safety note:
   - "If recipient/amount mismatch, reject"

## Constraints

- This POC is no-backend and no-policy enforcement.
- Do not claim anti-fraud guardrails are active.
- Do not claim transaction success until tx hash is confirmed by the user/wallet.

## Optional Next Step (Post-POC)

If the user later asks for productionization:

1. Reintroduce backend intent tracking.
2. Add bot pairing/revocation.
3. Add policy checks before creating payment payloads.
