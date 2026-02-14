# Demo Flow Instructions (for Walter)

## Prerequisites
1. Agent wallet server running on port 8787: `npx tsx agent/src/index.ts`
2. Cloudflared tunnel active: `cloudflared tunnel --url http://localhost:8787`
3. User must have opened the PWA landing page (tunnel URL without `?token=`) in Safari/Chrome and:
   - **Enabled push notifications** (tapped "Enable Notifications" button on landing page)
   - The service worker (`sw.js`) must be registered and push subscription saved to server

## Full Flow (when user asks to buy something)

### Step 1: Create Payment Intent
Call `/api/commands` with `request_payment`:
```bash
wallet-cmd.sh '{"command":"request_payment","args":{"to":"<address>","token":"<token_address>","amount":"<amount>","memo":"<memo>","merchantName":"<store>","itemName":"<item>"}}'
```
- Token address must be a real Tempo Moderato (testnet) TIP-20 token. Example stablecoins (decimals `6`):
  - `alphaUSD`: `0x20c0000000000000000000000000000000000001`
  - `betaUSD`: `0x20c0000000000000000000000000000000000002`
  - `thetaUSD`: `0x20c0000000000000000000000000000000000003`
  - Full list: https://tokenlist.tempo.xyz/list/42431
- The server automatically sends a **push notification** to all subscribed browsers via web-push
- The push notification contains: title, body, and `approvalUrl` in data
- When user taps the notification, `sw.js` `notificationclick` handler opens the approval URL

### Step 2: Send Telegram Confirmation
After creating the intent, send user a Telegram message with:
- Payment summary (item, store, amount, recipient)
- The approval URL as a clickable link
- Note: also mention they'll get a push notification on their phone

### Step 3: User Approves (happens on their device)
1. User receives **push notification** on phone → taps it → opens approval page in Safari
2. OR user taps Telegram link → opens approval page
3. Approval page shows payment details + countdown timer
4. User taps "Approve" → Face ID / fingerprint passkey verification
5. Approval page submits an on-chain TIP-20 transfer (sponsored fees), then calls the backend `/api/approval/:token/confirm` to record the `txHash`

### Step 4: Confirm Execution
After user approves, poll the intent status:
```bash
wallet-cmd.sh '{"command":"get_intent","args":{"intentId":"<intentId>"}}'
```
When status = `EXECUTED`, send confirmation with tx hash.

## Key Points for Demo
- The **push notification is automatic** — server sends it when intent is created (via `onIntentCreated` callback)
- No need to manually trigger notifications — just create the intent
- The approval page has two modes:
  - With `?token=xxx` → shows payment details for approval
  - Without token → shows landing page with "Enable Notifications" button
- Push only works if user previously visited the landing page and enabled notifications

## For Screen Recording
1. User says "buy X for $Y"
2. Walter creates intent via API → push notification fires automatically
3. Walter sends Telegram message with summary + link
4. User sees push notification on phone, taps it
5. Approval page opens with payment details
6. User taps Approve → Face ID → ✅ Payment executed
7. Walter confirms execution
