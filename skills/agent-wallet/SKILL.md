---
name: agent-wallet
description: Human-Verified Agent Wallet — create payment intents, send approval links, manage policy, and track on-chain execution for AI agent purchases on Tempo. Use when a user asks to buy something, pay someone, check payment status, or configure spending limits/allowlists. Requires the agent-wallet backend running (default localhost:8787).
---

# Agent Wallet Skill

Control the Human-Verified Agent Wallet backend to create payment intents that require human passkey approval before on-chain execution.

## Prerequisites

- Agent wallet server running: `AGENT_WALLET_URL` env var or default `http://localhost:8787`
- Optional auth: set `AGENT_WALLET_API_KEY` if the backend requires it
- For API details: `read references/api.md`

## Core Workflow

### 1. User asks to buy something / pay someone

1. Gather: recipient address, token address, amount, memo, item name, merchant name.
2. Call `request_payment` via the script:

```bash
scripts/wallet-cmd.sh '{"command":"request_payment","args":{"to":"0x...","token":"0x...","amount":"50","memo":"order-levis-501","merchantName":"Levis","itemName":"Levis 501 Original"}}'
```

3. From the response, extract `approvalUrl` and `messages[0].body`.
4. Send the user a Telegram message with the approval link as an inline button:
   - Button text: "✅ Approve Payment"
   - Button URL: the `approvalUrl`
   - Message body: formatted intent summary (amount, item, merchant, expiry)

### 2. User approves on the approval page

The approval page handles passkey/biometric auth. After approval:
- If `AUTO_SUBMIT_ON_APPROVE=true` (default), the backend submits the tx automatically.
- The intent status transitions: `PENDING_APPROVAL → APPROVED_AUTHORIZED → SUBMITTED → EXECUTED`

### 3. Check status / confirm to user

Poll intent status if needed:

```bash
scripts/wallet-cmd.sh '{"command":"get_intent","args":{"intentId":"0x..."}}'
```

When status is `EXECUTED`, send confirmation with tx hash and explorer link.
When status is `FAILED`, notify user with error reason.
When status is `EXPIRED`, notify user the intent expired.

### 4. Policy management

Set spending limits or allowlists when the user asks:

```bash
# Set max $100 per payment
scripts/wallet-cmd.sh '{"command":"set_policy","args":{"maxAmount":"100"}}'

# Restrict to specific tokens
scripts/wallet-cmd.sh '{"command":"set_policy","args":{"tokenAllowlistEnforced":true,"allowedTokens":["0xUSDC..."]}}'

# Check current policy
scripts/wallet-cmd.sh '{"command":"get_policy"}'
```

### 5. List / search intents

```bash
scripts/wallet-cmd.sh '{"command":"list_intents"}'
```

## Message Formatting

When sending payment approval to user via Telegram:
- Use inline button with approval URL (not raw link in text)
- Show: item name, merchant, amount + token symbol, recipient (truncated), expiry countdown
- After execution: show ✅ with tx hash as explorer link

## Error Handling

- If backend is unreachable, tell user the wallet service is offline
- If policy blocks the intent (POLICY_MAX_AMOUNT_EXCEEDED, POLICY_TOKEN_NOT_ALLOWED, POLICY_RECIPIENT_NOT_ALLOWED), explain which policy was violated
- If intent expired, suggest creating a new one

## Demo Mode

For hackathon demo without real chain:
- Backend runs with `CHAIN_SUBMITTER=mock` (default) — returns fake tx hashes
- Approval page supports `?demo=1` query param for environments without WebAuthn
- All flows work identically, just no real on-chain execution
