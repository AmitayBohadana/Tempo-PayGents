# Human-Verified Agent Wallet MVP Functional Specification

Date: February 13, 2026  
Status: Draft v2

## 1. Product Summary

Human-Verified Agent Wallet is a human-in-the-loop payment system for AI agents on Tempo.  
The agent can prepare payment intents, but funds move only when the human approves the exact intent with passkey authentication (biometric or device-auth unlock such as Face ID, Touch ID, fingerprint, or iris unlock).

## 2. Problem Statement

If an AI agent controls a normal private key, it can spend funds without human consent.  
We need an architecture where:

1. The agent cannot unilaterally spend treasury funds.
2. Every payment requires human-presence approval via secure device authentication.
3. Approval and execution are low-friction and demo-ready for hackathon scope.

## 3. MVP Goals

1. End-to-end payment flow: `agent intent -> human approval via passkey -> onchain transfer`.
2. One onchain execution transaction per payment (`executeAuthorizedPayment`).
3. Strong replay/tamper protection (`nonce`, `deadline`, signed payload).
4. Clear audit trail (memo, events, transaction history).

## 4. Success Criteria (Hackathon MVP)

1. Agent cannot transfer from vault without fresh human signature.
2. Approved payment executes on Tempo testnet in under 30 seconds from approval.
3. All executed payments visible in chat history with tx hash + memo.
4. At least one blocked attempt is demonstrated (expired signature or replay nonce).

## 5. Scope

### In Scope

1. Tempo testnet deployment.
2. TIP-20 token transfers from a treasury vault contract.
3. Agent-generated intents with fixed fields (`to`, `token`, `amount`, `memo`, `nonce`, `deadline`).
4. Passkey-authenticated approval via a minimal one-page signing site.
5. Single function onchain execution with signature verification and policy checks.
6. Basic policy controls: token allowlist, recipient allowlist, max amount per transaction.

### Out of Scope (MVP)

1. Complex policy DSL or ML-based risk scoring.
2. Multi-user organizations and role hierarchies.
3. Fiat on/off-ramp integrations.
4. Cross-chain support.
5. Full production-grade key custody and incident tooling.
6. Dedicated backend API or database — agent holds all state.
7. Full web/mobile app — only a minimal approval page.

## 6. Architecture

### Components

1. **Smart Contract (Vault)** — On-chain vault that holds funds, verifies signatures, enforces policy, and executes transfers.
2. **AI Agent (OpenClaw)** — Orchestrates everything: creates intents, stores state, communicates with user via Telegram (or any messaging platform), submits approved transactions on-chain.
3. **Approval Page** — Minimal single-page static site. Agent sends a one-time link to the user. User taps link → sees intent details → confirms with passkey (Face ID / fingerprint) → signature returned to agent.

### Flow

```
Agent creates intent
    ↓
Agent sends approval link to user via Telegram
    ↓
User taps link → Approval Page opens
    ↓
User reviews intent details (amount, recipient, token, memo)
    ↓
User taps "Approve" → Passkey prompt (biometric)
    ↓
Signature returned to agent (via callback/webhook)
    ↓
Agent submits tx to vault contract with owner signature
    ↓
Contract verifies signature + policy → executes transfer
    ↓
Agent confirms execution to user in chat (tx hash + explorer link)
```

### Why No Backend?

- The **agent IS the backend.** It holds intent state in memory/local storage, tracks status, and submits transactions.
- The approval page is static — it only needs a one-time token, fetches intent data from a short-lived agent endpoint, and returns a passkey signature.
- This eliminates an entire service layer and keeps the architecture minimal for a 48-hour build.

## 7. Actors

1. **Human Owner** — Controls approval authority. Reviews and approves intents via passkey on the approval page. Communicates with agent via Telegram.
2. **AI Agent** — Proposes payments, manages intent lifecycle, submits approved transactions on-chain. Runs as an OpenClaw agent.
3. **Vault Contract** — Enforces signature + policy and executes transfers. Trust-minimized — doesn't care who calls it, only validates signatures.

## 8. Core User Journeys

### Journey A: Successful Payment

