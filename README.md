# PayGents

> AI agents that can pay, with human approval via passkeys (Face ID / Touch ID / device PIN).

**Canteen × Tempo Hackathon Submission**

## The Problem

AI agents are getting autonomous — they can browse, shop, and negotiate. But when it comes to spending money, you either:
- Give the agent your keys (dangerous)
- Manually copy-paste every transaction (defeats the purpose)

There's no middle ground between **full trust** and **zero automation**.

## The Solution

A hosted payment-approval service that any AI agent can call to initiate payments. Every transaction requires **human presence** via passkey authentication (Face ID / Touch ID) before it executes on-chain.

```
Any AI Agent → PayGents API → Push Notification → Passkey Prompt → On-chain Tx
```

### How It Works

1. **Agent creates a payment intent** via simple API call
2. **Owner gets a push notification** on their phone (PWA)
3. **Owner taps → reviews → approves with passkey** (Face ID / fingerprint)
4. **Real TIP-20 transfer executes on Tempo** (gas sponsored)
5. **Agent gets confirmation** with tx hash

No seed phrases. No blind trust. No manual copy-paste.

## Architecture

```
┌──────────────────────────────────────────┐
│       PayGents Service (single deploy)   │
│                                          │
│  • Intent lifecycle & policy engine      │
│  • Push notifications (Web Push / VAPID) │
│  • Approval PWA (passkeys + viem/tempo)  │
│  • Tempo RPC & fee sponsorship proxy     │
│  • Receipt verification                  │
└────────────────┬─────────────────────────┘
                 │ POST /api/commands
        ┌────────┼────────┐
        │        │        │
     Bot A    Bot B    Bot C
   (OpenClaw) (LangChain) (curl)
```

**Any AI agent** can integrate — OpenClaw plugin, LangChain tool, or raw HTTP. One API call to create a payment, one push notification to the owner.

**Users manage one wallet** — one passkey, one PWA, all their agents' requests in one place. Policy guardrails (max amount, token/recipient allowlists) per API key.

## Live Demo

- **Production:** https://agent-wallet-demo-production.up.railway.app
- **PWA:** Install from the URL above in Safari/Chrome for push notifications

## Quick Start

### For AI Agent Developers (Integration)

Register your bot tenant (one-time) to get an API key:

```bash
curl -s -X POST https://agent-wallet-demo-production.up.railway.app/api/register \
  -H 'content-type: application/json' | jq
```

Then create a payment intent with one API call:

```bash
curl -X POST https://agent-wallet-demo-production.up.railway.app/api/commands \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <API_KEY>' \
  -d '{
    "command": "request_payment",
    "args": {
      "to": "0x1111111111111111111111111111111111111111",
      "token": "0x20c0000000000000000000000000000000000001",
      "amount": "50",
      "memo": "order-123",
      "merchantName": "Cool Store",
      "itemName": "Black Tee Size L"
    }
  }'
```

Response includes `approvalUrl` + ready-to-send message body. Send the link to the user via Telegram/WhatsApp/any channel.

### Self-Hosting

```bash
npm install
npm run dev  # http://localhost:8787
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 8787) |
| `AGENT_WALLET_API_KEY` | No | Legacy single-key mode for self-hosting (if set, disables multi-tenant registration) |
| `VAPID_PUBLIC_KEY` | Recommended | Persistent push notification key |
| `VAPID_PRIVATE_KEY` | Recommended | Persistent push notification key |
| `VAPID_SUBJECT` | No | VAPID contact email |
| `APPROVAL_BASE_URL` | Yes (prod) | Base URL for approval links |
| `TEMPO_RPC_URL` | No | Tempo RPC (default: moderato testnet) |
| `TEMPO_SPONSOR_URL` | No | Tempo fee sponsor (default: moderato) |

## API Reference

### Commands (`POST /api/commands`)

| Command | Description |
|---------|-------------|
| `request_payment` | Create a payment intent (returns approval URL) |
| `get_intent` | Fetch intent by ID |
| `list_intents` | List all intents |
| `get_policy` | View current guardrails |
| `set_policy` | Update guardrails (max amount, allowlists) |

### Other Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /healthz` | Public | Health check |
| `POST /api/register` | Public | Create a new bot tenant (returns `apiKey`, `botId`) |
| `GET /api/intents` | API key | List intents |
| `GET /api/intents/:id` | API key | Get intent |
| `PATCH /api/policy` | API key | Update policy |
| `POST /api/approval/:token/confirm` | Public | Confirm tx hash |
| `POST /api/rpc` | Public | Tempo RPC proxy |
| `POST /api/sponsor` | Public | Tempo fee sponsor proxy |

## On-Chain Flow (Approval Page)

The approval page uses **Tempo-native passkeys** (`viem/tempo` + `WebAuthnP256`):

1. User taps **Approve with Passkey**
2. Face ID / Touch ID prompt
3. TIP-20 `transferWithMemo` sent on Tempo (gas sponsored via fee payer)
4. `nonceKey` = intent nonce (2D nonces), `validBefore` = intent deadline
5. Page calls `POST /api/approval/:token/confirm` with tx hash
6. Backend verifies receipt matches intent (token, recipient, amount, deadline)

Testnet tokens (Tempo Moderato, decimals `6`):
- `alphaUSD`: `0x20c0000000000000000000000000000000000001`
- `betaUSD`: `0x20c0000000000000000000000000000000000002`
- Full list: https://tokenlist.tempo.xyz/list/42431

## Project Structure

```
agent/              → Backend service (Express + TypeScript)
  src/server.ts     → API routes + middleware
  src/core/         → Intent lifecycle, policy, state machine
  src/chain/        → Chain submitter (mock for backend, real tx via browser)
approval-page/      → PWA (approval UI + push notifications)
  public/app.js     → Passkey + viem/tempo integration
  public/sw.js      → Service worker (push + caching)
docs/future/        → Smart contract (AgentGuardVault.sol) — design reference
skills/             → OpenClaw skill definition
openclaw-plugin-*/  → OpenClaw plugin (typed tools)
```

## Roadmap

- **Smart contract enforcement** — `AgentGuardVault.sol` (in `docs/future/`) adds on-chain policy: max amounts, token/recipient allowlists, nonce replay protection. Currently policy is server-side only.
- **Webhook callbacks** — Notify bots when intents are approved/executed (instead of polling).
- **Multi-chain** — Extend beyond Tempo to any EVM chain.

## OpenClaw Integration

See `docs/openclaw-integration.md` for step-by-step guide to connect any OpenClaw bot.

## Important Notes

- Passkeys require **HTTPS** and a real browser (Safari/Chrome). In-app browsers (Telegram/Discord) don't support WebAuthn.
- VAPID keys should be set as env vars for push notifications to survive restarts.
- Push subscriptions are stored in-memory/file — re-subscribe after redeploy.

## Built With

- [Tempo](https://tempo.xyz) — L1 blockchain with native passkey accounts + fee sponsorship
- [OpenClaw](https://openclaw.ai) — Open-source AI assistant platform
- [viem/tempo](https://viem.sh) — TypeScript blockchain client
- Express + TypeScript + Zod
- Web Push API + Service Workers
