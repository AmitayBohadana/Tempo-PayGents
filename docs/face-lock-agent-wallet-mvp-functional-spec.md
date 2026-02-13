# FaceLock Agent Wallet MVP Functional Specification

Date: February 13, 2026  
Status: Draft v1

## 1. Product Summary

FaceLock Agent Wallet is a human-in-the-loop payment system for AI agents on Tempo.  
The agent can prepare payment intents, but funds move only when the human approves the exact intent with passkey authentication on mobile (Face ID / Touch ID device unlock).

## 2. Problem Statement

If an AI agent controls a normal private key, it can spend funds without human consent.  
We need an architecture where:

1. The agent cannot unilaterally spend treasury funds.
2. Every payment requires human biometric-gated approval.
3. Approval and execution are low-friction and demo-ready for hackathon scope.

## 3. MVP Goals

1. End-to-end payment flow: `agent intent -> phone approval -> onchain transfer`.
2. One onchain execution transaction per payment (`executeAuthorizedPayment`).
3. Strong replay/tamper protection (`nonce`, `deadline`, signed payload).
4. Clear audit trail (memo, events, transaction history).

## 4. Success Criteria (Hackathon MVP)

1. Agent cannot transfer from vault without fresh human signature.
2. Approved payment executes on Tempo testnet in under 30 seconds from approval click.
3. All executed payments are visible in app history with tx hash + memo.
4. At least one blocked attempt is demonstrated (expired signature or replay nonce).

## 5. Scope

### In Scope

1. Tempo testnet deployment.
2. TIP-20 token transfers from a treasury vault contract.
3. Agent-generated intents with fixed fields (`to`, `token`, `amount`, `memo`, `nonce`, `deadline`).
4. Mobile approval flow using passkey-authenticated wallet session.
5. Single function onchain execution with signature verification and policy checks.
6. Basic policy controls: token allowlist, recipient allowlist, max amount per transaction.

### Out of Scope (MVP)

1. Complex policy DSL or ML-based risk scoring.
2. Multi-user organizations and role hierarchies.
3. Fiat on/off-ramp integrations.
4. Cross-chain support.
5. Full production-grade key custody and incident tooling.

## 6. Actors

1. Human Owner: controls approval authority via passkey-enabled app session.
2. Agent Service: proposes payments for tasks/invoices/subscriptions.
3. Relayer/Backend: submits approved payloads to chain and tracks status.
4. Vault Contract: enforces signature + policy and executes transfer.

## 7. High-Level Architecture

1. Agent API creates a payment intent.
2. Backend stores intent and pushes notification to owner mobile app.
3. Owner opens app, reviews details, approves with passkey flow (Face ID gate by device).
4. App returns signature payload.
5. Relayer sends one transaction to `executeAuthorizedPayment`.
6. Contract verifies and executes or reverts.

## 8. Core User Journeys

### Journey A: Successful Payment

1. Agent creates intent for `10.00 AlphaUSD` to recipient with memo `task_123`.
2. Owner receives pending request and opens detail screen.
3. Owner taps Approve and completes passkey prompt.
4. Relayer submits signed payload.
5. Contract validates and transfers token.
6. UI updates to `Executed` with tx hash.

### Journey B: Replayed Signature Attempt

1. Relayer or attacker resubmits already used signature.
2. Contract rejects due to consumed nonce.
3. UI shows failed replay attempt in logs.

### Journey C: Expired Intent

1. Owner signs near expiry, submission happens after deadline.
2. Contract rejects with expiry error.
3. Intent status is marked `Expired`.

## 9. Functional Requirements

### FR-01 Intent Format

The system must define canonical payment intent fields:

1. `intentId` (uuid/offchain id)
2. `to` (address)
3. `token` (TIP-20 token address)
4. `amount` (uint256 base units)
5. `memo` (bytes32 or string encoded to bytes32)
6. `nonce` (uint256)
7. `deadline` (unix timestamp)
8. `chainId`
9. `verifyingContract`

### FR-02 Human Approval

1. Owner must see exact values before approval.
2. Approval must generate a cryptographic signature over the full intent payload.
3. App must not allow blind signing (no hidden fields).

### FR-03 Single Onchain Execute

The contract must expose:

`executeAuthorizedPayment(PaymentIntent intent, bytes ownerSig, bytes agentSig)`