1. Agent creates intent for `10.00 AlphaUSD` to recipient with memo `task_123`.
2. Agent sends Telegram message: "💰 Payment request: 10 AlphaUSD to 0xABC... for task_123. [Approve →]"
3. User taps approval link → minimal page shows full intent details.
4. User taps Approve → passkey prompt (Face ID / fingerprint).
5. Signature returned to agent.
6. Agent submits tx to vault contract.
7. Contract validates and transfers token.
8. Agent sends confirmation in Telegram: "✅ Payment executed. Tx: [explorer link]"

### Journey B: Replayed Signature Attempt

1. Agent or attacker resubmits already-used signature.
2. Contract rejects due to consumed nonce.
3. Agent logs failed replay attempt.

### Journey C: Expired Intent

1. User approves near deadline, agent submits after expiry.
2. Contract rejects with expiry error.
3. Agent notifies user: "⏰ Payment expired, please request a new one."

### Journey D: User Rejects

1. Agent sends approval link.
2. User taps "Reject" on approval page (or ignores / lets it expire).
3. Agent marks intent as rejected/expired, notifies in chat.

## 9. Functional Requirements

### FR-01 Intent Format

Canonical payment intent fields:

1. `intentId` (`bytes32`, canonical id included in signed payload and on-chain struct)
2. `to` (address)
3. `token` (TIP-20 token address)
4. `amount` (uint256 base units)
5. `memo` (bytes32 or string encoded to bytes32)
6. `nonce` (uint256)
7. `deadline` (unix timestamp)
8. `chainId`
9. `verifyingContract`

Agent may also keep a human-friendly UUID off-chain, mapped to the canonical `bytes32 intentId`.

### FR-02 Human Approval

1. Approval page must show exact values (amount, token symbol, recipient, memo, deadline).
2. Approval must generate a cryptographic signature over the full intent payload via passkey.
3. No blind signing — all fields visible before confirmation.

### FR-03 Single Onchain Execute

The contract must expose:

`executeAuthorizedPayment(PaymentIntent intent, bytes ownerSig)`

Behavior:

1. Verify owner signature over typed intent payload.
2. Allow any caller to submit — execution authority comes from valid signature, not caller address.
3. Validate nonce unused and deadline not passed.
4. Validate policy (token/recipient/amount constraints).
5. Mark nonce as used.
6. Transfer TIP-20 tokens from vault to recipient.
7. Emit `PaymentExecuted`.

### FR-04 Policy Controls

At minimum:

1. `maxAmountPerPayment`
2. `allowedToken[token]`
3. `allowedRecipient[to]` (toggleable strict mode)

### FR-05 Status Tracking

Agent maintains intent status in local state:

1. `PENDING_APPROVAL` — link sent, awaiting user action
2. `APPROVED_SIGNED` — signature received from approval page
3. `SUBMITTED` — tx sent to chain
4. `EXECUTED` — tx confirmed
5. `FAILED` — tx reverted
6. `EXPIRED` — deadline passed without approval or execution
7. `REJECTED` — user explicitly rejected

### FR-06 Auditability

Every executed payment exposes (via chat + on-chain events):

1. On-chain event fields: `intentId`, `to`, `token`, `amount`, `memo`, `nonce`
2. Off-chain metadata: `txHash`
3. Timestamps: `createdAt`, `approvedAt`, `executedAt`
4. Actor metadata (agent id, owner id)

## 10. Smart Contract Requirements

### Data Structures

```solidity
struct PaymentIntent {
    bytes32 intentId;
    address to;
    address token;
    uint256 amount;
    bytes32 memo;
    uint256 nonce;
    uint256 deadline;
}
```

### Required Storage

1. `address public ownerSigner;`
2. `mapping(uint256 => bool) public usedNonces;`
3. Policy config storage (`maxAmountPerPayment`, allowlists, strict flags).

### Required Events

1. `PaymentExecuted(intentId, to, token, amount, memo, nonce)`
2. `PolicyUpdated(...)`

### Admin Functions (Owner only)

1. `setMaxAmountPerPayment(uint256)`
2. `setTokenAllowed(address, bool)`
3. `setRecipientAllowed(address, bool)`
4. `setRecipientAllowlistEnforced(bool)`
5. `pause() / unpause()`

## 11. Approval Page Requirements

