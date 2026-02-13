# Human-Verified Agent Wallet Technical Implementation Specification

Date: February 13, 2026  
Status: Draft v2.2

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
2. Use Tempo-native passkey/account authorization path (fast lane target).
3. Hardcode Tempo authorization validation path in vault contract (no pluggable verifier code in MVP).
4. Enforce intent-based policy controls in vault contract.
5. Run end-to-end flow through agent + approval page + contract.

### 2.2 Post-Hackathon Scope

1. Add EVM-portable authorization verifier mode and pluggable verifier architecture.
2. Keep business logic and intent schema unchanged.
3. Refactor to verifier adapter without redesigning the product workflow.

### 2.3 Delivery Principle

1. Favor shipping the smallest reliable path for demo over abstraction purity.
2. Anything not required for a successful demo is deferred to post-hackathon.

### 2.4 Current Implementation Snapshot (Branch `codex/dev`)

1. Implemented now:
   - Agent intent lifecycle + persistence.
   - Tokenized approval flow (`/approve`, `/api/approval/:token`).
   - Policy guardrails (`maxAmount`, token allowlist, recipient allowlist).
   - OpenClaw command endpoint (`/api/commands`) for `request_payment`, `set_policy`, `get_policy`, `list_intents`, `get_intent`.
   - Outbound message payload builder for Telegram-compatible text.
   - EVM-compatible digest encoding aligned with vault type-hash rules.
2. Intentionally demo-scaffolded for speed:
   - Mock chain submitter instead of live Tempo transaction path.
   - Approval artifact is converted by backend relay signer into contract-ready `ownerAuth`.
   - Tempo-native passkey verification in contract path is still pending.
3. Required before final Tempo demo hardening:
   - Replace mock submitter with Tempo chain submitter.
   - Replace relay signer bridge with Tempo-native owner-auth verification path.
   - Run contract and E2E tests listed in section 15.

## 3. System Architecture

### 3.1 Runtime Components

1. `Vault Contract`
2. `Agent Service` (OpenClaw runtime)
3. `Approval Page` (static frontend)
4. `Telegram Channel` (user interaction surface)

### 3.2 Responsibility Split

1. Vault contract:
   - Final authorization and policy enforcement.
   - Replay/expiry prevention.
   - Token transfer execution.
2. Agent service:
   - Intent lifecycle and persistence.
   - One-time approval token issuance.
   - Callback handling.
   - Transaction submission and status updates.
   - Return outbound notification payloads for bot runtimes.
3. Approval page:
   - Display intent details.
   - Trigger passkey/account approval flow.
   - Submit authorization artifact or reject action.

## 4. Recommended Repo Layout

```text
Temp-Hack/
  contracts/
    AgentGuardVault.sol
  agent/
    src/
      core/
        intent-store.ts
        state-machine.ts
        intent-service.ts
        owner-auth.ts
      chain/
        mock-chain.ts
        evm-chain.ts
      server.ts
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

Post-hackathon (Phase 2), add:

```text
contracts/
  verifiers/
    IAuthVerifier.sol
    TempoAuthVerifier.sol
    PortableEvmAuthVerifier.sol
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
8. Validate `ownerAuth` via Tempo-native authorization check (`_validateTempoOwnerAuth(ownerRef, digest, ownerAuth)`).
9. Mark nonce as used.
10. Execute TIP-20 transfer.
11. Emit `PaymentExecuted`.

### 5.4 Replay and Reentrancy

1. Mark nonce before external token transfer call.
2. Use reentrancy guard on execute function.
3. Keep transfer path minimal (single TIP-20 call).

### 5.5 Storage

