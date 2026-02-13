import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IntentDatabase, StoredIntent } from "../types.js";

const DEFAULT_DB: IntentDatabase = {
  version: 1,
  nextNonce: 1,
  intents: []
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
      const parsed = JSON.parse(raw) as IntentDatabase;
      this.database = parsed;
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
