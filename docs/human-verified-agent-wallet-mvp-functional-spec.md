# Human-Verified Agent Wallet MVP Functional Specification

Date: February 14, 2026  
Status: Updated to match shipped Tempo-native passkey execution (v4)

## 1. Product Summary

Human-Verified Agent Wallet is a human-in-the-loop payment control plane for AI agents on Tempo.

Tempo provides the rails (Tempo-native passkeys/WebAuthn, sponsored fees, and 2D nonces). This product adds the missing "agent layer":

- Intent-based payment requests that an AI agent can generate.
- A human review + approval UX that requires device authentication.
- Guardrails (max amount, allowlists) to reduce agent mistakes.
- Bot-friendly APIs and OpenClaw tools so agents can integrate in minutes.
- Receipt verification so the system only records execution when the on-chain transfer matches the intent.

Hackathon MVP note: in the shipped Tempo fast-lane build, funds move from a Tempo-native passkey account controlled by the human (not from a vault smart contract). The AI agent never holds a spend private key.

## 2. Problem Statement

If an AI agent controls a normal private key, it can spend funds without human consent.

We want a flow where:

1. The agent can propose a payment, but cannot execute it by itself.
2. Every payment requires human presence via passkey authentication (Face ID / Touch ID / device PIN).
3. The user experience is low-friction (1 tap approval).
4. The system is demo-ready on Tempo testnet.

## 3. MVP Goals

1. End-to-end flow: `agent creates intent -> human approves with passkey -> on-chain TIP-20 transfer -> intent marked EXECUTED`.
2. No agent-controlled spend key.
3. Strong tamper resistance: approval link contains only a one-time token; the on-chain transfer must match the intent.
4. Clear audit trail: memo + tx hash + explorer link.

## 4. Success Criteria (Hackathon MVP)

1. Agent cannot spend without human passkey approval.
2. Approval executes on Tempo testnet with sponsored fees (user does not need to manage gas) and completes within ~30 seconds.
3. Execution produces a Tempo explorer link for the tx.
4. At least one negative case demonstrated:
   - expired intent cannot be confirmed, or
   - mismatched token/to/amount cannot be confirmed.

## 5. Scope

### In Scope

1. Tempo testnet (Moderato) execution.
2. TIP-20 stablecoin transfers (eg `alphaUSD` on Moderato).
3. Agent-generated intents with fixed fields: `to`, `token`, `amount`, `memo`, `nonce`, `deadline`.
4. Tempo-native passkey approval in a PWA.
5. Sponsored fees via Tempo sponsor service.
6. Backend receipt validation: only mark `EXECUTED` if the receipt contains the expected TIP-20 `Transfer`.
7. Basic guardrails enforced by the backend when creating intents:
   - `maxAmount`
   - allowed token list
   - allowed recipient list

### Out of Scope (MVP)

1. Multi-tenant hosted product (one backend serving many independent Bobs).
2. An on-chain vault/treasury contract enforcing policy.
3. Complex org permissions/roles.
4. Full EVM portability (planned as a follow-up).

## 6. Architecture

### Components

1. **OpenClaw Bot (XYZ)**
   - Uses one HTTP call (`POST /api/commands`) to create payment intents.
   - Sends the approval link to the human in Telegram.

2. **Agent Wallet Backend (Node/TS service)**
   - Stores intents (JSON file in MVP).
   - Issues one-time approval tokens.
   - Serves the approval PWA (static files).
   - Sends push notifications (optional UX improvement).
   - Proxies Tempo RPC and sponsor endpoints for browser clients.
   - Verifies receipts and marks intents `EXECUTED`.

3. **Approval PWA (mobile web page)**
   - Loads intent details by token.
   - Uses Tempo-native passkey account (WebAuthn P-256) to sign and submit an on-chain TIP-20 transfer.
   - Calls backend confirmation with `txHash`.

4. **Tempo Testnet Services**
   - RPC: `https://rpc.moderato.tempo.xyz`
   - Sponsor: `https://sponsor.moderato.tempo.xyz`
   - Explorer: `https://explore.moderato.tempo.xyz`

### High-Level Flow

```text
XYZ (agent) -> Backend: create intent
Backend -> XYZ: approvalUrl + message payload
XYZ -> Human: send approvalUrl
Human -> PWA: open approvalUrl
PWA -> Backend: GET /api/approval/:token
PWA -> Tempo (via backend proxies): sponsored on-chain token transfer
PWA -> Backend: POST /api/approval/:token/confirm { txHash }
Backend -> Human (via XYZ polling): executed + explorer link
```

### Why a Backend Exists

Tempo passkeys solve signing, but you still need an "agent payment control plane":

