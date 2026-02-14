# PayGents Technical Implementation Specification

Date: February 14, 2026  
Status: Updated to match shipped Tempo-native passkey execution + hosted multi-tenant API keys (v4)

## 1. Purpose

This document describes how the shipped MVP is implemented in this repo:

- Backend service: intent store, approval tokens, receipt verification, push notifications, and Tempo RPC/sponsor proxies.
- Approval PWA: Tempo-native passkey execution of TIP-20 transfers with sponsored fees.
- OpenClaw integration: one command endpoint plus an optional OpenClaw plugin.

## 2. MVP Implementation (What Runs Today)

### 2.1 Key Design Choice

The human is the payer.

- The approval PWA signs and submits the TIP-20 transfer directly using a Tempo-native passkey account (WebAuthn/P-256).
- The AI agent never holds a spend key.
- The backend verifies the resulting on-chain receipt matches the intent before marking it `EXECUTED`.

### 2.2 Tempo Testnet Constants

- Chain: Moderato
- ChainId: `42431`
- RPC: `https://rpc.moderato.tempo.xyz`
- Sponsor: `https://sponsor.moderato.tempo.xyz`
- Explorer: `https://explore.moderato.tempo.xyz/tx/<hash>`
- TIP-20 token list: `https://tokenlist.tempo.xyz/list/42431`

## 3. Repo Layout (Relevant Paths)

```text
Temp-Hack/
  agent/
    src/
      server.ts
      core/
        intent-store.ts
        intent-service.ts
        state-machine.ts
      types.ts
    data/intents.json
  approval-page/public/
    index.html
    app.js
    sw.js
  docs/
    paygents-mvp-functional-spec.md
    paygents-technical-implementation-spec.md
    openclaw-integration.md
    openclaw-tool-config.snippet.json5
  openclaw-plugin-agent-wallet/
    openclaw.plugin.json
    index.js
```

## 4. System Components

### 4.1 Backend Service

The backend is a Node/TypeScript Express app.

Responsibilities:

1. Intent creation and persistence.
2. One-time approval token issuance.
3. Serve the approval PWA static files.
4. Push notifications (optional) via Web Push.
5. Proxy Tempo JSON-RPC and Sponsor JSON-RPC for browser clients:
   - `POST /api/rpc`
   - `POST /api/sponsor`
6. Receipt verification + intent finalization:
   - `POST /api/approval/:token/confirm`

### 4.2 Approval PWA

The PWA is static HTML/JS served by the backend.

Responsibilities:

1. Fetch immutable intent details by approval token.
2. Create or load a Tempo-native passkey credential.
3. Submit a sponsored TIP-20 transfer that matches the intent.
4. Confirm tx hash back to backend.

### 4.3 OpenClaw Bot (XYZ)

Responsibilities:

1. Call `POST /api/commands` to create intents.
2. Deliver the approval link to the human (Telegram).
3. Poll status and report success/failure.

An optional OpenClaw plugin is included to expose typed tools:

- `agent_wallet_register` (one-time bot registration)
- `agent_wallet_request_payment`
- `agent_wallet_get_intent`
- `agent_wallet_list_intents`
- `agent_wallet_get_policy`
- `agent_wallet_set_policy`

## 5. Data Model and State Machine

### 5.1 Persistence

MVP storage is a JSON file (default: `agent/data/intents.json`).

The store also holds:

- `nextNonce` (used to assign a unique `nonce` to each new intent)
- `policy` / `policiesByBotId` (max amount, allowlists; per-bot in multi-tenant mode)
- `pushSubscriptions`
- `tenants.json` (issued API keys -> botId mappings)

### 5.2 Intent States

The code supports multiple states for future execution modes. The Tempo-native passkey flow uses a direct transition:

- `PENDING_APPROVAL -> EXECUTED` (via `/confirm`)

Other states exist for future/alternate submission modes:

- `APPROVED_AUTHORIZED`, `SUBMITTED`, `FAILED`

## 6. API Contract

### 6.1 Auth and Multi-Tenancy

PayGents supports 2 auth modes:

1. **Hosted multi-tenant mode (default)**:
   - Bots call `POST /api/register` to get `{ apiKey, botId }`.
   - Bot-facing endpoints require `Authorization: Bearer <apiKey>` (or `x-api-key`).
   - Intents, policy, and (optionally) push notifications are scoped by `botId`.