Behavior:

1. Verify owner signature over typed intent payload.
2. Verify agent signature from registered agent key.
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

Offchain intent status model:

1. `PENDING_APPROVAL`
2. `APPROVED_SIGNED`
3. `SUBMITTED`
4. `EXECUTED`
5. `FAILED`
6. `EXPIRED`
7. `REJECTED`

### FR-06 Auditability

Every executed payment must expose:

1. `txHash`
2. `intentId`
3. `memo`
4. `createdAt`, `approvedAt`, `executedAt`
5. `actor` metadata (agent id, owner id)

## 10. Smart Contract Requirements

### Data Structures

```solidity
struct PaymentIntent {
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
2. `address public agentSigner;`
3. `mapping(uint256 => bool) public usedNonces;`
4. Policy config storage (`maxAmountPerPayment`, allowlists, strict flags).

### Required Events

1. `PaymentExecuted(...)`
2. `PaymentRejected(...)` (optional, helpful for observability)
3. `PolicyUpdated(...)`
4. `AgentSignerUpdated(...)`

### Admin Functions (Owner only)

1. `setAgentSigner(address)`
2. `setMaxAmountPerPayment(uint256)`
3. `setTokenAllowed(address,bool)`
4. `setRecipientAllowed(address,bool)`
5. `setRecipientAllowlistEnforced(bool)`
6. `pause()/unpause()`

## 11. Backend/API Requirements (MVP)

### Endpoints

1. `POST /api/intents`
2. `GET /api/intents?status=...`
3. `GET /api/intents/:id`
4. `POST /api/intents/:id/approve-signature` (owner signature payload upload)
5. `POST /api/intents/:id/reject`
6. `POST /api/intents/:id/submit`

### Minimal Validation

1. Prevent duplicate `intentId`.
2. Enforce canonical encoding before requesting signature.
3. Ensure only owner session can submit approval signature.
4. Ensure only agent service auth token can create intents.

## 12. Mobile/Web App Requirements

### Screens

1. Pending approvals list.
2. Intent detail (all signed fields shown).
3. Approval confirmation with passkey prompt.
4. History list with status and tx explorer link.
5. Settings (pause switch + basic policy values, optional if time permits).

### UX Rules

1. Amount, token, and recipient must be visually prominent.
2. Deadline warning shown when < 60 seconds remains.
3. Reject action requires one confirmation tap.
4. After approval, status must auto-refresh to execution result.

## 13. Security Requirements

1. Nonce replay protection enforced onchain.
2. Signature domain separation includes chain and contract.
3. Deadline mandatory on all intents.
4. No unrestricted token approvals from vault.
5. Pausable emergency stop.
6. Agent key rotation supported.
7. Rate limit intent creation API.

## 14. Observability

1. Backend logs for each state transition.
2. Onchain event index for executed/rejected payments.
3. Basic metrics:
   - `intent_created_total`
   - `intent_approved_total`
   - `intent_executed_total`
   - `intent_failed_total`
   - `approval_to_execute_ms`

## 15. Demo Acceptance Tests

1. Happy path:
   - Create intent.
   - Approve with passkey.
   - Execute and verify recipient balance change.
2. Replay test:
   - Re-submit same payload.
   - Expect revert on used nonce.
3. Expiry test:
   - Submit after `deadline`.
   - Expect revert.
4. Policy test:
   - Try disallowed token or recipient.
   - Expect revert.
5. Agent bypass test:
   - Agent attempts direct transfer path.
   - Confirm impossible/reverted.

## 16. Open Questions

1. Owner signature format: EIP-712 secp256k1 wallet signature vs Tempo passkey-native signature wrapper.
2. Whether to require both `ownerSig` and `agentSig` in MVP, or only owner authorization.
3. Preferred relayer model: app-submitted tx vs backend relay.
4. Memo standard: fixed bytes32 encoding schema for `taskId`/`invoiceId`.

## 17. Build Plan Alignment (48-Hour Reality)

### Must Ship

1. Contract with single execute function + nonce/deadline/policy checks.
2. Agent creates intents.
3. Owner approves and signs in app.
4. Relayer submits one tx.
5. History + explorer links.

### If Time Remains

1. Fee sponsorship path.
2. Recipient allowlist UI.
3. Better notifications.
4. Rich analytics.

