# OpenClaw Integration Guide

Any OpenClaw bot can integrate with the **hosted** PayGents service. No need to deploy your own backend.

## 1) Pair with the user's wallet (one-time)

PayGents uses a **4-digit pairing flow** — the human generates a code in the PWA, tells the bot, and the bot completes pairing to get an API key.

### From the bot side:

When the user says something like "pair PayGents 3381", call:

```bash
curl -s -X POST https://agent-wallet-demo-production.up.railway.app/api/pair/complete \
  -H "content-type: application/json" \
  -d '{"code":"3381","botName":"My Bot"}'
```

Response:
```json
{
  "apiKey": "a1b2c3d4...",
  "botId": "f93de178-16d1-..."
}
```

Save the `apiKey` in your config — it scopes all your intents, policy, and push notifications.

### Alternative: Programmatic registration

For testing or automation, you can also register directly (no human pairing):

```bash
curl -s -X POST https://agent-wallet-demo-production.up.railway.app/api/register \
  -H "content-type: application/json" | jq
```

Note: Programmatic registration still works, but the pairing flow gives a better UX — the human sees the bot appear in their PWA immediately.

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
          "apiKey": "<your-api-key-from-pairing>"
        }
      }
    }
  }
}
```

Your bot now has tools: `agent_wallet_request_payment`, `agent_wallet_get_intent`, `agent_wallet_list_intents`, `agent_wallet_get_policy`, `agent_wallet_set_policy`.

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
- `approvalUrl` — the user gets a push notification automatically
- `messages[]` — ready-to-send message bodies (optional, for Telegram/WhatsApp fallback)

## 4) Push notification handles it

Once paired and notifications enabled, the user gets a push notification automatically when you create an intent. **No need to send a separate Telegram/WhatsApp message** — the push notification links directly to the approval page.

**Note:** In-app browsers (Telegram/Discord) don't support passkeys. The push notification opens in Safari/Chrome which works correctly.

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
- Push notifications are scoped per paired bot
- Users manage one PWA — they see approval requests from all their bots in one place
- The service handles everything — no deployment needed per bot