### Single Page

One static page served from a simple host (Vercel, GitHub Pages, or agent-served).

### URL Schema

Agent generates a one-time approval URL containing only a short-lived opaque token:
`https://approve.example.com/approve?token=<approval_token>`

Token requirements:

1. Random, high-entropy, single-use token.
2. Short TTL (for example 5–10 minutes).
3. Server-side mapping to immutable intent payload and allowed callback route.
4. No raw intent fields or callback URL in query params.

### UI Elements

1. Intent details: amount, token, recipient address, memo, deadline countdown.
2. "Approve" button → triggers passkey authentication.
3. "Reject" button → sends rejection callback.
4. Deadline warning when < 60 seconds remain.

### Passkey Flow

1. Page loads `token`, fetches intent details from agent endpoint (or signed short-lived data endpoint).
2. Page calls WebAuthn API with stored intent hash as challenge.
3. User confirms with biometric.
4. Signature is posted to a fixed trusted endpoint bound to the token (not a user-controlled callback URL).
5. Agent verifies token validity, one-time use, expiry, and signed hash match before accepting.

## 12. Agent Requirements (OpenClaw)

### Capabilities

1. Create payment intents with unique nonce and deadline.
2. Store intent state locally (in-memory or file-based).
3. Generate one-time approval token and URL (no raw intent in URL).
4. Send approval request to user via Telegram (inline button with link).
5. Serve token lookup + signature submission endpoints for approval page.
6. Submit transaction to Tempo testnet.
7. Monitor tx confirmation.
8. Report execution result back to user in chat.

### Communication

- Primary channel: Telegram (inline buttons + messages).
- Agent uses OpenClaw messaging tools — no custom bot needed.

## 13. Security Requirements

1. Nonce replay protection enforced on-chain.
2. Signature domain separation includes chainId and verifying contract.
3. Deadline mandatory on all intents.
4. No unrestricted token approvals from vault.
5. Pausable emergency stop.
6. Approval page URLs are single-use (agent invalidates after use or expiry).
7. Passkey challenge must be bound to the exact intent hash.
8. Callback destination must be fixed/allowlisted server-side (never provided by user URL params).

## 14. Demo Acceptance Tests

1. **Happy path:** Agent creates intent → user approves via passkey → tx executes → balance changes → confirmation in chat.
2. **Replay test:** Resubmit same signature → contract reverts on used nonce.
3. **Expiry test:** Submit after deadline → contract reverts.
4. **Policy test:** Try disallowed token or over-limit amount → contract reverts.
5. **Agent bypass test:** Agent attempts direct transfer without owner sig → impossible/reverted.

## 15. Open Questions

1. Owner signature format: EIP-712 secp256k1 vs Tempo passkey-native signature wrapper — depends on Tempo SDK support.
2. Memo encoding standard: fixed bytes32 for `taskId`/`invoiceId`.
3. Approval page hosting: Vercel vs agent-served endpoint.
4. Callback mechanism: webhook POST vs WebSocket vs polling.

## 16. Build Plan (48 Hours)

### Day 1: Foundation (Hours 0–16)

1. **Spike passkey signing** — get a browser passkey signature that verifies on-chain. This is the critical path.
2. **Smart contract** — vault with `executeAuthorizedPayment`, nonce/deadline/policy checks. Deploy to Tempo testnet.
3. **Approval page** — minimal HTML/JS page with WebAuthn integration.

### Day 2: Integration + Demo (Hours 16–40)

4. **Agent integration** — OpenClaw agent that creates intents, sends TG messages with approval links, receives callbacks, submits tx.
5. **End-to-end flow** — wire everything together and test all 5 demo scenarios.
6. **Polish** — clean up chat UX, add explorer links, record demo video.

### Hours 40–48: Buffer + Submission

7. Final testing, README, submission form.

### Must Ship

1. Contract with execute + nonce/deadline/policy.
2. Agent creates intents + sends approval links via Telegram.
3. Approval page with passkey signing.
4. Agent submits tx + confirms in chat.

### If Time Remains

1. Fee sponsorship path.
2. Recipient/token allowlist management via chat commands.
3. Intent history command in chat.
4. Rich analytics dashboard.