1. Intent storage and lifecycle state.
2. One-time approval links (token issuance + TTL).
3. Receipt verification so the system cannot be tricked into recording execution for the wrong transfer.
4. Push notifications (optional) to make approvals fast on mobile.
5. RPC + sponsor proxies for browser access and consistent configuration.

## 7. Actors and Trust Model

1. **Human Owner**
   - Owns the Tempo passkey account.
   - Is the only entity that can produce the passkey signature.

2. **AI Agent (XYZ)**
   - Untrusted for key custody.
   - Allowed to request payments, never allowed to execute them.

3. **Backend Service**
   - Not a signer for spending.
   - Enforces guardrails on intent creation.
   - Verifies chain receipts before marking `EXECUTED`.

## 8. Data Model (Payment Intent)

Canonical intent fields (MVP):

1. `intentIdHuman` (UUID)
2. `intentId` (bytes32-like hex id)
3. `to` (address)
4. `token` (TIP-20 address)
5. `amount` (decimal string)
6. `amountBaseUnits` (string)
7. `memo` (string)
8. `memoHash` (bytes32)
9. `nonce` (integer)
10. `deadline` (unix seconds)

Backend-only metadata:

- `approvalToken` (one-time)
- `approvalTokenExpiresAt` (unix seconds)
- `status` (`PENDING_APPROVAL | EXECUTED | REJECTED | EXPIRED | FAILED`)
- `txHash` (optional)

## 9. Core User Journeys

### Journey A: Successful Payment

1. XYZ creates an intent: pay `0.01 alphaUSD` to a merchant address, memo `order_123`.
2. Backend returns `approvalUrl`.
3. XYZ sends the approval link to the human.
4. Human opens the PWA, reviews the details, taps Approve.
5. Phone prompts for passkey (Face ID / Touch ID).
6. Transfer is submitted with sponsored fees.
7. PWA confirms to backend with `txHash`.
8. XYZ reads status and replies with the explorer link.

### Journey B: Wrong Token Address (Receipt Mismatch)

1. XYZ creates an intent with a token address that is not the actual token used on-chain.
2. A tx may still succeed on-chain (for some other token), but backend confirmation fails because the receipt does not match the intent.

### Journey C: Expired Intent

1. Human opens the approval page after the deadline.
2. Approval page is blocked (expired) or backend confirmation rejects the receipt.

### Journey D: User Rejects

1. Human taps Reject.
2. Backend marks intent `REJECTED` and consumes the approval token.

## 10. Functional Requirements

### FR-01 Create Intent

- A bot calls `POST /api/commands` with `request_payment`.
- Backend persists the intent and returns:
  - `approvalUrl`
  - a Telegram-ready message body

### FR-02 Show Intent on Approval Page

- Approval page fetches `GET /api/approval/:token`.
- UI must show: amount, token, recipient, memo, countdown.

### FR-03 Execute On-Chain Transfer (Tempo Native)

- Approval page uses Tempo-native passkey account to submit a TIP-20 transfer:
  - `token`, `to`, `amount`
  - `memo = memoHash`
  - `validBefore = deadline`
  - `nonceKey = intent.nonce`
  - `feePayer = true`

### FR-04 Confirm Execution

- After tx is mined, approval page calls `POST /api/approval/:token/confirm { txHash }`.
- Backend verifies the receipt contains the expected TIP-20 `Transfer` (token/to/amount) and records `EXECUTED`.

### FR-05 Guardrails (Backend)

- Backend blocks intents that violate:
  - max amount
  - token allowlist (optional)
  - recipient allowlist (optional)

### FR-06 Audit

- Every intent keeps:
  - status
  - tx hash (when executed)
  - memo

## 11. Security Requirements

1. Approval URL contains only an opaque token, not the intent.
2. Token is high-entropy, short TTL, single-use.
3. Passkey signing requires secure context (HTTPS) and a real browser.
4. Backend receipt verification prevents marking `EXECUTED` for mismatched transfers.
5. Optional `AGENT_WALLET_API_KEY` protects bot/admin endpoints from public abuse.

## 12. Demo Acceptance Tests

1. Happy path on Moderato testnet using `alphaUSD`.
2. Reject path.
3. Expired intent.
4. Receipt mismatch (wrong token address).
5. Guardrail block (over max amount).

## 13. Phase 2 Ideas (Post-Hackathon)

1. Multi-tenant hosted backend (per-bot keys and per-tenant storage).
2. Token metadata (decimals/symbol) from Tempo token list.
3. A treasury/vault contract mode (agent submits to contract after approval).
4. EVM portability for non-Tempo chains.

