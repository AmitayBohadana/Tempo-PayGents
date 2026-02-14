# PayGents Demo Script

## Step 1: Intro
**You:** Walter, lets start the demo!
**Walter:** PayGents lets AI agents request payments on Tempo, but only you can approve them — using Tempo's native passkey wallets tied to your Face ID. The agent can never spend without your biometric presence. 🔐

## Step 2: Pairing
*You switch to the PayGents PWA → tap "Generate Pairing Code" → show 4-digit code on screen*

**You:** Pair paygents XXXX
**Walter:** Paired ✅ I'm connected to your wallet now!

*You switch back to PWA → show "Walter (OpenClaw)" as connected agent*

## Step 3: Payment Request
**You:** Send 25 alphaUSD to Ethan for coffee
**Walter:** Done! 25 alphaUSD to Ethan ☕ Check your phone for the approval 📱

## Step 4: Approval Flow
*Push notification appears → you tap it → approval page opens*
*Show: amount (25 alphaUSD), recipient, memo, countdown timer*
*Tap "Approve with Passkey" → Face ID prompt → ✅ Payment executed*
*Tap tx hash → Tempo explorer shows the on-chain transfer*

## Step 5: Confirmation
*Back to PWA → show executed intent in Recent Activity*
*Back to Telegram*
**Walter:** ✅ Payment sent! 25 alphaUSD to Ethan. Tx: [explorer link]

---

## Notes
- Keep it natural and conversational
- Don't rush Face ID — that's the wow moment
- Total target: ~90 seconds
