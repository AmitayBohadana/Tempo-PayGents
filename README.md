# Temp-Hackathon

Canteen x Tempo Hackathon submission.

## MVP Scaffold

This repo now includes a runnable MVP scaffold for:

1. tokenized payment intent approvals,
2. agent-managed intent lifecycle,
3. approval web page UX,
4. vault contract with nonce/deadline/policy checks.

## Project Structure

1. `agent/` - Node + TypeScript service (intent creation, approval APIs, submission flow).
2. `approval-page/` - static approval UI served by the agent.
3. `contracts/` - `AgentGuardVault.sol` contract skeleton.
4. `docs/` - functional + technical specs.

## Run Locally

```bash
npm install
npm run dev
```

Server defaults to `http://localhost:8787`.
Amount values are accepted as decimal strings and normalized to base units with `TOKEN_DECIMALS` (default `6`) for digest compatibility.

### Tempo-Native Passkey Execution (Current Approval Page)

The approval page uses Tempo-native passkeys (WebAuthnP256) to **sign and submit a real Tempo transaction** directly from the browser using `viem/tempo`:

1. User taps `Approve with Passkey`.
2. Browser prompts Face ID / Touch ID / device PIN (passkey).
3. A TIP-20 `transferWithMemo` is sent on Tempo testnet:
   - Fees are sponsored (fee payer) via `POST /api/sponsor` (proxy).
   - RPC is accessed via `POST /api/rpc` (proxy).
   - `nonceKey` is set to the intent nonce (2D nonces), and `validBefore` is set to the intent deadline.
4. The page then calls `POST /api/approval/:token/confirm` with the resulting `txHash` to mark the intent `EXECUTED`.

By default, the RPC proxy targets `https://rpc.moderato.tempo.xyz` and the sponsor proxy targets `https://sponsor.moderato.tempo.xyz`.
Override with:

1. `TEMPO_RPC_URL`
2. `TEMPO_SPONSOR_URL`

Chain submitter modes:

1. `CHAIN_SUBMITTER=mock` (default) - mock tx hash path with signature validation checks.
2. `CHAIN_SUBMITTER=evm` - real contract call path.

When `CHAIN_SUBMITTER=evm`, set:

1. `EVM_RPC_URL`
2. `EVM_RELAYER_PRIVATE_KEY`
3. `VAULT_CONTRACT_ADDRESS`
4. Optional: `EVM_CONFIRMATIONS` (default `1`)
5. `VERIFYING_CONTRACT` must be equal to `VAULT_CONTRACT_ADDRESS` in `evm` mode.

Owner-auth relay signer:

1. Backend converts approval artifact to contract-ready `ownerAuth` bytes.
2. Override signer with `OWNER_SIGNER_PRIVATE_KEY` (dev default is used if unset).
3. Use `GET /api/auth/relay` to get relay signer + computed `ownerRef` for vault setup.

## Tempo Testnet Runbook

Tempo testnet (Moderato) commonly uses:

1. `CHAIN_ID=42431`
2. `EVM_RPC_URL=https://rpc.moderato.tempo.xyz`

Deploy a new vault contract:

```bash
EVM_RPC_URL=https://rpc.moderato.tempo.xyz \
CHAIN_ID=42431 \
EVM_CHAIN_ID=42431 \
EVM_DEPLOYER_PRIVATE_KEY=0x... \
OWNER_SIGNER_PRIVATE_KEY=0x... \
MAX_AMOUNT_BASE_UNITS=100000000 \
npm run deploy:vault
```

Configure vault policy/admin state (run after deploy):

```bash
EVM_RPC_URL=https://rpc.moderato.tempo.xyz \
CHAIN_ID=42431 \
EVM_CHAIN_ID=42431 \
EVM_OWNER_PRIVATE_KEY=0x... \
VAULT_CONTRACT_ADDRESS=0x... \
OWNER_SIGNER_PRIVATE_KEY=0x... \
ALLOWED_TOKENS=0x... \
MAX_AMOUNT_BASE_UNITS=100000000 \
RECIPIENT_ALLOWLIST_ENFORCED=false \
npm run configure:vault
```

Run backend against real chain:

```bash
CHAIN_SUBMITTER=evm \
CHAIN_ID=42431 \
EVM_RPC_URL=https://rpc.moderato.tempo.xyz \
EVM_RELAYER_PRIVATE_KEY=0x... \
VAULT_CONTRACT_ADDRESS=0x... \
VERIFYING_CONTRACT=0x... \
OWNER_SIGNER_PRIVATE_KEY=0x... \
npm run dev
```

## Demo Flow

1. Create an intent:

```bash
curl -X POST http://localhost:8787/api/intents \
  -H 'content-type: application/json' \
  -d '{
    "to":"0x1111111111111111111111111111111111111111",
    "token":"0x2222222222222222222222222222222222222222",
    "amount":"33.00",
    "memo":"order_8472",
    "merchantName":"Tempo Merch",
    "itemName":"Tempo Tee Black M"
  }'
```

2. Open `approvalUrl` from response in browser.
3. Click `Approve With Passkey` on page.
4. The approval page submits a real Tempo testnet transaction and then confirms it back to the backend.

## Useful API Endpoints

1. `GET /api/intents` - list all intents.
2. `GET /api/intents/:intentId` - fetch one intent.
3. `GET /api/intents/:intentId/messages` - get Telegram-ready outbound message payload.
4. `PATCH /api/policy` - update guardrails (`maxAmount`, token/recipient allowlists, enforcement toggles).
5. `GET /api/policy` - view current guardrail policy.
6. `POST /api/commands` - single command endpoint for OpenClaw/tool orchestration.
7. `GET /api/auth/relay` - show relay signer address and `ownerRef`.
8. `POST /api/approval/:token/confirm` - mark intent executed with `txHash` (used by passkey approval page).
9. `POST /api/rpc` - Tempo JSON-RPC proxy for browser clients.
10. `POST /api/sponsor` - Tempo sponsorship JSON-RPC proxy for browser clients.

Example policy update:

```bash
curl -X PATCH http://localhost:8787/api/policy \
  -H 'content-type: application/json' \
  -d '{
    "maxAmount":"50",
    "tokenAllowlistEnforced": true,
    "allowedTokens": ["0x2222222222222222222222222222222222222222"]
  }'
```

OpenClaw-style command example:

```bash
curl -X POST http://localhost:8787/api/commands \
  -H 'content-type: application/json' \
  -d '{
    "command":"request_payment",
    "args":{
      "to":"0x1111111111111111111111111111111111111111",
      "token":"0x2222222222222222222222222222222222222222",
      "amount":"33.00",
      "memo":"order_8472",
      "merchantName":"Tempo Merch",
      "itemName":"Tempo Tee Black M"
    }
  }'
```

Supported commands:

1. `request_payment`
2. `set_policy`
3. `get_policy`
4. `list_intents`
5. `get_intent`

Messaging model:

1. Backend returns channel-ready `messages` payloads.
2. OpenClaw bot runtime sends the actual Telegram message using its own bot identity/token.

## Important Note

Passkeys require a secure context (HTTPS), and many in-app browsers (Telegram/Discord) do not support WebAuthn.
For mobile testing, open the approval URL in Safari/Chrome directly, or serve the site over HTTPS (for example via a tunnel).
