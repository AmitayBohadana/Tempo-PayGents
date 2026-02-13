---
name: agent-wallet
description: Use the Agent Wallet backend from an OpenClaw agent. Create payment intents, send approval links, manage policy, and check status.
---

# Agent Wallet (OpenClaw)

This plugin provides OpenClaw tools that call the Agent Wallet backend (`POST /api/commands`).

## Tools

- `agent_wallet_request_payment`
- `agent_wallet_get_intent`
- `agent_wallet_list_intents`
- `agent_wallet_get_policy`
- `agent_wallet_set_policy`

## Typical Flow

1. When the user wants to buy something, call `agent_wallet_request_payment`.
2. Send the returned `approvalUrl` to the user as a button link.
3. The user approves on the web page (passkey).
4. Poll with `agent_wallet_get_intent` until status is `EXECUTED`, then confirm to the user with the tx hash.

## Notes

- Passkeys require HTTPS and a real browser (not most in-app browsers like Telegram/Discord).
- Set guardrails early via `agent_wallet_set_policy` (max amount, allowlists).

