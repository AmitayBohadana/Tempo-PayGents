# OpenClaw Integration Guide

Any OpenClaw bot can integrate with the **hosted** PayGents service. No need to deploy your own backend.

## 1) Register your bot (one-time)

```bash
curl -s -X POST https://agent-wallet-demo-production.up.railway.app/api/register \
  -H "content-type: application/json" | jq
```

Response:
```json
{
  "apiKey": "a1b2c3d4...",
  "botId": "f93de178-16d1-..."
}
```

Save the `apiKey` — it scopes all your intents and policy (and can also be used to scope push notifications).

## 2) Configure your OpenClaw bot

### Option A: OpenClaw Plugin (recommended)

Install the plugin:
```bash
openclaw plugins install /path/to/Temp-Hack/openclaw-plugin-agent-wallet
```

Add to your `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "agent-wallet": {
        "enabled": true,
        "config": {
          "baseUrl": "https://agent-wallet-demo-production.up.railway.app",
          "apiKey": "<your-api-key-from-step-1>"
        }
      }
    }
  }
}
```

Your bot now has tools: `agent_wallet_request_payment`, `agent_wallet_get_intent`, `agent_wallet_list_intents`, `agent_wallet_get_policy`, `agent_wallet_set_policy`.
You can also use `agent_wallet_register` during setup (but typically you'll just call `/api/register` once via curl).

### Option B: Skill + curl (simple)

Use the `agent-wallet` skill with the `wallet-cmd.sh` script. Set env:
```bash
export AGENT_WALLET_URL=https://agent-wallet-demo-production.up.railway.app
export AGENT_WALLET_API_KEY=<your-api-key>
```

### Option C: Raw HTTP (any framework)

Just call `POST /api/commands` with `Authorization: Bearer <apiKey>`.

## 3) Create a payment intent

```bash
curl -X POST https://agent-wallet-demo-production.up.railway.app/api/commands \
  -H "content-type: application/json" \
  -H "authorization: Bearer <your-api-key>" \
  -d '{
    "command": "request_payment",
    "args": {
      "to": "0x<recipient>",
      "token": "0x20c0000000000000000000000000000000000001",
      "amount": "29.99",
      "memo": "order-123",
      "merchantName": "Cool Store",
      "itemName": "Black Tee L"
    }
  }'
```

Response includes:
- `approvalUrl` — send this to the user
- `messages[]` — ready-to-send message bodies

## 4) Send the approval link to the human

Send the `approvalUrl` to the user via Telegram/WhatsApp/any channel. They'll also get a push notification if they've installed the PWA.

**Important:** Many in-app browsers (Telegram/Discord) don't support passkeys. Tell the user to open in Safari/Chrome.

## 5) After approval

Poll status:
```json
{
  "command": "get_intent",
  "args": { "intentId": "0x<intent_id>" }
}
```

When status = `EXECUTED`, show the `txHash` and Tempo explorer link:
`https://explore.moderato.tempo.xyz/tx/<txHash>`

## 6) Set guardrails (recommended)

Each bot gets its own policy:
```json
{
  "command": "set_policy",
  "args": {
    "maxAmount": "100",
    "tokenAllowlistEnforced": true,
    "allowedTokens": ["0x20c0000000000000000000000000000000000001"]
  }
}
```

## Multi-Tenancy

- Each API key is scoped to a `botId`
- Intents and policy are isolated per bot
- Push notifications are demo-grade (subscriptions can be global unless explicitly scoped)
- Users manage one PWA — they see approval requests from all their bots
- The service handles everything — no deployment needed
