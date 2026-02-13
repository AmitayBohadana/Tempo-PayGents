import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { z } from "zod";
import { IntentStore } from "./core/intent-store.js";
import { IntentService } from "./core/intent-service.js";
import { MockChainSubmitter } from "./chain/mock-chain.js";
import { EvmChainSubmitter } from "./chain/evm-chain.js";
import { RelaySignerOwnerAuthAdapter } from "./core/owner-auth.js";
import { AppError } from "./core/errors.js";
import type { ChainSubmitter } from "./types.js";

const createIntentSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().min(1),
  memo: z.string().min(1).max(128),
  merchantName: z.string().max(120).optional(),
  itemName: z.string().max(120).optional(),
  deadline: z.number().int().positive().optional()
});

const approveSchema = z.object({
  ownerAuth: z.string().min(1),
  digest: z.string().optional()
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

const DEV_OWNER_SIGNER_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f094538ea9f58f96b8b5f22d7f6f90f4f1f2f8f1";

export async function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const port = Number(process.env.PORT ?? 8787);
  const chainId = Number(process.env.CHAIN_ID ?? 12345);
  const verifyingContract =
    process.env.VERIFYING_CONTRACT ?? "0x000000000000000000000000000000000000dEaD";
  const tokenDecimals = Number(process.env.TOKEN_DECIMALS ?? 6);
  const approvalTokenTtlSec = Number(process.env.APPROVAL_TOKEN_TTL_SEC ?? 600);
  const approvalBaseUrl =
    process.env.APPROVAL_BASE_URL ?? `http://localhost:${port}/approve`;
  const autoSubmitOnApprove = process.env.AUTO_SUBMIT_ON_APPROVE !== "false";
  const chainSubmitterMode = process.env.CHAIN_SUBMITTER ?? "mock";
  const ownerSignerPrivateKey =
    process.env.OWNER_SIGNER_PRIVATE_KEY ?? DEV_OWNER_SIGNER_PRIVATE_KEY;
  const intentsPath =
    process.env.INTENT_STORE_PATH ??
    path.join(process.cwd(), "agent", "data", "intents.json");
  const approvalPublicDir = path.join(
    process.cwd(),
    "approval-page",
    "public"
  );

  const store = new IntentStore(intentsPath);
  await store.init();

  const ownerAuthAdapter = new RelaySignerOwnerAuthAdapter(ownerSignerPrivateKey);

  let chainSubmitter: ChainSubmitter = new MockChainSubmitter();
  if (chainSubmitterMode === "evm") {
    const rpcUrl = requiredEnv("EVM_RPC_URL");
    const relayerPrivateKey = requiredEnv("EVM_RELAYER_PRIVATE_KEY");
    const vaultAddress = requiredEnv("VAULT_CONTRACT_ADDRESS");
    const confirmations = Number(process.env.EVM_CONFIRMATIONS ?? 1);

    chainSubmitter = new EvmChainSubmitter({
      rpcUrl,
      relayerPrivateKey,
      vaultAddress,
      confirmations
    });
  }

  const service = new IntentService(store, chainSubmitter, ownerAuthAdapter, {
    approvalTokenTtlSec,
    chainId,
    verifyingContract,
    tokenDecimals,
    approvalBaseUrl,
    autoSubmitOnApprove
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/relay", (_req, res) => {
    res.json({
      relaySigner: ownerAuthAdapter.getSignerAddress(),
      ownerRef: ownerAuthAdapter.getOwnerRef(),
      chainSubmitterMode
    });
  });

  app.get("/approve", (_req, res) => {
    res.sendFile(path.join(approvalPublicDir, "index.html"));
  });

  app.use("/assets", express.static(approvalPublicDir));

  app.post("/api/intents", async (req, res, next) => {
    try {
      const payload = createIntentSchema.parse(req.body);
      const result = await service.createIntent(payload);
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/commands", async (req, res, next) => {
    try {
      const command = commandSchema.parse(req.body);

      if (command.command === "request_payment") {
        const result = await service.createIntent(command.args);
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
        const policy = await service.updatePolicy(command.args);
        res.json({ command: command.command, result: { policy } });
        return;
      }

      if (command.command === "get_policy") {
        const policy = service.getPolicy();
        res.json({ command: command.command, result: { policy } });
        return;
      }

      if (command.command === "list_intents") {
        const intents = await service.listIntents();
        res.json({ command: command.command, result: { intents } });
        return;
      }

      const intent = await service.getIntent(command.args.intentId);
      res.json({
        command: command.command,
        result: { intent }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents", async (_req, res, next) => {
    try {
      const intents = await service.listIntents();
      res.json({ intents });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/policy", (_req, res) => {
    const policy = service.getPolicy();
    res.json({ policy });
  });

  app.patch("/api/policy", async (req, res, next) => {
    try {
      const patch = updatePolicySchema.parse(req.body);
      const policy = await service.updatePolicy(patch);
      res.json({ policy });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents/:intentId", async (req, res, next) => {
    try {
      const intent = await service.getIntent(req.params.intentId);
      res.json({ intent });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/intents/:intentId/messages", (req, res, next) => {
    try {
      const messages = service.buildOutboundMessages(req.params.intentId);
      res.json({ messages });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/intents/:intentId/submit", async (req, res, next) => {
    try {
      const intent = await service.submitIntent(req.params.intentId);
      res.json({ intent });
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

  app.post("/api/approval/:token/approve", async (req, res, next) => {
    try {
      const payload = approveSchema.parse(req.body);
      const intent = await service.approveByToken(
        req.params.token,
        payload.ownerAuth,
        payload.digest
      );
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

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
