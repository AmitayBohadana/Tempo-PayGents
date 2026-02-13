# Human-Verified Agent Wallet Technical Implementation Specification

Date: February 13, 2026  
Status: Draft v1

## 1. Purpose

This document defines the concrete technical implementation plan for the Human-Verified Agent Wallet MVP.

It translates the functional spec into:

1. Contract interfaces and validation order.
2. Agent runtime architecture and state model.
3. Approval-page protocol and callback flow.
4. Security controls, test strategy, and delivery milestones.

## 2. Scope and Strategy

### 2.1 MVP Scope (Hackathon)

1. Deploy on Tempo testnet.
2. Use Tempo-native passkey/account authorization path (fast lane).
3. Enforce intent-based policy controls in vault contract.
4. Run end-to-end flow through agent + approval page + contract.

### 2.2 Post-Hackathon Scope

1. Add EVM-portable authorization verifier mode.
2. Keep business logic and intent schema unchanged.
3. Switch verifier adapter without redesigning the product workflow.

## 3. System Architecture

### 3.1 Runtime Components

1. `Vault Contract`
2. `Auth Verifier Module` (pluggable)
3. `Agent Service` (OpenClaw runtime)
4. `Approval Page` (static frontend)
5. `Telegram Channel` (user interaction surface)

### 3.2 Responsibility Split

1. Vault contract:
   - Final authorization and policy enforcement.
   - Replay/expiry prevention.
   - Token transfer execution.
2. Auth verifier module:
   - Decode/validate `ownerAuth`.
   - Return boolean authorization verdict for digest + owner reference.
3. Agent service:
   - Intent lifecycle and persistence.
   - One-time approval token issuance.
   - Callback handling.
   - Transaction submission and status updates.
4. Approval page:
   - Display intent details.
   - Trigger passkey/account approval flow.
   - Submit authorization artifact or reject action.

## 4. Recommended Repo Layout

```text
Temp-Hack/
  contracts/
    AgentGuardVault.sol
    verifiers/
      IAuthVerifier.sol
      TempoAuthVerifier.sol
      PortableEvmAuthVerifier.sol   # Phase 2
  agent/
    src/
      core/
        intent-store.ts
        intent-state-machine.ts
        policy.ts
      adapters/
        telegram.ts
        chain.ts
      auth/
        auth-adapter.ts
        tempo-auth-adapter.ts
      server/
        routes-approval.ts
        routes-callback.ts
      index.ts
    data/
      intents.json
  approval-page/
    src/
      app.ts
      api.ts
      ui.ts
  docs/
    human-verified-agent-wallet-mvp-functional-spec.md
    human-verified-agent-wallet-technical-implementation-spec.md
```

## 5. Contract Specification

### 5.1 Core Types

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

### 5.2 Main Entry Point

```solidity
function executeAuthorizedPayment(
    PaymentIntent calldata intent,
    bytes calldata ownerAuth
) external;
```

### 5.3 Validation Order (Must Keep This Order)

1. `whenNotPaused`.
2. `block.timestamp <= intent.deadline`.
3. `usedNonces[intent.nonce] == false`.
4. `intent.amount <= maxAmountPerPayment`.
5. `allowedToken[intent.token] == true`.
6. `if (recipientAllowlistEnforced) allowedRecipient[intent.to] == true`.
7. Build deterministic digest for intent.
8. Call verifier: `IAuthVerifier(authVerifier).isValidOwnerAuth(ownerRef, digest, ownerAuth)`.
9. Mark nonce as used.
10. Execute TIP-20 transfer.
11. Emit `PaymentExecuted`.

### 5.4 Replay and Reentrancy

1. Mark nonce before external token transfer call.
2. Use reentrancy guard on execute function.
3. Keep transfer path minimal (single TIP-20 call).

### 5.5 Storage

1. `bytes32 public ownerRef;`
2. `address public authVerifier;`
3. `mapping(uint256 => bool) public usedNonces;`
4. `uint256 public maxAmountPerPayment;`
5. `mapping(address => bool) public allowedToken;`
6. `mapping(address => bool) public allowedRecipient;`
7. `bool public recipientAllowlistEnforced;`

### 5.6 Events

```solidity
event PaymentExecuted(
    bytes32 indexed intentId,
    address indexed to,
    address indexed token,
    uint256 amount,
    bytes32 memo,
    uint256 nonce
);
event PolicyUpdated(bytes32 indexed key, bytes value);
event AuthVerifierUpdated(address indexed verifier);
event OwnerRefUpdated(bytes32 indexed ownerRef);
```

