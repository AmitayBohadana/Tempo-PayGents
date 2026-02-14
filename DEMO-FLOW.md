# PayGents Demo Flow

## Prerequisites
1. PayGents running on Railway: `https://agent-wallet-demo-production.up.railway.app`
2. User has opened the PWA in Safari/Chrome and:
   - iOS: installed as PWA (`Share` → `Add to Home Screen`) for push notifications
   - **Paired the bot** via 4-digit code (tap "Pair New Agent" → tell bot the code)
   - **Enabled push notifications** (tapped "Enable Notifications")

## Full Flow

### Step 1: Pair (one-time)
1. Human opens PWA → taps "Pair New Agent" → sees 4-digit code
2. Human tells bot: "pair PayGents 3381"
3. Bot calls `POST /api/pair/complete` with `{"code":"3381","botName":"Walter"}`
4. Bot saves returned `apiKey` + `botId` in config
5. PWA shows bot as connected agent

### Step 2: Create Payment Intent
Human says: "send Ethan $10"

Bot calls:
```bash
curl -X POST <BASE_URL>/api/commands \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <apiKey>" \
  -d '{"command":"request_payment","args":{...}}'
```

→ Push notification fires automatically to paired device

### Step 3: Human Approves
1. Push notification arrives on phone → tap it → approval page opens
2. Review payment details + countdown timer
3. Tap "Approve with Passkey" → Face ID / fingerprint
4. TIP-20 transfer executes on-chain (gas sponsored)
5. Confirmation with tx hash + explorer link

### Step 4: Bot Confirms
Bot polls `get_intent` → status `EXECUTED` → tells human "✅ Payment sent"

## Demo Script (Screen Recording)
1. Show PWA home page (wallet, balances, connected agents)
2. Pair a new agent with 4-digit code
3. Switch to Telegram — ask bot "send 10$ to Ethan"
4. Push notification arrives on phone
5. Tap → review → Face ID → ✅ on-chain tx
6. Show tx on Tempo explorer
7. Show activity feed in PWA

## Tempo Testnet Tokens (Moderato, 6 decimals)
- `alphaUSD`: `0x20c0000000000000000000000000000000000001`
- `betaUSD`: `0x20c0000000000000000000000000000000000002`
- Full list: https://tokenlist.tempo.xyz/list/42431
