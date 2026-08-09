import {
  assertProductEvent,
  productEventCatalog,
} from "../packages/shared-types/dist/product-analytics.js";

const baseEvent = {
  name: "feature_rollout_exposed",
  schemaVersion: 1,
  occurredAt: "2026-08-09T10:00:00.000Z",
  routeFamily: "TENANT_DASHBOARD",
  persona: "STAFF",
  featureFlags: { "web.shell-v2": false },
  properties: { featureKey: "web.shell-v2", enabled: false },
};

assertProductEvent(baseEvent);
const trustedTenantPseudonym = "a".repeat(64);
assertProductEvent(
  { ...baseEvent, tenantPseudonym: trustedTenantPseudonym },
  { trustedTenantPseudonym },
);
if (Object.keys(productEventCatalog).length !== 21) {
  throw new Error("PRODUCT_EVENT_CATALOG_COUNT_INVALID");
}

const rejected = [
  { ...baseEvent, name: "unknown_event" },
  { ...baseEvent, name: "toString", properties: undefined },
  { ...baseEvent, email: "ogrenci@example.test" },
  { ...baseEvent, properties: { tckn: "10000000146" } },
  { ...baseEvent, properties: { phone: "05551234567" } },
  { ...baseEvent, properties: { studentNo: "20260001" } },
  { ...baseEvent, properties: { fileName: "optik.txt" } },
  { ...baseEvent, properties: { answerKey: "ABCDA" } },
  { ...baseEvent, properties: { score: 480 } },
  { ...baseEvent, properties: { net: 72.5 } },
  { ...baseEvent, properties: { message: "Destek içeriği" } },
  { ...baseEvent, properties: { amount: 1250 } },
  { ...baseEvent, properties: { note: "Ödeme açıklaması" } },
  { ...baseEvent, properties: { featureKey: "https://o-okul.test/?studentId=student-a", enabled: true } },
  { ...baseEvent, tenantPseudonym: "tenant-a" },
  { ...baseEvent, tenantPseudonym: "a".repeat(64) },
  { ...baseEvent, featureFlags: { "web.shell-v2": "true" } },
  { ...baseEvent, featureFlags: { "student.20260001": true } },
  { ...baseEvent, routeFamily: "10000000146" },
  { ...baseEvent, name: "setup_step_completed", properties: { stepId: "20260001" } },
  { ...baseEvent, name: "marketing_product_evidence_viewed", properties: { section: "Ahmet_Yilmaz", assetVersion: "v1" } },
  { ...baseEvent, correlationId: "Ahmet_Yilmaz" },
  { ...baseEvent, correlationId: "20260001" },
  { ...baseEvent, correlationId: "student-a" },
  { ...baseEvent, correlationId: "https://internal/student-a" },
  { ...baseEvent, errorCode: "STUDENT_A" },
  { ...baseEvent, errorCode: "20260001" },
  { ...baseEvent, errorCode: "eyJhbGciOiJIUzI1NiJ9.secret.signature" },
  { ...baseEvent, properties: { featureKey: { nested: "web.shell-v2" }, enabled: true } },
  { ...baseEvent, properties: { featureKey: ["web.shell-v2"], enabled: true } },
];

for (const fixture of rejected) {
  let didReject = false;
  try {
    assertProductEvent(fixture);
  } catch {
    didReject = true;
  }
  if (!didReject) throw new Error("PRODUCT_EVENT_NEGATIVE_FIXTURE_ACCEPTED");
}

console.log("Product analytics schema kontrolü geçti: 2 pozitif, " + rejected.length + " negatif fixture.");
