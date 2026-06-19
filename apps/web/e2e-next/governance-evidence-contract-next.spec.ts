import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const hostileEvidenceValues = [
  "12345678901",
  "+905551110001",
  "admin-a@example.test",
  "guardian finance permission",
  "rolePreviewToken=legacy-token",
] as const;

const hostileAuditValues = [
  "actorUserId",
  "entityId",
  "diff",
  "user-governance-admin",
  "tenant-governance",
  "auth.login admin-a@example.test",
  "support_ticket.created",
  "Gizli destek konusu",
  "support-ticket-a",
  "User guardian finance permission",
  "role-preview-secret-url",
] as const;

interface GovernanceMockOptions {
  auditSafeListFailure?: boolean;
  roles?: string[];
  systemEndpoints?: "partial-metrics-failure";
}

test.describe("Governance evidence sözleşmesi", () => {
  test("KVKK güven paneli kanıt kapsamını PII taşımadan gösterir", async ({ page }) => {
    const kvkkPurgeRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/students/student-a/purge-pii" && request.method() === "POST") {
        kvkkPurgeRequests.push(request.url());
      }
    });

    await openWithGovernanceMocks(page, "/kurum/kvkk", { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });

    const trustPanel = page.getByLabel("KVKK güven durumu");
    await expect(trustPanel.getByText("PII İşlem Güvencesi")).toBeVisible();
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Sunucu/audit")).toHaveCount(2);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: UI güvenli")).toHaveCount(1);
    await expect(trustPanel).toContainText("PII ham gösterilmez");

    const kvkkSummary = page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" });
    await expect(kvkkSummary).toContainText("Kayıt toplamı");
    await expect(kvkkSummary).toContainText("PII ham gösterilmez");
    await expect(kvkkSummary).toContainText("Kategori bazlı envanter");
    await expect(kvkkSummary).toContainText("Onay zorunlu");
    await expect(kvkkSummary).toContainText("Server/audit esas");
    await expect(kvkkSummary.getByLabel("KVKK operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const kvkkTable = page.getByRole("region", { name: "KVKK yönetimi" }).getByRole("table", { name: "KVKK PII temizleme kayıtları" });
    await expect(kvkkTable).toContainText("Öğrenci kaydı 1");
    await expect(kvkkTable).toContainText("Ad, soyad, TC, e-posta");
    await expect(kvkkTable).toContainText("Ad, soyad, telefon");
    for (const value of [...hostileEvidenceValues, ...hostileAuditValues]) {
      await expect(page.locator("body")).not.toContainText(value);
    }

    await page.getByRole("button", { name: "Öğrenci kaydı 1 PII temizle" }).click();
    const purgeDialog = page.getByRole("dialog", { name: "PII temizlemeyi onayla" });
    await expect(purgeDialog).toContainText("Öğrenci kaydı 1 için geri alınamaz PII temizleme işlemi başlatılsın mı?");
    await expect(purgeDialog).toContainText("panel ham PII kanıtı göstermez");
    await expect(purgeDialog.getByRole("button", { name: "PII temizle" })).toBeVisible();
    expect(kvkkPurgeRequests).toHaveLength(0);
    await purgeDialog.getByRole("button", { name: "Vazgeç" }).click();
    expect(kvkkPurgeRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Öğrenci kaydı 1 PII temizle" }).click();
    await page.getByRole("dialog", { name: "PII temizlemeyi onayla" }).getByRole("button", { name: "PII temizle" }).click();
    await expect.poll(() => kvkkPurgeRequests.length).toBe(1);
    await expect(kvkkTable).toContainText("Öğrenci kaydı 1");
    await expect(kvkkTable).toContainText("Temiz");

    await expectNoHorizontalOverflow(page, "kvkk-governance-mobile");
    await expectNoUnlabeledControls(page, "kvkk-governance-mobile");
  });

  test("güvenlik denetimi local/static ile staging/prod kanıtı ayırır ve audit PII basmaz", async ({ page }) => {
    const securitySafeAuditListRequests: string[] = [];
    const securityRawAuditLogRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/audit-logs/safe-list") {
        securitySafeAuditListRequests.push(request.url());
      }
      if (url.pathname === "/api/v1/audit-logs") {
        securityRawAuditLogRequests.push(request.url());
      }
    });

    await openWithGovernanceMocks(page, "/kurum/guvenlik-denetimi", { height: 1024, width: 768 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });

    await expect.poll(() => securitySafeAuditListRequests.length).toBe(1);
    const securitySafeListUrl = new URL(securitySafeAuditListRequests[0]!);
    expect(securitySafeListUrl.searchParams.get("sort")).toBe("-createdAt");
    expect(securitySafeListUrl.searchParams.get("limit")).toBe("20");
    const trustPanel = page.getByLabel("Güvenlik güven durumu");
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Sunucu/audit")).toHaveCount(1);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Yerel/statik")).toHaveCount(1);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Staging/prod")).toHaveCount(1);
    await expect(trustPanel).toContainText("Release kararına yetmez");
    await expect(page.getByText("Staging/prod kanıt bekliyor")).toBeVisible();

    const securitySummary = page.getByRole("region", { exact: true, name: "Güvenlik denetimi operasyon özeti" });
    await expect(securitySummary).toContainText("Safe-list audit");
    await expect(securitySummary).toContainText("PII ham gösterilmez");
    await expect(securitySummary.getByLabel("Güvenlik denetimi operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const securityEvents = page.getByRole("region", { name: "Son güvenlik olayları" });
    const securityEventsTable = securityEvents.getByRole("table", { name: "Güvenlik olayları" });
    await expect(securityEventsTable.getByRole("columnheader", { name: "Olay" })).toBeVisible();
    await expect(securityEventsTable.getByRole("columnheader", { name: "Kategori" })).toBeVisible();
    await expect(securityEventsTable.getByRole("columnheader", { name: "Kayıt" })).toBeVisible();
    await expect(securityEvents).toContainText("Kimlik olayı");
    await expect(securityEvents).toContainText("Kullanıcı kaydı");
    const securityGateTable = page.getByRole("region", { name: "Güvenlik denetimi kapıları" }).getByRole("table", { name: "Güvenlik denetimi kanıt kapıları" });
    await expect(securityGateTable).toContainText("SECURITY_AUDIT_TARGET=file://$PWD/docs/evidence-templates/security-audit.example.json pnpm security:audit:check");
    await expect(securityGateTable).toContainText("Yerel/statik");
    await expect(securityGateTable).toContainText("Release kararına yetmez");
    await expect(securityGateTable).toContainText("pnpm prod:env:check");
    await expect(securityGateTable).toContainText("pnpm db:rls:check:live");
    await expect(securityGateTable).toContainText("pnpm traefik:https:smoke");
    await expect(securityGateTable).toContainText("Canlı kanıt");
    const securityHeaderTable = page.getByRole("region", { name: "Header kontrolleri" }).getByRole("table", { name: "Güvenlik header kontrolleri" });
    await expect(securityHeaderTable).toContainText("Strict-Transport-Security");
    await expect(securityHeaderTable).toContainText("Content-Security-Policy");
    await expect(securityHeaderTable).toContainText("Staging/prod");
    const securityAuthTable = page.getByRole("region", { name: "Auth kontrolleri" }).getByRole("table", { name: "Güvenlik auth kontrolleri" });
    await expect(securityAuthTable).toContainText("COOKIE_SECURE=true");
    await expect(securityAuthTable).toContainText("refresh session revocation");
    await expect(securityAuthTable).toContainText("Auth/session");
    const securityDataTable = page.getByRole("region", { name: "Veri kontrolleri" }).getByRole("table", { name: "Güvenlik veri kontrolleri" });
    await expect(securityDataTable).toContainText("RLS live check");
    await expect(securityDataTable).toContainText("RLS canlı");
    await expect(securityDataTable).toContainText("audit PII redaction");
    await expect(securityDataTable).toContainText("Sunucu/audit");
    await expect(securityDataTable).toContainText("SENTRY_SEND_DEFAULT_PII=false");
    for (const table of [securityGateTable, securityHeaderTable, securityAuthTable, securityDataTable]) {
      await expect(table.getByRole("columnheader", { name: "Kontrol" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Durum" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Kapsam" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Bağlam" })).toBeVisible();
    }
    for (const value of [...hostileEvidenceValues, ...hostileAuditValues]) {
      await expect(page.locator("body")).not.toContainText(value);
    }
    expect(securityRawAuditLogRequests).toHaveLength(0);

    await expectNoHorizontalOverflow(page, "security-governance-tablet");
    await expectNoUnlabeledControls(page, "security-governance-tablet");

    await openWithGovernanceMocks(page, "/kurum/guvenlik-denetimi", { height: 844, width: 390 }, {
      auditSafeListFailure: true,
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    const failedSecurityEventsTable = page.getByRole("region", { name: "Son güvenlik olayları" }).getByRole("table", { name: "Güvenlik olayları" });
    await expect(failedSecurityEventsTable).toContainText("Güvenlik olayları alınamadı.");
    await expect(failedSecurityEventsTable).not.toContainText("Güvenlik olayı yok");
    await expectNoHorizontalOverflow(page, "security-governance-mobile");
    await expectNoUnlabeledControls(page, "security-governance-mobile");
  });

  test("denetim listesi audit alanlarını PII-safe operasyon özetine çevirir", async ({ page }) => {
    const safeAuditListRequests: string[] = [];
    const rawAuditLogRequests: string[] = [];
    const safeAuditListResponses: Array<Promise<string>> = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/audit-logs/safe-list") {
        safeAuditListRequests.push(request.url());
      }
      if (url.pathname === "/api/v1/audit-logs") {
        rawAuditLogRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname === "/api/v1/audit-logs/safe-list") {
        safeAuditListResponses.push(response.text());
      }
    });

    await openWithGovernanceMocks(page, "/kurum/denetim?page=2&limit=20&q=auth&sort=-createdAt", {
      height: 844,
      width: 390,
    }, { roles: ["TENANT_ADMIN"] });

    await expect.poll(() => safeAuditListRequests.length).toBe(1);
    expect(rawAuditLogRequests).toHaveLength(0);
    const safeAuditListUrl = new URL(safeAuditListRequests[0]!);
    expect(safeAuditListUrl.searchParams.get("page")).toBe("2");
    expect(safeAuditListUrl.searchParams.get("limit")).toBe("20");
    expect(safeAuditListUrl.searchParams.get("q")).toBe("auth");
    expect(safeAuditListUrl.searchParams.get("sort")).toBe("-createdAt");
    await expect.poll(() => safeAuditListResponses.length).toBe(1);
    const safeAuditPayload = await safeAuditListResponses[0]!;
    for (const value of [...hostileEvidenceValues, ...hostileAuditValues]) {
      expect(safeAuditPayload).not.toContain(value);
    }

    const auditRegion = page.getByRole("region", { name: "Denetim kayıtları" });
    const auditSummary = page.getByRole("region", { exact: true, name: "Denetim operasyon özeti" });
    await expect(auditSummary).toContainText("Kayıt toplamı");
    await expect(auditSummary).toContainText("PII maskeli");
    await expect(auditSummary).toContainText("Server/audit kaynağı");
    await expect(auditSummary).toContainText("Salt-okuma");

    await expect(auditRegion.getByLabel("Ara")).toHaveValue("auth");
    await expect(auditRegion.getByLabel("Sırala")).toHaveValue("-createdAt");
    await expect(auditRegion.getByLabel("Göster")).toHaveValue("20");

    const auditTable = page.getByRole("table", { name: "Denetim kayıtları" });
    await expect(auditTable).toContainText("Oturum açıldı");
    await expect(auditTable).toContainText("Finans görünürlüğü güncellendi");
    await expect(auditTable).toContainText("Kimlik kaydı");
    await expect(auditTable).toContainText("Finans görünürlüğü kaydı");
    await expect(auditTable).toContainText("Kullanıcı kaydı");

    for (const value of hostileEvidenceValues) {
      await expect(page.locator("body")).not.toContainText(value);
    }
    for (const value of hostileAuditValues) {
      await expect(page.locator("body")).not.toContainText(value);
    }
    await expect(page.locator("body")).not.toContainText("actorUserId");
    await expect(page.locator("body")).not.toContainText("entityId");
    await expect(page.locator("body")).not.toContainText("diff");
    await expect(page.locator("body")).not.toContainText("Gizli destek konusu");

    await expectNoHorizontalOverflow(page, "audit-governance-mobile");
    await expectNoUnlabeledControls(page, "audit-governance-mobile");
  });

  test("denetim route erişimi audit capability ile hizalıdır", async ({ page }) => {
    await openWithGovernanceMocks(page, "/kurum/denetim", { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum\/denetim$/);
    await expect(page.getByRole("region", { exact: true, name: "Denetim operasyon özeti" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Denetim", exact: true })).toHaveCount(0);

    const assistantAuditLogRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/audit-logs" || url.pathname === "/api/v1/audit-logs/safe-list") {
        assistantAuditLogRequests.push(request.url());
      }
    });
    await openWithGovernanceMocks(page, "/kurum/denetim", { height: 844, width: 390 }, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("table", { name: "Denetim kayıtları" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Denetim", exact: true })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "KVKK" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Güvenlik Denetimi" })).toHaveCount(0);
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const assistantCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await assistantCommandDialog.getByLabel("Komut ara").fill("denetim");
    await expect(assistantCommandDialog.getByRole("link", { name: /Denetim/ })).toHaveCount(0);
    await assistantCommandDialog.getByLabel("Komut ara").fill("kvkk");
    await expect(assistantCommandDialog.getByRole("link", { name: /KVKK/ })).toHaveCount(0);
    await assistantCommandDialog.getByRole("button", { name: "Kapat" }).click();
    expect(assistantAuditLogRequests).toHaveLength(0);
  });

  test("KVKK route erişimi privacy capability ile hizalıdır", async ({ page }) => {
    const kvkkPurgeRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes("/purge-pii")) {
        kvkkPurgeRequests.push(request.url());
      }
    });

    await openWithGovernanceMocks(page, "/kurum/kvkk", { height: 844, width: 390 }, { roles: ["TENANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum\/kvkk$/);
    await expect(page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" })).toBeVisible();

    await openWithGovernanceMocks(page, "/kurum/kvkk", { height: 844, width: 390 }, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "KVKK PII temizleme kayıtları" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "KVKK" })).toHaveCount(0);
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const assistantCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await assistantCommandDialog.getByLabel("Komut ara").fill("kvkk");
    await expect(assistantCommandDialog.getByRole("link", { name: /KVKK/ })).toHaveCount(0);
    await assistantCommandDialog.getByRole("button", { name: "Kapat" }).click();
    expect(kvkkPurgeRequests).toHaveLength(0);
  });

  test("release ve operasyon kanıt panelleri kapsam ayrımını görünür tutar", async ({ page }) => {
    await openWithGovernanceMocks(page, "/kurum/canli-yayin", { height: 900, width: 390 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("Canlı yayın güven durumu"), {
      "Kanıt kapsamı: Yerel/statik": 1,
      "Kanıt kapsamı: Staging/prod": 1,
      "Kanıt kapsamı: Canlı kanıt": 1,
    });
    await expect(page.getByLabel("Canlı yayın güven durumu")).toContainText("Release kararına yetmez");
    await expect(page.getByLabel("Canlı yayın güven durumu")).toContainText("Canlı kanıt gerekir");
    const liveSummary = page.getByRole("region", { exact: true, name: "Canlı yayın operasyon özeti" });
    await expect(liveSummary).toContainText("Kanıt zinciri");
    await expect(liveSummary).toContainText("PASS gerekir");
    await expect(liveSummary).toContainText("CLI-only");
    await expect(liveSummary).toContainText("Yerel/static karar vermez");
    await expect(liveSummary).toContainText("Staging/prod evidence");
    await expect(liveSummary).toContainText("Pilot kapanış");
    await expect(liveSummary).toContainText("Panel aksiyonu");
    await expect(liveSummary.getByLabel("Canlı yayın operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(page.getByRole("button", { name: /Canlı yayına al|Yayınla|Go-live başlat|Release başlat/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Canlı yayına al|Yayınla|Go-live başlat|Release başlat/i })).toHaveCount(0);
    const liveGateTable = page.getByRole("table", { name: "Canlı yayın kanıt kapıları" });
    await expect(liveGateTable).toContainText("Toplu kanıt zinciri");
    await expect(liveGateTable).toContainText("pnpm prod:evidence:check");
    await expect(liveGateTable).toContainText("pnpm pilot:check");
    await expect(liveGateTable).toContainText("GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm go-live:check");
    await expect(liveGateTable).toContainText("pnpm go-live:check");
    const productionEvidenceTable = page.getByRole("table", { name: "Production evidence adımları" });
    await expect(productionEvidenceTable).toContainText("Traefik HTTPS");
    await expect(productionEvidenceTable).toContainText("Sentry test event");
    await expect(productionEvidenceTable).toContainText("WAL archive target");
    await expect(productionEvidenceTable).toContainText("Off-host backup target");
    await expect(productionEvidenceTable).toContainText("Observability UAT evidence");
    await expect(productionEvidenceTable).toContainText("UAT evidence");
    const releaseSummaryTable = page.getByRole("table", { name: "Release özeti alanları" });
    await expect(releaseSummaryTable).toContainText("result = PASS");
    await expect(releaseSummaryTable).toContainText("reports.uat.rollbackImageTag");
    await expect(releaseSummaryTable).toContainText("reports.deploymentRegion.datacenterCountryCode");
    await expect(releaseSummaryTable).toContainText("reports.deploymentRollback.rollbackImageTag");
    const goLiveDecisionTable = page.getByRole("table", { name: "Go-live karar alanları" });
    await expect(goLiveDecisionTable).toContainText("productionEvidenceSummary.summaryTarget");
    await expect(goLiveDecisionTable).toContainText("pilot.pilotDurationDays >= 14");
    await expect(goLiveDecisionTable).toContainText("pilot.criticalDefectsOpen = 0");
    await expect(goLiveDecisionTable).toContainText("operations.alertChannelReady = true");
    await expect(goLiveDecisionTable).toContainText("goLiveDecision = APPROVED");
    await expect(goLiveDecisionTable).toContainText("approvals: product / technical / operations / dataProtection");
    const externalEvidenceTable = page.getByRole("table", { name: "Dış ortam kanıtları" });
    await expect(externalEvidenceTable).toContainText("Staging/prod domain");
    await expect(externalEvidenceTable).toContainText("Sentry DSN ve alert webhook");
    await expect(externalEvidenceTable).toContainText("Off-host backup ve WAL hedefi");
    await expect(externalEvidenceTable).toContainText("Pilot kapanış kanıtı");
    await expect(externalEvidenceTable).toContainText("TR datacenter/provider kanıtı");
    await expect(externalEvidenceTable).toContainText("Go-live karar paketi");
    await expectNoHorizontalOverflow(page, "live-release-governance-mobile");
    await expectNoUnlabeledControls(page, "live-release-governance-mobile");

    await openWithGovernanceMocks(page, "/kurum/uat-rollback", { height: 900, width: 768 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("UAT rollback güven durumu"), {
      "Kanıt kapsamı: Staging/prod": 1,
      "Kanıt kapsamı: Canlı kanıt": 1,
      "Kanıt kapsamı: Sunucu/audit": 1,
    });
    await expect(page.getByLabel("UAT rollback güven durumu")).toContainText("Canlı kanıt gerekir");
    const uatSummary = page.getByRole("region", { exact: true, name: "UAT rollback operasyon özeti" });
    await expect(uatSummary).toContainText("CLI-only");
    await expect(uatSummary).toContainText("Release kanıtı ayrı");
    await expect(uatSummary.getByLabel("UAT rollback operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const uatScenarioTable = page.getByRole("table", { name: "UAT persona senaryoları" });
    await expect(uatScenarioTable).toContainText("UAT-KURUM-01");
    await expect(uatScenarioTable).toContainText("UAT-GUARDIAN-03");
    const uatCommandTable = page.getByRole("table", { name: "UAT zorunlu komutları" });
    await expect(uatCommandTable).toContainText("pnpm db:rls:check:live");
    await expect(uatCommandTable).toContainText("pnpm traefik:https:smoke");
    const rollbackFieldTable = page.getByRole("table", { name: "Rollback zorunlu alanları" });
    await expect(rollbackFieldTable).toContainText("rollbackImageTag");
    await expect(rollbackFieldTable).toContainText("restoreBackupReference");
    await expect(rollbackFieldTable).toContainText("defects boş");
    await expectNoHorizontalOverflow(page, "uat-rollback-governance-tablet");

    await openWithGovernanceMocks(page, "/kurum/yedek-restore", { height: 900, width: 390 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("Yedek restore güven durumu"), {
      "Kanıt kapsamı: Yapılandırılmış API": 1,
      "Kanıt kapsamı: UI güvenli": 1,
      "Kanıt kapsamı: Staging/prod": 1,
    });
    await expect(page.getByLabel("Yedek restore güven durumu")).toContainText("PII ham gösterilmez");
    await expect(page.getByLabel("Yedek restore güven durumu")).toContainText("Release kanıtı ayrı");
    const backupSummary = page.getByRole("region", { exact: true, name: "Yedek restore operasyon özeti" });
    await expect(backupSummary).toContainText("tenant-export-v1");
    await expect(backupSummary).toContainText("PII maskeli");
    await expect(backupSummary.getByLabel("Yedek restore operasyon özeti aksiyon kuyruğu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Kurum verisini indir" })).toBeVisible();
    const backupJobsTable = page.getByRole("table", { name: "Yedek restore işleri" });
    await expect(backupJobsTable).toContainText("Yedek alma");
    await expect(backupJobsTable).toContainText("Restore drill");
    await expect(backupJobsTable).toContainText("s3://<redacted>");
    await expect(backupJobsTable).toContainText("file://<redacted>");
    await expect(backupJobsTable).toContainText("İş referansı maskeli");
    await expect(backupJobsTable).not.toContainText("s3://governance-prod-backups/tenant-governance");
    await expect(backupJobsTable).not.toContainText("file:///mnt/restore-drills/tenant-governance/restore-drill.json");
    await expect(backupJobsTable).not.toContainText("backup-restore-job-secret");
    await expect(backupJobsTable).not.toContainText("user-governance-admin");
    const backupGateTable = page.getByRole("table", { name: "Yedek restore kanıt kapıları" });
    await expect(backupGateTable).toContainText("backup:restore:smoke");
    await expect(backupGateTable).toContainText("backup:offsite:smoke");
    await expect(backupGateTable).toContainText("wal:archive:smoke");
    await expect(backupGateTable).toContainText("restore:drill:check");
    await expect(page.getByRole("table", { name: "Restore drill rapor alanları" })).toContainText("environment = staging veya production");
    await expect(page.getByRole("table", { name: "Kritik restore tabloları" })).toContainText("_prisma_migrations");
    await expectNoHorizontalOverflow(page, "backup-restore-governance-mobile");
    await expectNoUnlabeledControls(page, "backup-restore-governance-mobile");
  });

  test("sağlık ve gözlemlenebilirlik kısmi endpoint hatasında kanıtı düşürmez", async ({ page }) => {
    await openWithGovernanceMocks(page, "/kurum/sistem-sagligi", { height: 900, width: 390 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      systemEndpoints: "partial-metrics-failure",
    });
    const healthTrustPanel = page.getByLabel("Sistem sağlık güven durumu");
    await expectEvidenceScopes(healthTrustPanel, {
      "Kanıt kapsamı: Yerel/statik": 1,
      "Kanıt kapsamı: Yapılandırılmış API": 1,
      "Kanıt kapsamı: Staging/prod": 1,
    });
    const healthSummary = page.getByRole("region", { exact: true, name: "Sistem sağlık operasyon özeti" });
    await expect(healthSummary).toContainText("Endpoint kapsamı");
    await expect(healthSummary).toContainText("Bağımlılık hazırlığı");
    await expect(healthSummary.getByLabel("Sistem sağlık operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const dependencyTable = page.getByRole("table", { name: "Sistem bağımlılık durumu" });
    await expect(dependencyTable).toContainText("Postgres");
    await expect(dependencyTable).toContainText("Redis");
    await expect(dependencyTable).toContainText("HTTP istek sayacı");
    const healthDetails = page.getByRole("region", { name: "Sistem sağlık detayları" });
    const healthEndpointTable = healthDetails.getByRole("table", { name: "Sistem sağlık endpointleri" });
    await expect(healthEndpointTable).toBeVisible();
    await expect(healthEndpointTable).toContainText("/health");
    await expect(healthEndpointTable).toContainText("/health/ready");
    await expect(healthEndpointTable).toContainText("/metrics");
    await expect(healthEndpointTable).toContainText("200 tamam");
    await expect(healthEndpointTable).toContainText("Endpoint yanıt vermedi.");
    await expect(page.getByText("Sağlık bilgisi alınamadı.")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "system-health-partial-mobile");

    await openWithGovernanceMocks(page, "/kurum/gozlemlenebilirlik", { height: 900, width: 768 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      systemEndpoints: "partial-metrics-failure",
    });
    const observabilityTrustPanel = page.getByLabel("Gözlemlenebilirlik güven durumu");
    await expectEvidenceScopes(observabilityTrustPanel, {
      "Kanıt kapsamı: Yerel/statik": 1,
      "Kanıt kapsamı: Yapılandırılmış API": 1,
      "Kanıt kapsamı: Canlı kanıt": 1,
      "Kanıt kapsamı: Staging/prod": 1,
    });
    const observabilitySummary = page.getByRole("region", { exact: true, name: "Gözlemlenebilirlik operasyon özeti" });
    await expect(observabilitySummary).toContainText("Endpoint kapsamı");
    await expect(observabilitySummary).toContainText("Alert kanalı");
    await expect(observabilitySummary).toContainText("Dashboard kanıtı");
    await expect(observabilitySummary).toContainText("Endpoint kısmi");
    await expect(observabilitySummary.getByLabel("Gözlemlenebilirlik operasyon özeti aksiyon kuyruğu")).toBeVisible();
    const observabilityDetails = page.getByRole("region", { name: "Gözlemlenebilirlik detayları" });
    const observabilityEndpointTable = observabilityDetails.getByRole("table", { name: "Gözlemlenebilirlik endpointleri" });
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Sinyal" })).toBeVisible();
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Bağlam" })).toBeVisible();
    await expect(observabilityEndpointTable).toContainText("/health");
    await expect(observabilityEndpointTable).toContainText("/health/ready");
    await expect(observabilityEndpointTable).toContainText("/metrics");
    await expect(observabilityEndpointTable).toContainText("200 tamam");
    await expect(observabilityEndpointTable).toContainText("Endpoint yanıt vermedi.");
    await expect(page.getByLabel("Alert kuralları")).toContainText("Webhook ve Sentry");
    await expect(page.getByLabel("Dashboard panelleri")).toContainText("Grafana ve Loki");
    await expect(page.getByLabel("Gözlemlenebilirlik kapıları")).toContainText("observability:uat:check");
    await expect(page.getByLabel("Gözlemlenebilirlik kapıları")).toContainText("alert:webhook:smoke");
    await expect(page.getByLabel("Gözlemlenebilirlik kapıları")).toContainText("sentry:smoke");
    await expect(page.getByText("Gözlemlenebilirlik bilgisi alınamadı.")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "observability-partial-tablet");
  });
});

async function openWithGovernanceMocks(
  page: Page,
  pathName: string,
  viewport: { height: number; width: number },
  options: GovernanceMockOptions = {},
) {
  await page.setViewportSize(viewport);
  await installGovernanceApiMocks(page, options);
  await installSystemEndpointMocks(page, options.systemEndpoints);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installGovernanceApiMocks(page: Page, options: GovernanceMockOptions = {}) {
  await page.unroute("**/api/v1/**").catch(() => undefined);
  let kvkkInventory = createKvkkInventory();
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    if (pathName === "/privacy/inventory") {
      await fulfillData(route, kvkkInventory);
      return;
    }
    if (pathName === "/students/student-a/purge-pii" && route.request().method() === "POST") {
      kvkkInventory = kvkkInventory.map((item) =>
        item.id === "student-a" ? { ...item, piiCategories: [], purgeAvailable: false } : item,
      );
      await fulfillData(route, createPurgedStudent());
      return;
    }

    const response = mockGovernanceApiResponse(pathName, options);
    await fulfillData(route, response.data, response.meta, response.status);
  });
}

async function installSystemEndpointMocks(page: Page, mode: "partial-metrics-failure" | undefined) {
  await page.unroute("**/health").catch(() => undefined);
  await page.unroute("**/health/ready").catch(() => undefined);
  await page.unroute("**/metrics").catch(() => undefined);
  if (!mode) return;

  await page.route("**/health", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ status: "ok" }),
      headers: { "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/health/ready", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ dependencies: { postgres: "ok", redis: "ok" }, status: "ready" }),
      headers: { "content-type": "application/json" },
      status: 200,
    });
  });
  await page.route("**/metrics", async (route) => {
    await route.abort("failed");
  });
}

function mockGovernanceApiResponse(pathName: string, options: GovernanceMockOptions = {}): { data: unknown; meta?: ListMeta; status?: number } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse(options.roles) };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/students") return { data: createStudents() };
  if (pathName === "/students/student-a/purge-pii") return { data: createPurgedStudent() };
  if (pathName === "/teachers") return { data: createTeachers() };
  if (pathName === "/guardians") return { data: createGuardians() };
  if (pathName === "/audit-logs/safe-list" && options.auditSafeListFailure) return { data: { error: { message: "SAFE_LIST_FAILED" } }, status: 500 };
  if (pathName === "/audit-logs/safe-list") return listResponse(createSafeAuditLogs());
  if (pathName === "/audit-logs") return listResponse(createAuditLogs());
  if (pathName === "/backup-restore-jobs") return { data: createBackupRestoreJobs() };

  return { data: [] };
}

