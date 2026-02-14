const PLUGIN_ID = "agent-wallet";

function normalizeBaseUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function getPluginConfig(api) {
  const entry = api?.config?.plugins?.entries?.[PLUGIN_ID];
  const config = entry?.config ?? {};

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs)
      ? config.timeoutMs
      : 15_000;

  if (!baseUrl) {
    throw new Error(
      `[${PLUGIN_ID}] Missing plugins.entries.${PLUGIN_ID}.config.baseUrl (Agent Wallet backend base URL).`
    );
  }

  return { baseUrl, apiKey: apiKey || null, timeoutMs };
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const text = await response.text();
    const json = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const message =
        (json && typeof json === "object" && json !== null && "message" in json
          ? String(json.message)
          : text) || `HTTP ${response.status}`;
      throw new Error(`[${PLUGIN_ID}] Agent Wallet error: ${message}`);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function callAgentWallet(api, command, args) {
  const { baseUrl, apiKey, timeoutMs } = getPluginConfig(api);

  const headers = { "content-type": "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return postJson(
    `${baseUrl}/api/commands`,
    headers,
    {
      command,
      ...(args ? { args } : {})
    },
    timeoutMs
  );
}

function asTextResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

export default function registerAgentWalletPlugin(api) {
  api.registerTool({
    name: "agent_wallet_register",
    description:
      "Register a new bot tenant on the Agent Wallet service. Returns an API key and botId. Call this once during setup — save the API key in your plugin config.",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    async execute() {
      const { baseUrl, timeoutMs } = getPluginConfig(api);
      const response = await postJson(
        `${baseUrl}/api/register`,
        { "content-type": "application/json" },
        {},
        timeoutMs
      );
      return asTextResult(response);
    }
  });

  api.registerTool({
    name: "agent_wallet_request_payment",
    description:
      "Create a payment intent (requires human approval). Returns approvalUrl + a Telegram-ready message body.",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        to: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$",
          description: "Recipient address (merchant/settlement address)."
        },
        token: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$",
          description: "Tempo TIP-20 token contract address."
        },
        amount: {
          type: "string",
          minLength: 1,
          description: "Human-readable amount (e.g. \"10\" or \"10.50\")."
        },
        memo: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Short description/reference (<=128 chars)."
        },
        merchantName: { type: "string", maxLength: 120 },
        itemName: { type: "string", maxLength: 120 },
        deadline: {
          type: "number",
          description:
            "Optional unix timestamp (seconds). If omitted, backend sets now + TTL."
        }
      },
      required: ["to", "token", "amount", "memo"]
    },
    async execute(_callId, params) {
      const response = await callAgentWallet(api, "request_payment", params);
      const approvalUrl = response?.result?.approvalUrl ?? response?.approvalUrl;
      const telegramBody =
        response?.result?.messages?.[0]?.body ??
        response?.result?.telegramPreview ??
        response?.telegramPreview ??
        "";

      return asTextResult({
        approvalUrl,
        telegramBody,
        raw: response
      });
    }
  });

  api.registerTool({
    name: "agent_wallet_get_intent",
    description: "Fetch one intent by intentId.",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        intentId: { type: "string", minLength: 1, description: "0x-bytes32 intent id." }
      },
      required: ["intentId"]
    },
    async execute(_callId, params) {
      const response = await callAgentWallet(api, "get_intent", params);
      return asTextResult(response);
    }
  });

  api.registerTool({
    name: "agent_wallet_list_intents",
    description: "List intents (newest first).",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    async execute() {
      const response = await callAgentWallet(api, "list_intents");
      return asTextResult(response);
    }
  });

  api.registerTool({
    name: "agent_wallet_get_policy",
    description: "Get current policy guardrails.",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    async execute() {
      const response = await callAgentWallet(api, "get_policy");
      return asTextResult(response);
    }
  });

  api.registerTool({
    name: "agent_wallet_set_policy",
    description: "Update policy guardrails (max amount, allowlists).",
    optional: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxAmount: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        tokenAllowlistEnforced: { type: "boolean" },
        recipientAllowlistEnforced: { type: "boolean" },
        allowedTokens: {
          type: "array",
          items: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
        },
        allowedRecipients: {
          type: "array",
          items: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" }
        }
      }
    },
    async execute(_callId, params) {
      const response = await callAgentWallet(api, "set_policy", params);
      return asTextResult(response);
    }
  });
}

