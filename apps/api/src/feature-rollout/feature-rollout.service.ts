import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  featureRolloutKeys,
  type FeatureRolloutCatalogItem,
  type FeatureRolloutKey,
  type ResolvedFeatureRollouts,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";

export const featureRolloutCatalog: FeatureRolloutCatalogItem[] = featureRolloutKeys.map((featureKey) => ({
  featureKey,
  defaultEnabled: false as const,
  owner: ownerFor(featureKey),
  expiresAt: "2026-11-07T00:00:00.000Z",
  removalIssue: removalIssueFor(featureKey),
}));

interface RolloutEntry {
  environment: RolloutEnvironment;
  tenantId: string;
  startsAt: number;
  expiresAt: number;
}

type RolloutEnvironment = "local" | "staging" | "production";

@Injectable()
export class FeatureRolloutService {
  private readonly environment = parseRolloutEnvironment(
    process.env.FEATURE_ROLLOUT_ENVIRONMENT,
    process.env.FEATURE_ROLLOUTS_JSON,
  );
  private readonly entries = parseFeatureRolloutConfig(process.env.FEATURE_ROLLOUTS_JSON);

  constructor(private readonly auditLogs: AuditLogService) {}

  async resolve(context: RequestContext, now = new Date()): Promise<ResolvedFeatureRollouts> {
    assertTenantContext(context);
    const timestamp = now.getTime();
    const enabledFeatureKeys = featureRolloutCatalog
      .filter((item) => timestamp < Date.parse(item.expiresAt))
      .filter((item) => this.entries.get(item.featureKey)?.some((entry) => (
        entry.environment === this.environment
        && entry.tenantId === context.tenantId
        && timestamp >= entry.startsAt
        && timestamp < entry.expiresAt
      )))
      .map((item) => item.featureKey);

    if (enabledFeatureKeys.length > 0) {
      await this.auditLogs.record({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        entityType: "FeatureRollout",
        action: "feature_rollout.exposed",
        diff: { featureKeys: enabledFeatureKeys },
      });
    }

    return { enabledFeatureKeys };
  }

  async assertEnabled(context: RequestContext, featureKey: FeatureRolloutKey, now = new Date()): Promise<void> {
    const resolved = await this.resolve(context, now);
    if (!resolved.enabledFeatureKeys.includes(featureKey)) {
      throw new ForbiddenException("FEATURE_ROLLOUT_DISABLED");
    }
  }
}

export function parseFeatureRolloutConfig(raw: string | undefined): Map<FeatureRolloutKey, RolloutEntry[]> {
  if (raw === undefined) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidConfig("JSON");
  }
  if (!isPlainObject(parsed)) throw invalidConfig("ROOT");

  const result = new Map<FeatureRolloutKey, RolloutEntry[]>();
  for (const [key, value] of Object.entries(parsed)) {
    if (!isFeatureRolloutKey(key)) throw invalidConfig("UNKNOWN_KEY");
    if (!Array.isArray(value)) throw invalidConfig("ENTRIES");

    const entryKeys = new Set<string>();
    const entries = value.map((entry): RolloutEntry => {
      if (
        !isPlainObject(entry)
        || Object.keys(entry).sort().join(",") !== "environment,expiresAt,reference,startsAt,tenantId"
      ) {
        throw invalidConfig("ENTRY_FIELDS");
      }
      const { environment, tenantId, startsAt, expiresAt, reference } = entry;
      if (![environment, tenantId, startsAt, expiresAt, reference]
        .every((field) => typeof field === "string" && field.trim().length > 0)) {
        throw invalidConfig("ENTRY_VALUES");
      }
      if (!isRolloutEnvironment(environment)) throw invalidConfig("ENVIRONMENT");
      if (!safeIdentifier(tenantId as string)) throw invalidConfig("TENANT_ID");
      const entryKey = `${environment}:${tenantId as string}`;
      if (entryKeys.has(entryKey)) throw invalidConfig("DUPLICATE_TENANT");
      entryKeys.add(entryKey);

      const start = Date.parse(startsAt as string);
      const expiry = Date.parse(expiresAt as string);
      if (
        !Number.isFinite(start)
        || !Number.isFinite(expiry)
        || new Date(start).toISOString() !== startsAt
        || new Date(expiry).toISOString() !== expiresAt
        || start >= expiry
      ) throw invalidConfig("DATE_RANGE");
      if (expiry - start > 90 * 24 * 60 * 60 * 1000) throw invalidConfig("DURATION");
      if (!safeReference(reference as string)) throw invalidConfig("REFERENCE");

      return { environment, tenantId: tenantId as string, startsAt: start, expiresAt: expiry };
    });
    result.set(key, entries);
  }
  return result;
}

function assertTenantContext(context: RequestContext): asserts context is RequestContext & { tenantId: string } {
  if (!context.tenantId || context.bypassRls) throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
}

function isFeatureRolloutKey(value: string): value is FeatureRolloutKey {
  return (featureRolloutKeys as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRolloutEnvironment(value: string | undefined, config: string | undefined): RolloutEnvironment {
  if (config === undefined) return "local";
  if (!isRolloutEnvironment(value)) throw invalidConfig("RUNTIME_ENVIRONMENT");
  return value;
}

function isRolloutEnvironment(value: unknown): value is RolloutEnvironment {
  return value === "local" || value === "staging" || value === "production";
}

function safeIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !unsafeIdentifier(value);
}

function safeReference(value: string): boolean {
  return /^(?:DEC-\d{8}-\d{2}|[A-Z]{2,8}-\d{1,8})$/.test(value);
}

function unsafeIdentifier(value: string): boolean {
  return /@/.test(value) || /\d{10,}/.test(value);
}

function invalidConfig(reason: string): Error {
  return new Error(`FEATURE_ROLLOUTS_CONFIG_INVALID:${reason}`);
}

function ownerFor(key: FeatureRolloutKey): string {
  if (key === "web.exam-workspace-v2") return "exam-reporting";
  if (key === "web.control-plane-v2") return "platform-operations";
  if (key === "product.guardian-read-only") return "product-iam";
  return "frontend-experience";
}

function removalIssueFor(key: FeatureRolloutKey): string {
  const issueByKey: Record<FeatureRolloutKey, string> = {
    "web.ia-v2": "UI-02",
    "web.shell-v2": "UI-03",
    "web.exam-workspace-v2": "EX-02",
    "web.student-registry-v2": "ST-01",
    "web.setup-v2": "SET-02",
    "web.teacher-portal-v2": "TP-02",
    "web.student-portal-v2": "SP-02",
    "web.control-plane-v2": "CP-02",
    "product.guardian-read-only": "IAM-04",
  };
  return issueByKey[key];
}