1. `bytes32 public ownerRef;`
2. `mapping(uint256 => bool) public usedNonces;`
3. `uint256 public maxAmountPerPayment;`
4. `mapping(address => bool) public allowedToken;`
5. `mapping(address => bool) public allowedRecipient;`
6. `bool public recipientAllowlistEnforced;`

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
event OwnerRefUpdated(bytes32 indexed ownerRef);
```

### 5.7 Admin Functions

1. `setOwnerRef(bytes32 ownerRef)`
2. `setMaxAmountPerPayment(uint256 amount)`
3. `setTokenAllowed(address token, bool allowed)`
4. `setRecipientAllowed(address recipient, bool allowed)`
5. `setRecipientAllowlistEnforced(bool enabled)`
6. `pause()`
7. `unpause()`

## 6. Authorization Strategy

### 6.1 MVP Decision (Hackathon)

1. Do not implement pluggable verifier contracts in MVP.
2. Keep contract-side `_validateTempoOwnerAuth` shape aligned to digest-bound authorization.
3. Use backend relay-signer adapter for current demo path:
   - Validate artifact digest consistency.
   - Sign digest server-side with configured signer.
   - Encode contract-ready `ownerAuth` as `abi.encode(address signer, bytes signature)`.
4. Keep the contract surface minimal to maximize shipping probability.

### 6.2 Phase 2 Refactor Plan

1. Extract authorization logic behind `IAuthVerifier` after hackathon.
2. Add `TempoAuthVerifier` and `PortableEvmAuthVerifier`.
3. Migrate vault to delegate auth checks to the verifier adapter.

### 6.3 Why This Split

1. MVP risk is dominated by Tempo passkey/account integration.
2. Abstraction adds code and test surface without improving demo quality.
3. Portability still remains feasible because intent schema and execute flow stay unchanged.

### 6.4 Relay Signer Bridge (Current State)

1. Approval page submits base64 JSON artifact (contains digest and method metadata).
2. Agent validates artifact digest against stored intent digest.
3. Agent relay signer signs digest and emits ABI-encoded payload for contract verification path.
4. `GET /api/auth/relay` returns relay signer address and computed `ownerRef` for contract setup.

## 7. Digest and Intent Canonicalization

### 7.1 Intent Digest Rules

1. Deterministic typed encoding for:
   - `intentId`, `to`, `token`, `amount`, `memo`, `nonce`, `deadline`
2. Domain separation must include:
   - `chainId`
   - `verifyingContract`
3. Any field change must change digest.
4. `amount` must be encoded as base units (`uint256`) for digest and calldata.
5. `memo` text must be converted to `bytes32` (`keccak256(utf8(memo))`) for digest and calldata.

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
   - Out of backend scope for multi-bot architecture.
   - OpenClaw bots send Telegram messages themselves.
7. `OutboundMessageBuilder`:
   - Produces channel-ready message payloads returned by backend.

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
5. `amountBaseUnits`
6. `memo`
7. `memoHash`
8. `deadline`
9. `digest`
10. `expiresAt`

### 10.2 `POST /api/approval/:token/approve`

Request:

1. `ownerAuth`
2. `digest` (echo for consistency check)

Behavior:

1. Validate token active and unconsumed.
2. Validate intent deadline not exceeded.
3. Validate token-intent binding.
4. Validate digest match.
5. Validate artifact digest binding.
6. Convert artifact -> contract-ready `ownerAuth` bytes.
7. Persist both artifact and contract-ready `ownerAuth`.
8. Transition to `APPROVED_AUTHORIZED`.

### 10.3 `POST /api/approval/:token/reject`

Behavior:

1. Validate token active and unconsumed.
2. Mark token consumed.
3. Transition to `REJECTED`.

### 10.4 `POST /api/commands`

Request:

1. `command`: one of `request_payment | set_policy | get_policy | list_intents | get_intent`
2. `args`: command-specific payload

Behavior:

1. Provides a single integration point for OpenClaw-style tool calls.
2. For `request_payment`, returns `intent`, `approvalUrl`, and outbound `messages`.
3. Does not send Telegram directly; caller bot is responsible for delivery.

### 10.5 `GET /api/auth/relay`

Response:

1. `relaySigner` (address)
2. `ownerRef` (`keccak256(abi.encodePacked(relaySigner))`)
3. `chainSubmitterMode` (`mock | evm`)

## 11. Chain Submission Flow

1. Watch intents in `APPROVED_AUTHORIZED`.
2. Build calldata for `executeAuthorizedPayment(intent, ownerAuth)`.
3. Submit transaction.
4. Move to `SUBMITTED`.
5. Poll receipt until final.
6. On success:
   - Set `EXECUTED`.
   - Save `txHash`.
   - Return outbound success message payload.
7. On failure:
   - Set `FAILED`.
   - Save error reason.
   - Return outbound failure message payload.

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
7. Deadline/token expiry enforcement before approval acceptance in backend.
8. Pause control for incident response.
9. Allowlist controls for token and recipient.
10. Structured error codes for client-safe messaging.

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

### 14.2 MVP Logging Output

1. Emit structured JSON logs only (no metrics backend required for MVP).
2. Post-hackathon, add metrics once runtime and dashboards exist.

## 15. Testing Strategy

### 15.1 Contract Tests

1. Valid authorization executes transfer.
2. Replay nonce reverts.
3. Expired deadline reverts.
4. Disallowed token reverts.
5. Over-limit amount reverts.
6. Disallowed recipient reverts when enforcement is enabled.
7. Pause blocks execution.

### 15.2 Optional Agent Unit Tests (If Time Remains)

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

1. Spike Tempo passkey/account integration (go/no-go gate):
   - Obtain authorization artifact for known digest.
   - Verify contract can validate artifact in Tempo-native path.
   - If blocked, activate fallback demo auth path and continue delivery.
2. Implement minimal vault contract with hardcoded Tempo auth validation.
3. Build approval page with tokenized URL flow and passkey/account authorize action.
4. Deploy to Tempo testnet and prove one happy-path transfer.

### 16.2 Day 2

1. Implement agent intent store + state machine.
2. Implement tokenized approval endpoints and callback handling.
3. Implement chain submitter and receipt tracking.
4. Integrate Telegram notifications and approval links.
5. Run full demo scenario suite (happy path, replay, expiry, reject).

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
