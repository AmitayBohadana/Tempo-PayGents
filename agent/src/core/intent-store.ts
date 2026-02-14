import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  IntentDatabase,
  PolicyConfig,
  PolicyPatch,
  StoredIntent,
  StoredPushSubscription,
  Tenant,
  TenantDatabase
} from "../types.js";

const DEFAULT_POLICY: PolicyConfig = {
  maxAmount: null,
  tokenAllowlistEnforced: false,
  recipientAllowlistEnforced: false,
  allowedTokens: [],
  allowedRecipients: []
};

const DEFAULT_DB: IntentDatabase = {
  version: 2,
  nextNonce: 1,
  intents: [],
  policy: DEFAULT_POLICY,
  policiesByBotId: {},
  pushSubscriptions: []
};

const DEFAULT_TENANTS_DB: TenantDatabase = {
  version: 1,
  tenants: []
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
      const policiesByBotId: Record<string, PolicyConfig> = {};
      if (parsed.policiesByBotId && typeof parsed.policiesByBotId === "object") {
        for (const [botId, policy] of Object.entries(parsed.policiesByBotId)) {
          if (policy && typeof policy === "object") {
            policiesByBotId[botId] = normalizePolicyConfig(policy as Partial<PolicyConfig>);
          }
        }
      }

      this.database = {
        version: 2,
        nextNonce:
          typeof parsed.nextNonce === "number" && parsed.nextNonce > 0
            ? parsed.nextNonce
            : 1,
        intents: Array.isArray(parsed.intents) ? parsed.intents : [],
        policy: normalizePolicyConfig(parsed.policy ?? {}),
        policiesByBotId,
        pushSubscriptions: Array.isArray(parsed.pushSubscriptions)
          ? parsed.pushSubscriptions.filter(isStoredPushSubscription).map((sub) => ({
              ...sub,
              botId: sub.botId ?? "global"
            }))
          : []
      };
      await this.persist();
    } catch {
      await this.persist();
    }

    this.loaded = true;
  }

  list(botId?: string | null): StoredIntent[] {
    const intents = botId
      ? this.database.intents.filter((intent) => intent.botId === botId)
      : this.database.intents;

    return [...intents].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  get(intentId: string, botId?: string | null): StoredIntent | undefined {
    const intent = this.database.intents.find((candidate) => candidate.intentId === intentId);
    if (!intent) return undefined;
    if (botId && intent.botId !== botId) return undefined;
    return intent;
  }

  getByApprovalToken(token: string): StoredIntent | undefined {
    return this.database.intents.find((intent) => intent.approvalToken === token);
  }

  nextNonce(): number {
    return this.database.nextNonce;
  }

  getPolicy(botId?: string | null): PolicyConfig {
    if (!botId) {
      return { ...this.database.policy };
    }

    const policy = this.database.policiesByBotId?.[botId] ?? DEFAULT_POLICY;
    return { ...policy };
  }

  getPushSubscriptions(botId?: string | null): StoredPushSubscription[] {
    // Legacy single-tenant mode: return all subscriptions.
    if (!botId) {
      return [...this.database.pushSubscriptions];
    }

    return this.database.pushSubscriptions.filter((sub) => {
      const scope = sub.botId ?? "global";
      return scope === "global" || scope === botId;
    });
  }

  async addPushSubscription(subscription: StoredPushSubscription): Promise<void> {
    const existing = this.database.pushSubscriptions.findIndex(
      (candidate) => candidate.endpoint === subscription.endpoint
    );
    if (existing >= 0) {
      this.database.pushSubscriptions[existing] = subscription;
    } else {
      this.database.pushSubscriptions.push(subscription);
    }
    await this.persist();
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    this.database.pushSubscriptions = this.database.pushSubscriptions.filter(
      (candidate) => candidate.endpoint !== endpoint
    );
    await this.persist();
  }

  async updatePolicy(patch: PolicyPatch, botId?: string | null): Promise<PolicyConfig> {
    if (!botId) {
      this.database.policy = {
        ...this.database.policy,
        ...patch
      };
      await this.persist();
      return this.getPolicy();
    }

    const current = this.database.policiesByBotId?.[botId] ?? DEFAULT_POLICY;
    const next = {
      ...current,
      ...patch
    };
    this.database.policiesByBotId = this.database.policiesByBotId ?? {};
    this.database.policiesByBotId[botId] = next;
    await this.persist();
    return this.getPolicy(botId);
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

function isStoredPushSubscription(value: unknown): value is StoredPushSubscription {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredPushSubscription>;
  const botIdOk =
    candidate.botId === undefined ||
    candidate.botId === "global" ||
    typeof candidate.botId === "string";

  return (
    typeof candidate.endpoint === "string" &&
    botIdOk &&
    !!candidate.keys &&
    typeof candidate.keys.p256dh === "string" &&
    typeof candidate.keys.auth === "string"
  );
}

function normalizePolicyConfig(policy: Partial<PolicyConfig>): PolicyConfig {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    allowedTokens: Array.isArray(policy.allowedTokens) ? policy.allowedTokens : [],
    allowedRecipients: Array.isArray(policy.allowedRecipients) ? policy.allowedRecipients : []
  };
}

export class TenantStore {
  private filePath: string;
  private database: TenantDatabase = DEFAULT_TENANTS_DB;
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async init(): Promise<void> {
    if (this.loaded) return;

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<TenantDatabase>;
      this.database = {
        version: 1,
        tenants: Array.isArray(parsed.tenants) ? parsed.tenants.filter(isTenant) : []
      };
      await this.persist();
    } catch {
      await this.persist();
    }

    this.loaded = true;
  }

  list(): Tenant[] {
    return [...this.database.tenants];
  }

  getByApiKey(apiKey: string): Tenant | undefined {
    return this.database.tenants.find((tenant) => tenant.apiKey === apiKey);
  }

  async create(tenant: Tenant): Promise<void> {
    const existing = this.getByApiKey(tenant.apiKey);
    if (existing) {
      throw new Error("Tenant API key already exists");
    }

    this.database.tenants.push(tenant);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const tmpFile = `${this.filePath}.tmp`;
    const data = JSON.stringify(this.database, null, 2);
    await writeFile(tmpFile, data, "utf-8");
    await rename(tmpFile, this.filePath);
  }
}

function isTenant(value: unknown): value is Tenant {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Tenant>;
  return (
    typeof candidate.apiKey === "string" &&
    typeof candidate.botId === "string" &&
    typeof candidate.createdAt === "string"
  );
}
