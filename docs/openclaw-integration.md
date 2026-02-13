# OpenClaw Integration Guide (Bot "XYZ")

This project is designed so each OpenClaw bot owner (Bob) runs **their own Agent Wallet backend instance**. That avoids mixing intents/policy across bots and keeps operations isolated.

## 1) Deploy an Agent Wallet backend instance

You need a public HTTPS URL so the approval page can do passkeys (WebAuthn).

Set these environment variables:

- `APPROVAL_BASE_URL=https://<your-domain>/approve`
- `AGENT_WALLET_API_KEY=<random-secret>` (recommended for anything public)

Optional (Tempo defaults are fine):

- `TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz`
- `TEMPO_SPONSOR_URL=https://sponsor.moderato.tempo.xyz`

## 2) Add one tool/action in OpenClaw (server-side)

Have bot `XYZ` call the single integration endpoint:

- `POST https://<your-backend>/api/commands`
- Header: `Authorization: Bearer <AGENT_WALLET_API_KEY>`

### Create a payment intent

Request:
```json
{
  "command": "request_payment",
  "args": {
    "to": "0x<recipient>",
    "token": "0x<tempo_tip20_token>",
    "amount": "29.99",
    "memo": "order-123",
    "merchantName": "Tshirt Shop",
    "itemName": "Black Tee L"
  }
}
```

Response includes:

- `approvalUrl` (send to the user as an inline button)
- `messages[]` (ready-to-send message bodies)

## 3) Send the approval link to the human

Bot `XYZ` should send a message like:

- "Approve payment" button URL: `approvalUrl`
- Text: use `messages[0].body` or your own formatted summary.

Important UX note: many in-app browsers (Telegram/Discord) do not support passkeys. Tell the user to open the link in Safari/Chrome.

## 4) After approval: check status and notify

Poll status:
```json
{
  "command": "get_intent",
  "args": { "intentId": "0x<bytes32_intent_id>" }
}
```

When status is `EXECUTED`, show the `txHash` and a Tempo explorer link.

## 5) (Recommended) Set guardrails

Before letting the agent shop, set a policy:
```json
{
  "command": "set_policy",
  "args": {
    "maxAmount": "100",
    "tokenAllowlistEnforced": true,
    "allowedTokens": ["0x<allowed_tip20_token>"]
  }
}
```

