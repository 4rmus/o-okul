import { featureRolloutKeys, type FeatureRolloutKey } from "./feature-rollout.js";

export type ProductEventOutcome = "SUCCESS" | "FAILED" | "CANCELLED";
export type ProductEventPersona = "ANONYMOUS" | "STAFF" | "TEACHER" | "STUDENT" | "GUARDIAN" | "PLATFORM";
export type ProductEventPropertyValue = boolean | number | string;
export const productEventRouteFamilies = [
  "MARKETING",
  "AUTH",
  "TENANT_DASHBOARD",
  "REGISTRY",
  "WORKFLOW",
  "MASTER_DETAIL",
  "PORTAL",
  "CONTROL_PLANE",
] as const;
export type ProductEventRouteFamily = typeof productEventRouteFamilies[number];

export const productEventCatalog = {
  marketing_product_evidence_viewed: {
    assetVersion: ["v1"],
    section: ["hero", "workflow", "evidence", "security", "pricing"],
  },
  marketing_demo_started: { sourceRoute: ["landing", "contact"] },
  marketing_demo_completed: {
    institutionType: ["K12", "COURSE_CENTER", "OTHER"],
    sizeRange: ["1-250", "251-1000", "1001-5000", "5000_PLUS"],
  },
  tenant_locator_submitted: {},
  auth_login_completed: {},
  setup_step_completed: {
    stepId: ["institution", "academic-year", "campus", "grade-level", "class", "course", "teacher", "student", "complete"],
  },
  student_import_previewed: {
    rowRange: ["1-100", "101-500", "501-1000", "1000_PLUS"],
    issueCountBucket: ["0", "1-10", "11-50", "50_PLUS"],
  },
  student_import_committed: {
    createdBucket: ["0", "1-10", "11-50", "51-250", "250_PLUS"],
    updatedBucket: ["0", "1-10", "11-50", "51-250", "250_PLUS"],
  },
  exam_readiness_changed: {
    stepId: ["participants", "answer-key", "optical", "evaluation", "report"],
    from: ["NOT_STARTED", "READY_TO_START", "QUEUED", "PROCESSING", "ACTION_REQUIRED", "READY", "FAILED", "SUPERSEDED"],
    to: ["NOT_STARTED", "READY_TO_START", "QUEUED", "PROCESSING", "ACTION_REQUIRED", "READY", "FAILED", "SUPERSEDED"],
  },
  optical_upload_completed: {
    formatPreset: ["OPTIK_7108_LGS", "OPTIK_129", "YANIT", "OPTIK_840_LGS", "CUSTOM"],
    sizeBucket: ["1-100", "101-500", "501-1000", "1000_PLUS"],
  },
  quarantine_resolution_completed: { countBucket: ["1-10", "11-50", "51-250", "250_PLUS"] },
  evaluation_completed: { participantBucket: ["1-100", "101-500", "501-1000", "1000_PLUS"] },
  report_ready: { examType: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  report_exported: { exportType: ["PDF", "XLSX"] },
  attendance_saved: { classSizeBucket: ["1-10", "11-25", "26-40", "40_PLUS"] },
  announcement_published: { audienceType: ["GUARDIANS", "SCHOOL", "STUDENTS", "TEACHERS"] },
  delivery_completed: {
    channel: ["EMAIL", "PUSH", "SMS", "WHATSAPP"],
    status: ["COMPLETED", "FAILED", "QUEUED"],
  },
  support_ticket_status_changed: {
    from: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
    to: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  },
  payment_transaction_recorded: { method: ["CASH", "BANK_TRANSFER", "CARD_POS", "OTHER"] },
  permission_changed: {
    roleFrom: ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT", "GUARDIAN"],
    roleTo: ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT", "GUARDIAN"],
    scopeMode: ["TENANT", "CAMPUSES"],
  },
  feature_rollout_exposed: {
    featureKey: featureRolloutKeys,
    enabled: [true, false],
  },
} as const;

export type ProductEventName = keyof typeof productEventCatalog;
declare const tenantPseudonymBrand: unique symbol;
export type TenantPseudonym = string & { readonly [tenantPseudonymBrand]: true };

export interface ProductEventValidationContext {
  trustedTenantPseudonym?: TenantPseudonym;
}

export interface ProductEvent {
  durationMs?: number;
  featureFlags?: Partial<Record<FeatureRolloutKey, boolean>>;
  name: ProductEventName;
  occurredAt: string;
  outcome?: ProductEventOutcome;
  persona: ProductEventPersona;
  properties?: Record<string, ProductEventPropertyValue>;
  routeFamily: ProductEventRouteFamily;
  schemaVersion: 1;
  tenantPseudonym?: TenantPseudonym;
}

const topLevelFields = new Set([
  "durationMs",
  "featureFlags",
  "name",
  "occurredAt",
  "outcome",
  "persona",
  "properties",
  "routeFamily",
  "schemaVersion",
  "tenantPseudonym",
]);
const personas = new Set<ProductEventPersona>(["ANONYMOUS", "STAFF", "TEACHER", "STUDENT", "GUARDIAN", "PLATFORM"]);
const outcomes = new Set<ProductEventOutcome>(["SUCCESS", "FAILED", "CANCELLED"]);
const routeFamilies = new Set<ProductEventRouteFamily>(productEventRouteFamilies);
const safeToken = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const forbiddenPropertyKey =
  /(adsoyad|firstname|lastname|fullname|name|tckn|tckimlik|nationalid|phone|email|studentno|filename|filecontent|answer|result|score|net|point|message|body|amount|note|query|url)/i;

export function assertProductEvent(input: unknown, context: ProductEventValidationContext = {}): ProductEvent {
  if (!isPlainObject(input)) fail("PRODUCT_EVENT_OBJECT_REQUIRED");
  for (const key of Object.keys(input)) {
    if (!topLevelFields.has(key)) fail("PRODUCT_EVENT_FIELD_FORBIDDEN:" + key);
  }

  const name = input.name;
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(productEventCatalog, name)) {
    fail("PRODUCT_EVENT_NAME_INVALID");
  }
  if (input.schemaVersion !== 1) fail("PRODUCT_EVENT_SCHEMA_VERSION_INVALID");
  if (typeof input.occurredAt !== "string" || !validIsoDate(input.occurredAt)) fail("PRODUCT_EVENT_OCCURRED_AT_INVALID");
  if (typeof input.routeFamily !== "string" || !routeFamilies.has(input.routeFamily as ProductEventRouteFamily)) {
    fail("PRODUCT_EVENT_ROUTE_FAMILY_INVALID");
  }
  if (typeof input.persona !== "string" || !personas.has(input.persona as ProductEventPersona)) {
    fail("PRODUCT_EVENT_PERSONA_INVALID");
  }
  if (input.tenantPseudonym !== undefined) {
    if (
      typeof input.tenantPseudonym !== "string"
      || !/^[a-f0-9]{64}$/.test(input.tenantPseudonym)
      || input.tenantPseudonym !== context.trustedTenantPseudonym
    ) {
      fail("PRODUCT_EVENT_TENANT_PSEUDONYM_UNTRUSTED");
    }
  }
  if (input.durationMs !== undefined && (
    typeof input.durationMs !== "number" || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 3_600_000
  )) {
    fail("PRODUCT_EVENT_DURATION_INVALID");
  }
  if (input.outcome !== undefined && (
    typeof input.outcome !== "string" || !outcomes.has(input.outcome as ProductEventOutcome)
  )) {
    fail("PRODUCT_EVENT_OUTCOME_INVALID");
  }
  validateFeatureFlags(input.featureFlags);
  validateProperties(name as ProductEventName, input.properties);
  return input as unknown as ProductEvent;
}

