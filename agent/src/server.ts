import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { z } from "zod";
import { IntentStore } from "./core/intent-store.js";
import { IntentService } from "./core/intent-service.js";
import { MockChainSubmitter } from "./chain/mock-chain.js";
import { AppError } from "./core/errors.js";

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

export async function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const port = Number(process.env.PORT ?? 8787);
  const chainId = Number(process.env.CHAIN_ID ?? 12345);
  const verifyingContract =
    process.env.VERIFYING_CONTRACT ?? "0x000000000000000000000000000000000000dEaD";
  const approvalTokenTtlSec = Number(process.env.APPROVAL_TOKEN_TTL_SEC ?? 600);
  const approvalBaseUrl =
    process.env.APPROVAL_BASE_URL ?? `http://localhost:${port}/approve`;
  const autoSubmitOnApprove = process.env.AUTO_SUBMIT_ON_APPROVE !== "false";
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

  const service = new IntentService(store, new MockChainSubmitter(), {
    approvalTokenTtlSec,
    chainId,
    verifyingContract,
    approvalBaseUrl,
    autoSubmitOnApprove
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
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

  app.get("/api/intents", async (_req, res, next) => {
    try {
      const intents = await service.listIntents();
      res.json({ intents });
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
