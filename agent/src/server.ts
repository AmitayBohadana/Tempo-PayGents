import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { getAddress } from "ethers";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import webpush, { type PushSubscription } from "web-push";
import { z } from "zod";
import { IntentStore, TenantStore } from "./core/intent-store.js";
import { IntentService } from "./core/intent-service.js";
import type { OwnerAuthAdapter } from "./core/owner-auth.js";
import { AppError } from "./core/errors.js";
import type { ChainSubmitter, StoredPushSubscription } from "./types.js";

const createIntentSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().min(1),
  memo: z.string().min(1).max(128),
  merchantName: z.string().max(120).optional(),
  itemName: z.string().max(120).optional(),
  deadline: z.number().int().positive().optional()
});

const confirmSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
});

const updatePolicySchema = z
  .object({
    maxAmount: z.union([z.string().min(1), z.null()]).optional(),
    tokenAllowlistEnforced: z.boolean().optional(),
    recipientAllowlistEnforced: z.boolean().optional(),
    allowedTokens: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).optional(),
    allowedRecipients: z.array(z.string().regex(/^0x[a-fA-F0-9]{40}$/)).optional()
  })
  .strict();

const pushSubscriptionSchema = z
  .object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1),
        auth: z.string().min(1)
      })
      .strict()
  })
  .strict();

const pushSubscribeSchema = z
  .object({
    subscription: pushSubscriptionSchema
  })
  .strict();

const pushUnsubscribeSchema = z
  .object({
    endpoint: z.string().url()
  })
  .strict();

const commandSchema = z.discriminatedUnion("command", [
  z
    .object({
      command: z.literal("request_payment"),
      args: createIntentSchema
    })
    .strict(),
  z
    .object({
      command: z.literal("set_policy"),
      args: updatePolicySchema
    })
    .strict(),
  z
    .object({
      command: z.literal("get_policy")
    })
    .strict(),
  z
    .object({
      command: z.literal("list_intents")
    })
    .strict(),
  z
    .object({
      command: z.literal("get_intent"),
      args: z
        .object({
          intentId: z.string().min(1)
        })
        .strict()
    })
    .strict()
]);

