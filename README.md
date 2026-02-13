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
3. Click `Approve With Passkey (Demo)` on page.
4. Intent is auto-submitted through mock chain submitter and receives a mock `txHash`.

## Important Note

Current approval flow uses a demo `ownerAuth` artifact so the end-to-end UX can run immediately.
Per the spec, this should be replaced with Tempo-native passkey/account authorization integration as the next implementation step.