2. **Legacy single-key mode** (self-hosting):
   - If `AGENT_WALLET_API_KEY` is set, bot-facing endpoints require that single key.
   - No botId scoping is applied.
   - In this mode, `POST /api/register` is disabled (to avoid issuing keys that won't work).

Bot-facing endpoints (require API key in hosted/legacy mode):

- `POST /api/commands`
- `POST /api/intents`
- `GET /api/intents`
- `GET /api/intents/:intentId`
- `GET /api/intents/:intentId/messages`
- `GET /api/policy`
- `PATCH /api/policy`

Public endpoints:

- `GET /` (approval PWA landing + approval page when `?token=` is present)
- `GET /approve` (alias)
- `GET /assets/*`
- `POST /api/register`
- `GET /api/approval/:token`
- `POST /api/approval/:token/confirm`
- `POST /api/approval/:token/reject`
- `POST /api/rpc`
- `POST /api/sponsor`
- `GET /api/push/vapid-public-key`

Push endpoints (require API key):

- `POST /api/push/subscribe` (pairs this browser subscription to the botId behind the apiKey)
- `POST /api/push/unsubscribe`

### 6.2 `POST /api/commands`

Single integration endpoint used by OpenClaw.

Supported commands:

- `request_payment`
- `set_policy`
- `get_policy`
- `list_intents`
- `get_intent`

`request_payment` returns:

- persisted intent
- `approvalUrl`
- Telegram-ready message body

### 6.3 `GET /api/approval/:token`

Returns the approval payload consumed by the PWA:

- `to`, `token`, `amountBaseUnits`, `memoHash`, `nonce`, `deadline`, etc.

### 6.4 `POST /api/approval/:token/confirm`

Request:

```json
{ "txHash": "0x..." }
```

Behavior:

1. Re-load approval payload for the token.
2. Fetch receipt from Tempo RPC (`eth_getTransactionReceipt`).
3. Validate:
   - `receipt.status == 0x1`
   - if `receipt.blockTimestamp` is present, it must be `<= deadline`
   - receipt logs contain TIP-20 `Transfer` for:
     - token address == intent token
     - `to` == intent `to`
     - `value` == intent `amountBaseUnits`
4. If valid: mark intent `EXECUTED`, persist `txHash`, consume approval token.

### 6.5 `POST /api/rpc` and `POST /api/sponsor`

The PWA uses these as transports for `viem/tempo`:

- RPC proxy forwards JSON-RPC to `TEMPO_RPC_URL` (default Moderato RPC).
- Sponsor proxy forwards JSON-RPC to `TEMPO_SPONSOR_URL`.

## 7. Approval PWA Implementation Details

### 7.1 Passkey Account

- First use creates a credential via `WebAuthnP256.createCredential({ label })`.
- The app stores `credential.id` and `credential.publicKey` locally.
- The account address is derived from the public key.

### 7.2 Sponsored Transfer

The approval button submits:

- TIP-20 transfer via `client.token.transferSync({ ... feePayer:true })`
- `nonceKey = intent.nonce` (uses Tempo 2D nonces)
- `validBefore = intent.deadline`

Then it calls `/confirm` with the tx hash.

### 7.3 Faucet Helper

A "Fund Testnet Wallet" button calls `tempo_fundAddress` via `/api/rpc` to fund the passkey address on Moderato.

## 8. Policy Guardrails

Guardrails are currently enforced off-chain by the backend.

- `maxAmount`
- token allowlist (optional)
- recipient allowlist (optional)

These guardrails prevent the agent from generating unsafe/incorrect intents. They are not an on-chain restriction in the Tempo-native passkey mode.

## 9. Security Notes

1. Passkeys require HTTPS and a browser with WebAuthn support; many in-app browsers break this.
2. Approval tokens are single-use and TTL-bound.
3. Receipt verification ensures the system does not record execution unless the chain action matches the intent.
4. If the backend is public, require API keys for bot-facing endpoints (hosted multi-tenant keys, or `AGENT_WALLET_API_KEY` in legacy single-key mode).
5. `/api/rpc` and `/api/sponsor` are powerful proxies. This repo rate-limits and allowlists JSON-RPC methods to reduce abuse.
6. Push notifications are scoped by bot apiKey (the PWA must be paired to a bot in "Connected Agents" before subscribing).
7. For push notifications to survive backend restarts/redeploys, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` as environment variables.

## 10. Testing Strategy (MVP)

Pragmatic approach for hackathon MVP:

1. Contract tests are out of scope for the Tempo-native passkey mode.
2. Manual E2E tests:
   - Create intent (real Moderato TIP-20 token).
   - Open approval URL on mobile Safari/Chrome.
   - Approve with passkey.
   - Confirm backend marks `EXECUTED` and stores tx hash.
   - Negative: use wrong token address in intent, confirm should reject with `TX_DOES_NOT_MATCH_INTENT`.

## 11. Phase 2 (Optional Future Work)

1. A vault/treasury contract mode where the human approval authorizes a contract execution.
2. Webhook callbacks for agents (no polling).
3. EVM portability beyond Tempo.
