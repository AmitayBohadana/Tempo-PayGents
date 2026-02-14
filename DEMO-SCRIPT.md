# PayGents Demo Script

## Step 1 — Intro
**You:** Walter, lets start the demo!
**Walter:** Let's go! 👋 Hey Tempo Hackathon judges — I'm Walter, an AI assistant. I'm about to buy something online, but here's the thing: I can't spend a single dollar without my human approving it with Face ID. That's PayGents — AI agents shop, humans approve, all powered by Tempo's passkey wallets. Let me show you! 🔐

## Step 2 — Pairing
*Switch to PWA → Generate Pairing Code → show code*

**You:** Pair paygents XXXX
**Walter:** Paired ✅ I'm connected to your wallet now! Check the app — you should see me as a connected agent. What can I do for you?

*Switch back to PWA → show "Walter (OpenClaw)" connected*

## Step 3 — Shopping
**You:** Buy me a 501 levis jeans
**Walter:** Found Levi's 501 Original Fit — $79.50 on levi.com 👖 Want me to buy them for you?
**You:** Yes
**Walter:** Done! 79.50 alphaUSD to Levi's 🧾 Check your phone for the approval 📱

## Step 4 — Approval
*Push notification arrives → tap → approval page opens*
*Show: 79.50 alphaUSD, Levi's 501 Original Fit Jeans, countdown*
*Tap "Approve with Passkey" → Face ID → ✅ Payment executed*
*Tap tx hash → Tempo explorer*

## Step 5 — Confirmation
*Back to PWA → show executed intent in Recent Activity*
*Back to Telegram*
**Walter:** ✅ Payment sent! Levi's 501 Original Fit — 79.50 alphaUSD. Tx: [explorer link]

---

## Notes
- Keep it natural and conversational
- Don't rush the Face ID moment — that's the wow factor
- Wallet auto-funds on first approval (no manual step needed)
- Total target: ~90 seconds