### 5.7 Admin Functions

1. `setOwnerRef(bytes32 ownerRef)`
2. `setAuthVerifier(address verifier)`
3. `setMaxAmountPerPayment(uint256 amount)`
4. `setTokenAllowed(address token, bool allowed)`
5. `setRecipientAllowed(address recipient, bool allowed)`
6. `setRecipientAllowlistEnforced(bool enabled)`
7. `pause()`
8. `unpause()`

## 6. Authorization Verifier Interface

### 6.1 Interface

```solidity
interface IAuthVerifier {
    function isValidOwnerAuth(
        bytes32 ownerRef,
        bytes32 digest,
        bytes calldata ownerAuth
    ) external view returns (bool);
}
```

### 6.2 Mode A: Tempo Fast Lane (MVP)

1. Implement `TempoAuthVerifier`.
2. Validate `ownerAuth` according to Tempo-native account/passkey authorization primitives.
3. Keep decoding logic isolated in this module.

### 6.3 Mode B: Portable EVM (Phase 2)

1. Implement `PortableEvmAuthVerifier`.
2. Validate digest using standard EVM signature/account checks.
3. Support contract-account verification path and EOA-compatible path.

## 7. Digest and Intent Canonicalization

### 7.1 Intent Digest Rules

1. Deterministic typed encoding for:
   - `intentId`, `to`, `token`, `amount`, `memo`, `nonce`, `deadline`
2. Domain separation must include:
   - `chainId`
   - `verifyingContract`
3. Any field change must change digest.

### 7.2 Offchain Intent ID Mapping

1. Agent keeps a human-readable ID (UUID) for chat UX.
2. Agent computes canonical `bytes32 intentId`.
3. Mapping persisted in intent store for reconciliation.

## 8. Agent Service Technical Design

### 8.1 Internal Modules

1. `IntentStore`:
   - File-backed JSON persistence (`agent/data/intents.json`) for MVP.
   - Atomic write strategy (`temp file` + `rename`) to avoid corruption.
2. `IntentStateMachine`:
   - Allowed transitions only.
3. `ApprovalTokenService`:
   - Generates high-entropy token.
   - Stores single-use token metadata and expiry.
4. `ApprovalApi`:
   - Token lookup endpoint.
   - Approve/reject callback endpoints.
5. `ChainSubmitter`:
   - Builds transaction payload.
   - Sends transaction.
   - Polls confirmation.
6. `TelegramAdapter`:
   - Sends approval messages, result notifications, and error updates.

### 8.2 Intent States

1. `PENDING_APPROVAL`
2. `APPROVED_AUTHORIZED`
3. `SUBMITTED`
4. `EXECUTED`
5. `FAILED`
6. `EXPIRED`
7. `REJECTED`

### 8.3 Allowed State Transitions

1. `PENDING_APPROVAL -> APPROVED_AUTHORIZED`
2. `PENDING_APPROVAL -> REJECTED`
3. `PENDING_APPROVAL -> EXPIRED`
4. `APPROVED_AUTHORIZED -> SUBMITTED`
5. `SUBMITTED -> EXECUTED`
6. `SUBMITTED -> FAILED`
7. `APPROVED_AUTHORIZED -> EXPIRED` (if submission delayed)

### 8.4 Agent Persistence Schema