function createKvkkInventory() {
  return [
    {
      displayRef: "Öğrenci kaydı 1",
      id: "student-a",
      kind: "student",
      piiCategories: ["Ad", "soyad", "TC", "e-posta"],
      purgeAvailable: true,
    },
    {
      displayRef: "Veli kaydı 1",
      id: "guardian-a",
      kind: "guardian",
      piiCategories: ["Ad", "soyad", "telefon"],
      purgeAvailable: false,
    },
  ];
}

function createAuthResponse(roles = ["TENANT_ADMIN"]) {
  return {
    accessToken: "governance-access-token",
    session: {
      id: "session-governance",
      membershipVersion: 1,
      roles,
      status: "ACTIVE",
      tenantId: "tenant-governance",
      userId: "user-governance-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@governance-akademi.example",
    id: "tenant-governance",
    institutionType: "Dershane",
    name: "Governance Akademi",
  };
}

function createStudents() {
  return [
    {
      classId: "class-8a",
      email: "admin-a@example.test",
      firstName: "Ada",
      id: "student-a",
      lastName: "Güven",
      nationalId: "12345678901",
      status: "ACTIVE",
      studentNo: "8001",
      tenantId: "tenant-governance",
    },
  ];
}

function createPurgedStudent() {
  return {
    classId: "class-8a",
    firstName: "Anonim",
    id: "student-a",
    lastName: "Ogrenci",
    status: "ACTIVE",
    studentNo: "8001",
    tenantId: "tenant-governance",
  };
}

function createTeachers() {
  return [
    {
      branch: "Matematik",
      email: "admin-a@example.test",
      firstName: "Zeynep",
      id: "teacher-a",
      lastName: "Denetim",
      nationalId: "12345678901",
      tenantId: "tenant-governance",
    },
  ];
}

function createGuardians() {
  return [
    {
      firstName: "Ayse",
      id: "guardian-a",
      lastName: "Veli",
      phone: "+905551110001",
      tenantId: "tenant-governance",
      userId: "admin-a@example.test",
    },
  ];
}

function createAuditLogs() {
  return [
    {
      action: "auth.login admin-a@example.test 12345678901 rolePreviewToken=legacy-token",
      actorUserId: "user-governance-admin",
      createdAt: "2026-06-17T10:00:00.000Z",
      diff: { redirect: "https://example.test/role-preview-secret-url?rolePreviewToken=legacy-token" },
      entityId: "+905551110001",
      entityType: "Auth admin-a@example.test",
      id: "audit-hostile-auth",
      tenantId: "tenant-governance",
    },
    {
      action: "user.guardian finance permission changed +905551110001",
      actorUserId: "user-governance-admin",
      createdAt: "2026-06-17T10:01:00.000Z",
      diff: { oldValue: "guardian finance permission", path: "/tmp/export/12345678901" },
      entityId: "12345678901",
      entityType: "User guardian finance permission",
      id: "audit-hostile-user",
      tenantId: "tenant-governance",
    },
    {
      action: "support_ticket.created Gizli destek konusu",
      actorUserId: "user-governance-admin",
      createdAt: "2026-06-17T10:02:00.000Z",
      diff: { subject: "Gizli destek konusu" },
      entityId: "support-ticket-a",
      entityType: "SupportTicket",
      id: "audit-hostile-support",
      tenantId: "tenant-governance",
    },
  ];
}

function createSafeAuditLogs() {
  return [
    {
      actionLabel: "Oturum açıldı",
      actorLabel: "Kullanıcı kaydı",
      category: "identity",
      createdAt: "2026-06-17T10:00:00.000Z",
      entityLabel: "Kimlik kaydı",
      id: "audit-safe-auth",
    },
    {
      actionLabel: "Finans görünürlüğü güncellendi",
      actorLabel: "Kullanıcı kaydı",
      category: "finance",
      createdAt: "2026-06-17T10:01:00.000Z",
      entityLabel: "Finans görünürlüğü kaydı",
      id: "audit-safe-user",
    },
    {
      actionLabel: "Kullanıcı kaydı güncellendi",
      actorLabel: "Kullanıcı kaydı",
      category: "user",
      createdAt: "2026-06-17T10:02:00.000Z",
      entityLabel: "Kullanıcı kaydı",
      id: "audit-safe-user-event",
    },
  ];
}

function createBackupRestoreJobs() {
  return [
    {
      checkedTables: ["Tenant", "AuditLog"],
      createdAt: "2026-06-17T10:03:00.000Z",
      id: "backup-restore-job-secret-backup",
      jobId: "backup-restore-job-secret-backup",
      operationType: "BACKUP",
      reason: "Panelden korumalı yedek alma",
      requestedByUserId: "user-governance-admin",
      result: "PASS",
      status: "completed",
      targetReference: "s3://governance-prod-backups/tenant-governance",
      tenantId: "tenant-governance",
      updatedAt: "2026-06-17T10:04:00.000Z",
    },
    {
      checkedTables: ["ReportSnapshot", "_prisma_migrations"],
      createdAt: "2026-06-17T10:05:00.000Z",
      id: "backup-restore-job-secret-restore",
      jobId: "backup-restore-job-secret-restore",
      operationType: "RESTORE_DRILL",
      reason: "Aylık restore kanıtı",
      requestedByUserId: "user-governance-admin",
      status: "queued",
      targetReference: "file:///mnt/restore-drills/tenant-governance/restore-drill.json",
      tenantId: "tenant-governance",
      updatedAt: "2026-06-17T10:05:00.000Z",
    },
  ];
}

interface ListMeta {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

function listResponse(data: unknown[]): { data: unknown[]; meta: ListMeta } {
  return {
    data,
    meta: {
      limit: Math.max(data.length, 1),
      page: 1,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
    },
  };
}

async function fulfillData(route: Route, data: unknown, meta?: ListMeta, status = 200) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: {
      ...corsHeadersFor(route),
      "content-type": "application/json",
    },
    status,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectEvidenceScopes(region: Locator, expectedCounts: Record<string, number>) {
  for (const [label, count] of Object.entries(expectedCounts)) {
    await expect(region.getByLabel(label)).toHaveCount(count);
  }
}

async function expectNoUnlabeledControls(page: Page, label: string) {
  const unlabeledControls = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter((element) => element.getAttribute("aria-hidden") !== "true")
      .filter((element) => isVisible(element))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent?.trim();
        const ariaLabel = htmlElement.getAttribute("aria-label")?.trim();
        const labelledBy = htmlElement.getAttribute("aria-labelledby")?.trim();
        const id = htmlElement.getAttribute("id");
        const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const wrappingLabel = htmlElement.closest("label");
        return !text && !ariaLabel && !labelledBy && !label && !wrappingLabel;
      })
      .map((element) => element.outerHTML.slice(0, 120));
  });

  expect(unlabeledControls, `${label}: etiketsiz kontrol`).toEqual([]);
}
