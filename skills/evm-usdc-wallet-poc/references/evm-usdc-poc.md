# EVM USDC POC Notes

## Objective

Quick payment-request flow for wallets:

1. Bot gets payment request.
2. Bot generates links.
3. User opens wallet and confirms USDC transfer.

## URL Types

### 1) MetaMask Deeplink

Format:

`https://link.metamask.io/send/<token>@<chainId>/transfer?address=<to>&uint256=<amountBaseUnits>`

### 2) Hosted Payment Page

`<baseUrl>/evm-usdc.html?chainId=...&token=...&to=...&amount=...&decimals=6&symbol=USDC`

Page behavior:

- Shows payment summary.
- Provides MetaMask deeplink button.
- Provides "Pay via Rabby/Injected Wallet" button (`eth_requestAccounts` + `eth_sendTransaction`).

## Default USDC Map

- Ethereum mainnet (1): `0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`
- Base mainnet (8453): `0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913`
- Sepolia (11155111): `0x1c7d4b196cb0c7b01d743fbc6116a902379c7238`
- Base Sepolia (84532): `0x036CbD53842c5426634e7929541eC2318f3dCf7e`

## Security Notes

- This is POC only.
- The wallet confirmation screen is the primary trust boundary.
- Agent/backend should not claim policy enforcement unless implemented separately.