```json
{
  "intentIdHuman": "uuid",
  "intentId": "0x...",
  "to": "0x...",
  "token": "0x...",
  "amount": "1000000",
  "memo": "0x...",
  "nonce": 42,
  "deadline": 1760000000,
  "status": "PENDING_APPROVAL",
  "approvalToken": "opaque",
  "approvalTokenExpiresAt": 1760000300,
  "ownerAuth": null,
  "txHash": null,
  "errorCode": null,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

## 9. Approval Page Technical Design

### 9.1 URL Contract

`GET /approve?token=<approval_token>`

### 9.2 Data Fetch

1. Page calls `GET /api/approval/<token>`.
2. API returns immutable intent payload + display metadata.
3. If token invalid/expired/used, page shows terminal error state.

### 9.3 Approve Flow

1. User presses `Approve`.
2. Page invokes passkey/account auth flow for exact intent digest.
3. Page sends `POST /api/approval/<token>/approve` with authorization artifact.
4. Backend marks token used and updates intent state.

### 9.4 Reject Flow

1. User presses `Reject`.
2. Page sends `POST /api/approval/<token>/reject`.
3. Backend marks token used and sets intent to `REJECTED`.

## 10. API Contract (Agent-Hosted)

### 10.1 `GET /api/approval/:token`

Response:

1. `intentId`
2. `to`
3. `token`
4. `amount`
5. `memo`
6. `deadline`
7. `digest`
8. `expiresAt`

### 10.2 `POST /api/approval/:token/approve`

Request:

1. `ownerAuth`
2. `digest` (echo for consistency check)

Behavior:

1. Validate token active and unconsumed.
2. Validate token-intent binding.
3. Validate digest match.
4. Persist `ownerAuth`.
5. Transition to `APPROVED_AUTHORIZED`.

### 10.3 `POST /api/approval/:token/reject`

Behavior:

1. Validate token active and unconsumed.
2. Mark token consumed.
3. Transition to `REJECTED`.

## 11. Chain Submission Flow

1. Watch intents in `APPROVED_AUTHORIZED`.
2. Build calldata for `executeAuthorizedPayment(intent, ownerAuth)`.
3. Submit transaction.
4. Move to `SUBMITTED`.
5. Poll receipt until final.
6. On success:
   - Set `EXECUTED`.
   - Save `txHash`.
   - Send Telegram success message.
7. On failure:
   - Set `FAILED`.
   - Save error reason.
   - Send Telegram failure message.

## 12. Policy Enforcement Model

### 12.1 Offchain Pre-Check (Optional)

1. Agent can pre-check policy for UX.
2. Pre-check does not replace contract checks.

### 12.2 Onchain Enforcement (Authoritative)

1. All policy decisions are finalized in contract.
2. Any mismatch or stale policy causes revert.

## 13. Security Implementation Controls

1. One-time approval token with strict TTL.
2. No raw callback URL from user-controlled params.
3. No raw intent payload in approval URL.
4. Domain-separated digest (`chainId`, `verifyingContract`).
5. Nonce replay lock onchain.
6. Deadline enforcement onchain.
7. Pause control for incident response.
8. Allowlist controls for token and recipient.
9. Structured error codes for client-safe messaging.

## 14. Observability and Logging

### 14.1 Structured Log Fields

1. `intentId`
2. `stateFrom`
3. `stateTo`
4. `tokenId`
5. `nonce`
6. `txHash`
7. `errorCode`
8. `timestamp`

### 14.2 Metrics

1. `intent_created_total`
2. `intent_approved_total`
3. `intent_submitted_total`
4. `intent_executed_total`
5. `intent_failed_total`
6. `approval_latency_ms`
7. `submission_latency_ms`

## 15. Testing Strategy

### 15.1 Contract Tests

1. Valid authorization executes transfer.
2. Replay nonce reverts.
3. Expired deadline reverts.
4. Disallowed token reverts.
5. Over-limit amount reverts.
6. Disallowed recipient reverts when enforcement is enabled.
7. Pause blocks execution.

### 15.2 Agent Unit Tests

1. State machine rejects invalid transitions.
2. Approval tokens expire and cannot be reused.
3. Digest mismatch is rejected.
4. Approve/reject endpoints consume token exactly once.

### 15.3 End-to-End Tests

1. Happy path:
   - Intent created.
   - Approval completed.
   - Transaction executed.
   - Telegram confirmation sent.
2. Replay attempt:
   - Resubmission fails onchain.
3. Reject path:
   - No submission attempt after reject.

## 16. Delivery Plan

### 16.1 Day 1

1. Implement vault contract and verifier interface.
2. Deploy to Tempo testnet.
3. Implement agent intent store + state machine.
4. Implement tokenized approval endpoints.

### 16.2 Day 2

1. Build approval page and passkey/account flow integration.
2. Wire callbacks to agent store.
3. Implement chain submitter and receipt tracking.
4. Integrate Telegram notifications.
5. Run full demo scenario suite.

### 16.3 Buffer

1. Harden error handling.
2. Improve operator logs.
3. Prepare demo script and README.

## 17. Definition of Done

1. End-to-end flow is functional on Tempo testnet.
2. All critical security checks are enforced onchain.
3. Replay and expiry demos are proven.
4. Approval URL is tokenized and tamper-resistant.
5. Technical documentation is aligned with functional spec decisions.

