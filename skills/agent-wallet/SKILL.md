---
name: agent-wallet
description: PayGents (Human-Verified Agent Wallet) — create payment intents, send approval links, manage policy, and track on-chain execution for AI agent purchases on Tempo. Use when a user asks to buy something, pay someone, check payment status, or configure spending limits/allowlists. Requires the backend running (default localhost:8787) or a hosted PayGents URL.
---

# PayGents Skill (agent-wallet)

Control the PayGents backend to create payment intents that require human passkey approval before on-chain execution.

## First-Time Setup: Pairing

Before you can create intents, you need an API key. PayGents uses a **4-digit pairing flow** (like Bluetooth) so the human wallet owner explicitly grants access to your bot.

### How Pairing Works

1. **Human opens the PayGents PWA** (e.g. `https://agent-wallet-demo-production.up.railway.app`)
2. **Human clicks "Pair New Agent"** → PWA calls `POST /api/pair/request` → shows a 4-digit code
3. **Human tells you the code** (e.g. "pair PayGents 3381")
4. **You complete the pairing** by calling `POST /api/pair/complete`:

```bash
curl -s -X POST <PAYGENTS_BASE_URL>/api/pair/complete \
  -H "Content-Type: application/json" \
  -d '{"code":"<4-DIGIT-CODE>","botName":"<YOUR_BOT_NAME>"}'
```

5. Response: `{ "apiKey": "...", "botId": "..." }`
6. **Immediately save the API key** in your config (skill config or env var) so all future requests are authenticated.
7. The PWA polls and sees the pairing succeeded → shows your bot as a connected agent.

### After Pairing

- Store `apiKey` and `botId` in your skill/plugin config
- Use `Authorization: Bearer <apiKey>` on all API calls
- The human can remove your bot from the PWA at any time (revokes access)
- Pairing codes expire after 5 minutes — if expired, the human generates a new one

### Recognizing a Pairing Request

When your human says something like:
- "pair PayGents 3381"
- "connect agent wallet 9012"
- "paygents code 5555"

Extract the 4-digit code and call `/api/pair/complete` with it. Use your bot's display name as `botName`.

## Prerequisites

- PayGents backend running at a known URL (production: `https://agent-wallet-demo-production.up.railway.app`)
- API key obtained via pairing (see above) or `POST /api/register` (programmatic)
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

The approval page handles passkey/biometric auth and submits the on-chain TIP-20 transfer (sponsored fees). After the tx is mined, the page calls `/api/approval/:token/confirm`, and the backend marks the intent `EXECUTED` (after receipt verification).

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

For hackathon demos, the easiest path is to use Tempo Moderato testnet + the hosted PayGents URL so WebAuthn + sponsorship work reliably on mobile browsers.

## Tempo Testnet Info

- **Chain:** Moderato (chain ID 42431)
- **RPC:** `https://rpc.moderato.tempo.xyz`
- **Explorer:** `https://explore.moderato.tempo.xyz/tx/`
- **Token:** `alphaUSD` = `0x20c0000000000000000000000000000000000001` (6 decimals)
- **Faucet:** Call `tempo_fundAddress` via RPC to fund a wallet with test tokens
