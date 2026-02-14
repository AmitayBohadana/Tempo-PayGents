# PayGents API Reference (agent-wallet)

Base URL: `$AGENT_WALLET_URL` (default `http://localhost:8787`)

## Authentication

PayGents supports 3 modes:

1. **Hosted multi-tenant mode (default)**:
   - Call `POST /api/register` to get `{ apiKey, botId }`.
   - Use `Authorization: Bearer <apiKey>` (or `x-api-key`) for bot-facing endpoints.

2. **Legacy single-key mode** (self-hosting):
   - If the server is started with `AGENT_WALLET_API_KEY`, bot-facing endpoints require that single key.

3. **Local dev open mode**:
   - If the server is started without `AGENT_WALLET_API_KEY`, bot-facing endpoints can be called without a key.

Public endpoints (no API key): `/healthz`, `/approve`, `/assets/*`, `/api/register`, `/api/approval/*`, `/api/rpc`, `/api/sponsor`, `/api/push/*`.

## POST /api/register

Create a new bot tenant (hosted mode).

Response:
```json
{ "apiKey": "…", "botId": "…" }
```

## POST /api/commands

Single integration endpoint. All commands go here.

### request_payment

Create a payment intent and get an approval URL to send to the user.

```json
{
  "command": "request_payment",
  "args": {
    "to": "0x<recipient_address_40hex>",
    "token": "0x<token_address_40hex>",
    "amount": "50.00",
    "memo": "order-xyz-levis-501",
    "merchantName": "Levi's",
    "itemName": "Levi's 501 Original",
    "deadline": 1700000000
  }
}
```

- `amount`: human-readable decimal string (e.g. "50", "10.50"). Converted to base units by the agent.
- `memo`: short description, max 128 chars. Hashed to bytes32 for on-chain.
- `merchantName`, `itemName`: optional, used in approval page display.
- `deadline`: optional unix timestamp. Defaults to now + approval TTL (10 min).

Response (201):
```json
{
  "command": "request_payment",
  "result": {
    "intent": { "intentId": "0x...", "status": "PENDING_APPROVAL", ... },
    "approvalUrl": "http://localhost:8787/?token=<hex>",
    "messages": [
      {
        "channel": "telegram",
        "type": "text",
        "body": "Purchase intent ready:\nItem: Levi's 501...\nApprove: http://..."
      }
    ]
  }
}
```

### set_policy

Update policy guardrails.

```json
{
  "command": "set_policy",
  "args": {
    "maxAmount": "100",
    "tokenAllowlistEnforced": true,
    "allowedTokens": ["0x<token_address>"],
    "recipientAllowlistEnforced": false,
    "allowedRecipients": []
  }
}
```

All fields optional — only provided fields are updated (patch semantics).

### get_policy

```json
{ "command": "get_policy" }
```

Returns current policy config.

### list_intents

```json
{ "command": "list_intents" }
```

Returns all intents sorted by creation date (newest first).

### get_intent

```json
{
  "command": "get_intent",
  "args": { "intentId": "0x<bytes32_intent_id>" }
}
```

## GET /api/auth/relay

Legacy endpoint (not required for the Tempo-native passkey flow). Returns relay signer info for contract setup:
```json
{
  "relaySigner": "0x...",
  "ownerRef": "0x...",
  "chainSubmitterMode": "mock"
}
```

## Intent Status Values

| Status | Meaning |
|--------|---------|
| `PENDING_APPROVAL` | Approval link sent, waiting for user |
| `EXECUTED` | Transaction confirmed on-chain |
| `FAILED` | Transaction reverted |
| `EXPIRED` | Deadline passed |
| `REJECTED` | User rejected on approval page |