function validateFeatureFlags(value: unknown) {
  if (value === undefined) return;
  if (!isPlainObject(value)) fail("PRODUCT_EVENT_FEATURE_FLAGS_INVALID");
  for (const [key, enabled] of Object.entries(value)) {
    if (!featureRolloutKeys.includes(key as FeatureRolloutKey) || typeof enabled !== "boolean") {
      fail("PRODUCT_EVENT_FEATURE_FLAGS_INVALID");
    }
  }
}

function validateProperties(name: ProductEventName, value: unknown) {
  if (value === undefined) return;
  if (!isPlainObject(value)) fail("PRODUCT_EVENT_PROPERTIES_INVALID");
  const allowed = productEventCatalog[name] as Record<string, readonly ProductEventPropertyValue[]>;
  for (const [key, propertyValue] of Object.entries(value)) {
    if (forbiddenPropertyKey.test(normalizeKey(key)) || !Object.prototype.hasOwnProperty.call(allowed, key)) {
      fail("PRODUCT_EVENT_PROPERTY_FORBIDDEN:" + key);
    }
    if (!["boolean", "number", "string"].includes(typeof propertyValue)) fail("PRODUCT_EVENT_PROPERTY_VALUE_INVALID:" + key);
    if (typeof propertyValue === "number" && !Number.isFinite(propertyValue)) fail("PRODUCT_EVENT_PROPERTY_VALUE_INVALID:" + key);
    if (typeof propertyValue === "string" && (!safeToken.test(propertyValue) || unsafeValue(propertyValue))) {
      fail("PRODUCT_EVENT_PROPERTY_VALUE_INVALID:" + key);
    }
    if (!allowed[key]?.some((candidate) => candidate === propertyValue)) {
      fail("PRODUCT_EVENT_PROPERTY_VALUE_INVALID:" + key);
    }
  }
}

function unsafeValue(value: string) {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)
    || /\b\d{10,11}\b/.test(value)
    || /^data:/i.test(value)
    || /^https?:\/\/\S+\?/i.test(value)
    || /^(?:Bearer\s+|eyJ|sk-)/i.test(value);
}

function normalizeKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function validIsoDate(value: string) {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string): never {
  throw new Error(code);
}
