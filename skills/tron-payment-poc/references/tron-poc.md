# TRON POC Reference

## Goal

Fast demo flow where an agent prepares a payment request and the user approves from a TRON wallet.

## Minimal Flow

1. Agent gathers payment inputs.
2. Agent generates intent payload.
3. Agent sends message + wallet open link/deeplink payload.
4. User approves transaction in wallet.

## Intent Shape

```json
{
  "chain": "tron",
  "assetType": "TRX",
  "to": "T...",
  "amountHuman": "25",
  "amountSun": "25000000",
  "memo": "order-123",
  "createdAt": "2026-02-17T00:00:00.000Z"
}
```

TRC20 variant:

```json
{
  "chain": "tron",
  "assetType": "TRC20",
  "token": "T...",
  "to": "T...",
  "amountHuman": "15.5",
  "amountBaseUnits": "15500000",
  "decimals": 6,
  "memo": "order-123",
  "createdAt": "2026-02-17T00:00:00.000Z"
}
```

## Unit Conversion

- TRX uses `sun` (1 TRX = 1,000,000 sun).
- TRC20 base units = `amount * 10^decimals`.

## Security Reality (POC)

- User wallet approval is the security control.
- Agent cannot force execute.
- No server-side policy/risk controls in this mode.
