import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IntentDatabase, PolicyConfig, PolicyPatch, StoredIntent } from "../types.js";

const DEFAULT_POLICY: PolicyConfig = {
  maxAmount: null,
  tokenAllowlistEnforced: false,
  recipientAllowlistEnforced: false,
  allowedTokens: [],
  allowedRecipients: []
};

const DEFAULT_DB: IntentDatabase = {
  version: 1,
  nextNonce: 1,
  intents: [],
  policy: DEFAULT_POLICY
};

export class IntentStore {
  private filePath: string;
  private database: IntentDatabase = DEFAULT_DB;
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<IntentDatabase>;
      this.database = {
        version: 1,
        nextNonce:
          typeof parsed.nextNonce === "number" && parsed.nextNonce > 0
            ? parsed.nextNonce
            : 1,
        intents: Array.isArray(parsed.intents) ? parsed.intents : [],
        policy: {
          ...DEFAULT_POLICY,
          ...(parsed.policy ?? {}),
          allowedTokens: Array.isArray(parsed.policy?.allowedTokens)
            ? parsed.policy.allowedTokens
            : [],
          allowedRecipients: Array.isArray(parsed.policy?.allowedRecipients)
            ? parsed.policy.allowedRecipients
            : []
        }
      };
      await this.persist();
    } catch {
      await this.persist();
    }

    this.loaded = true;
  }

  list(): StoredIntent[] {
    return [...this.database.intents].sort((a, b) =>
      a.createdAt > b.createdAt ? -1 : 1
    );
  }

  get(intentId: string): StoredIntent | undefined {
    return this.database.intents.find((intent) => intent.intentId === intentId);
  }

  getByApprovalToken(token: string): StoredIntent | undefined {
    return this.database.intents.find((intent) => intent.approvalToken === token);
  }

  nextNonce(): number {
    return this.database.nextNonce;
  }

  getPolicy(): PolicyConfig {
    return { ...this.database.policy };
  }

  async updatePolicy(patch: PolicyPatch): Promise<PolicyConfig> {
    this.database.policy = {
      ...this.database.policy,
      ...patch
    };
    await this.persist();
    return this.getPolicy();
  }

  async create(intent: StoredIntent): Promise<void> {
    this.database.intents.push(intent);
    this.database.nextNonce += 1;
    await this.persist();
  }

  async update(intent: StoredIntent): Promise<void> {
    const index = this.database.intents.findIndex(
      (candidate) => candidate.intentId === intent.intentId
    );
    if (index === -1) {
      throw new Error(`Intent ${intent.intentId} not found`);
    }

    this.database.intents[index] = intent;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const tmpFile = `${this.filePath}.tmp`;
    const data = JSON.stringify(this.database, null, 2);
    await writeFile(tmpFile, data, "utf-8");
    await rename(tmpFile, this.filePath);
  }
}