export async function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const port = Number(process.env.PORT ?? 8787);
  const agentWalletApiKey = process.env.AGENT_WALLET_API_KEY?.trim() || null;
  const tempoRpcUrl =
    process.env.TEMPO_RPC_URL ??
    process.env.EVM_RPC_URL ??
    "https://rpc.moderato.tempo.xyz";
  const tempoSponsorUrl =
    process.env.TEMPO_SPONSOR_URL ?? "https://sponsor.moderato.tempo.xyz";
  const chainId = Number(process.env.CHAIN_ID ?? 42431);
  const verifyingContract =
    process.env.VERIFYING_CONTRACT ?? "0x000000000000000000000000000000000000dEaD";
  const tokenDecimals = Number(process.env.TOKEN_DECIMALS ?? 6);
  const approvalTokenTtlSec = Number(process.env.APPROVAL_TOKEN_TTL_SEC ?? 600);
  const approvalBaseUrl = process.env.APPROVAL_BASE_URL ?? `http://localhost:${port}`;
  const autoSubmitOnApprove = process.env.AUTO_SUBMIT_ON_APPROVE !== "false";
  const intentsPath =
    process.env.INTENT_STORE_PATH ??
    path.join(process.cwd(), "agent", "data", "intents.json");
  const tenantsPath = path.join(process.cwd(), "agent", "data", "tenants.json");
  const approvalPublicDir = path.join(process.cwd(), "approval-page", "public");

  const extractApiKey = (req: Request): string => {
    const authorization = req.header("authorization") ?? "";
    const bearerToken = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    return bearerToken || (req.header("x-api-key") ?? "").trim();
  };

  const requireBotApiKey = (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = extractApiKey(req);

    // Legacy single API key mode.
    if (agentWalletApiKey) {
      if (!apiKey || apiKey !== agentWalletApiKey) {
        res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Missing or invalid API key."
        });
        return;
      }

      res.locals.botId = null;
      next();
      return;
    }

    // Multi-tenant mode: resolve botId from tenants.json.
    if (!apiKey) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing API key."
      });
      return;
    }

    const tenant = tenantStore.getByApiKey(apiKey);
    if (!tenant) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key."
      });
      return;
    }

    res.locals.botId = tenant.botId;
    next();
  };

  const resolveBotApiKeyOptional = (
    req: Request,
    res: Response,
    next: NextFunction
  ): void => {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      res.locals.botId = null;
      next();
      return;
    }

    if (agentWalletApiKey) {
      // Legacy mode: ignore botId scoping.
      if (apiKey !== agentWalletApiKey) {
        res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Missing or invalid API key."
        });
        return;
      }
      res.locals.botId = null;
      next();
      return;
    }

    const tenant = tenantStore.getByApiKey(apiKey);
    if (!tenant) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Missing or invalid API key."
      });
      return;
    }

    res.locals.botId = tenant.botId;
    next();
  };

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidKeys =
    vapidPublicKey && vapidPrivateKey
      ? { publicKey: vapidPublicKey, privateKey: vapidPrivateKey }
      : webpush.generateVAPIDKeys();

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:agent-wallet@example.com",
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  const store = new IntentStore(intentsPath);
  await store.init();

  const tenantStore = new TenantStore(tenantsPath);
  await tenantStore.init();

  // Current MVP: the approval PWA submits transactions directly using Tempo-native passkeys.
  // Keep these adapters disabled to reduce attack surface; contract-mode is in docs/future/.
  const ownerAuthAdapter: OwnerAuthAdapter = {
    toContractOwnerAuth() {
      throw new AppError(
        501,
        "OWNER_AUTH_DISABLED",
        "Owner auth is disabled in passkey mode. Approvals must be executed from the PWA."
      );
    },
    getSignerAddress() {
      return "0x0000000000000000000000000000000000000000";
    },
    getOwnerRef() {
      return "0x0000000000000000000000000000000000000000000000000000000000000000";
    }
  };

  const chainSubmitter: ChainSubmitter = {
    async submit() {
      throw new AppError(
        501,
        "CHAIN_SUBMISSION_DISABLED",
        "Backend chain submission is disabled in passkey mode. Submit from the approval PWA."
      );
    }
  };

  const service = new IntentService(store, chainSubmitter, ownerAuthAdapter, {
    approvalTokenTtlSec,
    chainId,
    verifyingContract,
    tokenDecimals,
    approvalBaseUrl,
    autoSubmitOnApprove,
    onIntentCreated: async (payload) => {
      const subscriptions = store.getPushSubscriptions(payload.botId ?? null);
      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              subscription as PushSubscription,
              JSON.stringify({
                title: payload.title,
                body: payload.body,
                data: {
                  approvalUrl: payload.approvalUrl,
                  intentId: payload.intentId
                }
              })
            );
          } catch (error) {
            const statusCode =
              typeof error === "object" && error !== null && "statusCode" in error
                ? Number((error as { statusCode?: number }).statusCode)
                : 0;

            if (statusCode === 404 || statusCode === 410) {
              await store.removePushSubscription(subscription.endpoint);
            }
          }
        })
      );
    }
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  // Public tenant registration endpoint (multi-tenant API keys).
  app.post("/api/register", async (_req, res, next) => {
    try {
      if (agentWalletApiKey) {
        res.status(409).json({
          error: "REGISTRATION_DISABLED",
          message:
            "Tenant registration is disabled when AGENT_WALLET_API_KEY is set (legacy single-key mode)."
        });
        return;
      }

      const apiKey = randomBytes(32).toString("hex");
      const botId = randomUUID();
      await tenantStore.create({ apiKey, botId, createdAt: new Date().toISOString() });
      res.status(201).json({ apiKey, botId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/rpc", async (req, res, next) => {
    try {
      const response = await fetch(tempoRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
      });
      const text = await response.text();
      res.status(response.status).type("application/json").send(text);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sponsor", async (req, res, next) => {
    try {
      const response = await fetch(tempoSponsorUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req.body)
      });
      const text = await response.text();
      res.status(response.status).type("application/json").send(text);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/push/vapid-public-key", (_req, res) => {
    res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post("/api/push/subscribe", resolveBotApiKeyOptional, async (req, res, next) => {
    try {
      const payload = pushSubscribeSchema.parse(req.body);
      const subscription: StoredPushSubscription = {
        endpoint: payload.subscription.endpoint,
        expirationTime: payload.subscription.expirationTime ?? null,
        botId: res.locals.botId ?? "global",
        keys: {
          p256dh: payload.subscription.keys.p256dh,
          auth: payload.subscription.keys.auth
        }
      };

      await store.addPushSubscription(subscription);
      res.status(201).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/push/unsubscribe", async (req, res, next) => {
    try {
      const payload = pushUnsubscribeSchema.parse(req.body);
      await store.removePushSubscription(payload.endpoint);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(approvalPublicDir));

  app.get("/approve", (_req, res) => {
    res.sendFile(path.join(approvalPublicDir, "index.html"));
  });

  app.use("/assets", express.static(approvalPublicDir));

  app.post("/api/intents", requireBotApiKey, async (req, res, next) => {
    try {
      const payload = createIntentSchema.parse(req.body);
      const result = await service.createIntent(payload, res.locals.botId ?? null);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/commands", requireBotApiKey, async (req, res, next) => {
    try {
      const command = commandSchema.parse(req.body);

      if (command.command === "request_payment") {
        const result = await service.createIntent(command.args, res.locals.botId ?? null);
        res.status(201).json({
          command: command.command,
          result: {
            intent: result.intent,
            approvalUrl: result.approvalUrl,
            messages: [
              {
                channel: "telegram",
                type: "text",
                body: result.telegramPreview
              }
            ]
          }
        });
        return;
      }

      if (command.command === "set_policy") {
        const policy = await service.updatePolicy(command.args, res.locals.botId ?? null);
        res.json({ command: command.command, result: { policy } });
        return;
      }

      if (command.command === "get_policy") {
        const policy = service.getPolicy(res.locals.botId ?? null);
        res.json({ command: command.command, result: { policy } });
        return;
      }

      if (command.command === "list_intents") {
        const intents = await service.listIntents(res.locals.botId ?? null);
        res.json({ command: command.command, result: { intents } });
        return;
      }

      const intent = await service.getIntent(command.args.intentId, res.locals.botId ?? null);
      res.json({
        command: command.command,
        result: { intent }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents", requireBotApiKey, async (_req, res, next) => {
    try {
      const intents = await service.listIntents(res.locals.botId ?? null);
      res.json({ intents });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/policy", requireBotApiKey, (_req, res) => {
    const policy = service.getPolicy(res.locals.botId ?? null);
    res.json({ policy });
  });

  app.patch("/api/policy", requireBotApiKey, async (req, res, next) => {
    try {
      const patch = updatePolicySchema.parse(req.body);
      const policy = await service.updatePolicy(patch, res.locals.botId ?? null);
      res.json({ policy });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents/:intentId", requireBotApiKey, async (req, res, next) => {
    try {
      const intent = await service.getIntent(req.params.intentId, res.locals.botId ?? null);
      res.json({ intent });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents/:intentId/messages", requireBotApiKey, (req, res, next) => {
    try {
      const messages = service.buildOutboundMessages(req.params.intentId, res.locals.botId ?? null);
      res.json({ messages });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/approval/:token", async (req, res, next) => {
    try {
      const approval = await service.getApprovalPayload(req.params.token);
      res.json({ approval });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/approval/:token/confirm", async (req, res, next) => {
    try {
      const payload = confirmSchema.parse(req.body);
      const approval = await service.getApprovalPayload(req.params.token);
      await assertReceiptMatchesIntent(tempoRpcUrl, payload.txHash, approval);
      const intent = await service.confirmExecution(req.params.token, payload.txHash);
      res.json({ intent });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/approval/:token/reject", async (req, res, next) => {
    try {
      const intent = await service.rejectApproval(req.params.token);
      res.json({ intent });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: error.errorCode,
        message: error.message
      });
      return;
    }

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "VALIDATION_ERROR",
        message: error.issues.map((issue) => issue.message).join(", ")
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      error: "INTERNAL_SERVER_ERROR",
      message
    });
  });

  return { app, port };
}

const TIP20_TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function assertReceiptMatchesIntent(
  rpcUrl: string,
  txHash: string,
  approval: {
    token: string;
    to: string;
    amountBaseUnits: string;
    deadline: number;
  }
): Promise<void> {
  const receipt = await rpcCall(rpcUrl, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) {
    throw new AppError(409, "TX_NOT_FOUND", "Transaction receipt not found yet.");
  }

  const status = String(receipt.status ?? "").toLowerCase();
  if (status !== "0x1") {
    throw new AppError(400, "TX_REVERTED", "Transaction reverted.");
  }

  // Tempo receipts include `blockTimestamp` (hex). If present, ensure it is within deadline.
  if (receipt.blockTimestamp) {
    const blockTimestamp = Number(BigInt(receipt.blockTimestamp));
    if (Number.isFinite(blockTimestamp) && blockTimestamp > approval.deadline) {
      throw new AppError(400, "TX_AFTER_DEADLINE", "Transaction executed after intent deadline.");
    }
  }

  const expectedToken = getAddress(approval.token).toLowerCase();
  const expectedTo = getAddress(approval.to).toLowerCase();
  const expectedAmount = BigInt(approval.amountBaseUnits);

  const logs: unknown[] = Array.isArray(receipt.logs) ? receipt.logs : [];
  for (const log of logs) {
    if (!log || typeof log !== "object") continue;
    const address =
      "address" in log && typeof log.address === "string" ? log.address : null;
    if (!address || getAddress(address).toLowerCase() !== expectedToken) continue;

    const topics =
      "topics" in log && Array.isArray(log.topics) ? (log.topics as unknown[]) : [];
    if (topics.length < 3) continue;
    const topic0 = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
    if (topic0 !== TIP20_TRANSFER_TOPIC0) continue;

    const toTopic = typeof topics[2] === "string" ? topics[2] : "";
    const to = topicToAddress(toTopic);
    if (to.toLowerCase() !== expectedTo) continue;

    const data = "data" in log && typeof log.data === "string" ? log.data : "0x0";
    const amount = BigInt(data);
    if (amount !== expectedAmount) continue;

    return;
  }

  throw new AppError(
    400,
    "TX_DOES_NOT_MATCH_INTENT",
    "Transaction receipt does not contain expected token transfer."
  );
}

function topicToAddress(topic: string): string {
  const normalized = topic.toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new AppError(400, "INVALID_TOPIC", "Receipt log topic is invalid.");
  }
  const addr = `0x${normalized.slice(-40)}`;
  return getAddress(addr);
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error) {
    throw new AppError(
      502,
      "RPC_ERROR",
      body.error?.message ?? `RPC call failed: ${method}`
    );
  }
  return body.result;
}
