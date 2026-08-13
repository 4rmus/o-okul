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
  activePersona?: "STAFF" | "TEACHER" | null;
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
    await expect(trustPanel.getByText("Kişisel Bilgi Güvencesi")).toBeVisible();
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Sistem kaydı")).toHaveCount(2);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Ekran güvenliği")).toHaveCount(1);
    await expect(trustPanel).toContainText("Kişisel bilgiler açık gösterilmez");

    const kvkkSummary = page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" });
    await expect(kvkkSummary).toContainText("Kayıt toplamı");
    await expect(kvkkSummary).toContainText("Kişisel bilgiler açık gösterilmez");
    await expect(kvkkSummary).toContainText("Kategori bazlı envanter");
    await expect(kvkkSummary).toContainText("Onay zorunlu");
    await expect(kvkkSummary).toContainText("Sistem kaydı esas");
    await expect(kvkkSummary.getByLabel("KVKK operasyon özeti önerilen işlemler")).toBeVisible();
    const kvkkTable = page.getByRole("region", { name: "KVKK yönetimi" }).getByRole("table", { name: "KVKK kişisel bilgi temizleme kayıtları" });
    await expect(kvkkTable).toContainText("Öğrenci kaydı 1");
    await expect(kvkkTable).toContainText("Ad, soyad, TC, e-posta");
    await expect(kvkkTable).toContainText("Ad, soyad, telefon");
    for (const value of [...hostileEvidenceValues, ...hostileAuditValues]) {
      await expect(page.locator("body")).not.toContainText(value);
    }

    await page.getByRole("button", { name: "Öğrenci kaydı 1 kişisel bilgileri temizle" }).click();
    const purgeDialog = page.getByRole("dialog", { name: "Kişisel bilgileri temizlemeyi onayla" });
    await expect(purgeDialog).toContainText("Öğrenci kaydı 1 için geri alınamaz kişisel bilgi temizleme işlemi başlatılsın mı?");
    await expect(purgeDialog).toContainText("panel kişisel bilgileri açık göstermez");
    await expect(purgeDialog.getByRole("button", { name: "Bilgileri temizle" })).toBeVisible();
    expect(kvkkPurgeRequests).toHaveLength(0);
    await purgeDialog.getByRole("button", { name: "Vazgeç" }).click();
    expect(kvkkPurgeRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Öğrenci kaydı 1 kişisel bilgileri temizle" }).click();
    await page.getByRole("dialog", { name: "Kişisel bilgileri temizlemeyi onayla" }).getByRole("button", { name: "Bilgileri temizle" }).click();
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
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Sistem kaydı")).toHaveCount(1);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Bu ekrandaki bilgi")).toHaveCount(1);
    await expect(trustPanel.getByLabel("Kanıt kapsamı: Deneme/canlı ortam")).toHaveCount(1);
    await expect(trustPanel).toContainText("Yayın kararı için yeterli değil");
    await expect(page.getByText("Canlı ortam kontrolü bekliyor")).toBeVisible();

    const securitySummary = page.getByRole("region", { exact: true, name: "Güvenlik durumu özeti" });
    await expect(securitySummary).toContainText("Kişisel veriler gizli");
    await expect(securitySummary).toContainText("Değişiklik ayrıntıları gizli");
    await expect(securitySummary.getByLabel("Güvenlik durumu özeti önerilen işlemler")).toBeVisible();
    const securityEvents = page.getByRole("region", { name: "Son güvenlik olayları" });
    const securityEventsTable = securityEvents.getByRole("table", { name: "Güvenlik olayları" });
    await expect(securityEventsTable.getByRole("columnheader", { name: "Olay" })).toBeVisible();
    await expect(securityEventsTable.getByRole("columnheader", { name: "Kategori" })).toBeVisible();
    await expect(securityEventsTable.getByRole("columnheader", { name: "Kayıt" })).toBeVisible();
    await expect(securityEvents).toContainText("Kimlik olayı");
    await expect(securityEvents).toContainText("Kullanıcı kaydı");
    const securityGateTable = page.getByRole("region", { name: "Canlıya geçiş güvenlik kontrolleri" }).getByRole("table", { name: "Canlıya geçiş güvenlik kontrolleri" });
    await expect(securityGateTable).toContainText("SECURITY_AUDIT_TARGET=file://$PWD/docs/evidence-templates/security-audit.example.json pnpm security:audit:check");
    await expect(securityGateTable).toContainText("Bu ekrandaki bilgi");
    await expect(securityGateTable).toContainText("Yayın kararı için yeterli değil");
    await expect(securityGateTable).toContainText("pnpm prod:env:check");
    await expect(securityGateTable).toContainText("pnpm db:rls:check:live");
    await expect(securityGateTable).toContainText("pnpm traefik:https:smoke");
    await expect(securityGateTable).toContainText("Canlı kanıt");
    const securityHeaderTable = page.getByRole("region", { name: "Bağlantı güvenliği kontrolleri" }).getByRole("table", { name: "Bağlantı güvenliği kontrolleri" });
    await expect(securityHeaderTable).toContainText("Strict-Transport-Security");
    await expect(securityHeaderTable).toContainText("Content-Security-Policy");
    await expect(securityHeaderTable).toContainText("Deneme/canlı ortam");
    const securityAuthTable = page.getByRole("region", { name: "Oturum güvenliği kontrolleri" }).getByRole("table", { name: "Oturum güvenliği kontrolleri" });
    await expect(securityAuthTable).toContainText("COOKIE_SECURE=true");
    await expect(securityAuthTable).toContainText("Oturum yenileme ve iptal");
    await expect(securityAuthTable).toContainText("Giriş güvenliği");
    const securityDataTable = page.getByRole("region", { name: "Kurum ve kişisel veri güvenliği kontrolleri" }).getByRole("table", { name: "Kurum ve kişisel veri güvenliği kontrolleri" });
    await expect(securityDataTable).toContainText("Canlı veritabanı erişim kontrolü");
    await expect(securityDataTable).toContainText("Kurum verisi ayrımı");
    await expect(securityDataTable).toContainText("İşlem kayıtlarında kişisel veri gizleme");
    await expect(securityDataTable).toContainText("Sunucu kayıtları");
    await expect(securityDataTable).toContainText("Hata izleme kişisel veri ayarı");
    await expect(securityDataTable).toContainText("Kişisel veri kapalı");
    for (const table of [securityGateTable, securityHeaderTable, securityAuthTable, securityDataTable]) {
      await expect(table.getByRole("columnheader", { name: "Kontrol" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Durum" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Ortam" })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Açıklama" })).toBeVisible();
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
    await expect(auditSummary).toContainText("Bilgiler maskeli");
    await expect(auditSummary).toContainText("Kaynak: sistem kaydı");
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
    await openWithGovernanceMocks(page, "/kurum/denetim", { height: 844, width: 390 }, {
      activePersona: "STAFF",
      roles: ["TENANT_ADMIN"],
    });
    await expect(page).toHaveURL(/\/kurum\/denetim$/);
    await expect(page.getByRole("region", { exact: true, name: "Denetim operasyon özeti" })).toBeVisible();
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const auditCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await auditCommandDialog.getByLabel("Komut ara").fill("denetim");
    await expect(auditCommandDialog.getByRole("link", { exact: true, name: "Denetim Yönetim" })).toHaveAttribute("href", "/kurum/denetim");
    await auditCommandDialog.getByRole("button", { name: "Kapat" }).click();
    await page.getByRole("button", { name: "Ana menüyü aç" }).click();
    const auditNavigation = page.getByRole("navigation", { name: "Ana menü" });
    await auditNavigation.getByRole("button", { name: "Yönetim", exact: true }).click();
    await expect(auditNavigation.getByRole("link", { name: "Denetim", exact: true })).toHaveCount(0);
    await expect(auditNavigation.getByRole("link", { name: "Operasyon ve kanıt", exact: true })).toHaveAttribute("href", "/kurum/operasyon-ve-kanit");

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

  test("personasız legacy tenant admin denetim route'una fail-closed erişir", async ({ page }) => {
    const auditLogRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/audit-logs" || url.pathname === "/api/v1/audit-logs/safe-list") {
        auditLogRequests.push(request.url());
      }
    });
    await openWithGovernanceMocks(page, "/kurum/denetim", { height: 844, width: 390 }, {
      activePersona: null,
      roles: ["TENANT_ADMIN"],
    });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("table", { name: "Denetim kayıtları" })).toHaveCount(0);
    expect(auditLogRequests).toHaveLength(0);
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
    await page.getByRole("button", { name: "Komut paleti" }).click();
    const kvkkCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
    await kvkkCommandDialog.getByLabel("Komut ara").fill("kvkk");
    await expect(kvkkCommandDialog.getByRole("link", { exact: true, name: "KVKK Yönetim" })).toHaveAttribute("href", "/kurum/kvkk");
    await kvkkCommandDialog.getByRole("button", { name: "Kapat" }).click();
    await page.getByRole("button", { name: "Ana menüyü aç" }).click();
    const kvkkNavigation = page.getByRole("navigation", { name: "Ana menü" });
    await kvkkNavigation.getByRole("button", { name: "Yönetim", exact: true }).click();
    await expect(kvkkNavigation.getByRole("link", { name: "KVKK", exact: true })).toHaveCount(0);
    await expect(kvkkNavigation.getByRole("link", { name: "Operasyon ve kanıt", exact: true })).toHaveAttribute("href", "/kurum/operasyon-ve-kanit");

    await openWithGovernanceMocks(page, "/kurum/kvkk", { height: 844, width: 390 }, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("region", { exact: true, name: "KVKK operasyon özeti" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "KVKK kişisel bilgi temizleme kayıtları" })).toHaveCount(0);
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
      roles: ["TENANT_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("Canlıya geçiş doğrulama durumu"), {
      "Kanıt kapsamı: Bu ekrandaki bilgi": 1,
      "Kanıt kapsamı: Deneme/canlı ortam": 1,
      "Kanıt kapsamı: Canlı kanıt": 1,
    });
    await expectEvidenceTiers(page.getByLabel("Canlıya geçiş doğrulama durumu"), {
      evidence: 1,
      live: 1,
      reference: 1,
    });
    await expect(page.getByLabel("Canlıya geçiş doğrulama durumu")).toContainText("Yayın kararı için yeterli değil");
    await expect(page.getByLabel("Canlıya geçiş doğrulama durumu")).toContainText("Canlı kanıt gerekir");
    const liveSummary = page.getByRole("region", { exact: true, name: "Yayın hazırlığı özeti" });
    await expect(liveSummary).toContainText("Doğrulamalar");
    await expect(liveSummary).toContainText("Başarılı olmalı");
    await expect(liveSummary).toContainText("Bu ekran yalnız bilgi verir");
    await expect(liveSummary).toContainText("Yerel kontrol yeterli değildir");
    await expect(liveSummary).toContainText("Deneme ve canlı ortam sonucu gerekir");
    await expect(liveSummary).toContainText("Pilot değerlendirmesi");
    await expect(liveSummary).toContainText("Yayın işlemi");
    await expect(liveSummary.getByLabel("Yayın hazırlığı özeti önerilen işlemler")).toBeVisible();
    await expect(page.getByRole("button", { name: /Canlı yayına al|Yayınla|Go-live başlat|Release başlat/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Canlı yayına al|Yayınla|Go-live başlat|Release başlat/i })).toHaveCount(0);
    const liveGateTable = page.getByRole("table", { name: "Yayın öncesi kontroller" });
    await expect(liveGateTable).toContainText("Tüm doğrulamaları çalıştır");
    await expect(liveGateTable).toContainText("pnpm prod:evidence:check");
    await expect(liveGateTable).toContainText("pnpm pilot:check");
    await expect(liveGateTable).toContainText("GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm go-live:check");
    await expect(liveGateTable).toContainText("pnpm go-live:check");
    const productionEvidenceTable = page.getByRole("table", { name: "Canlı ortam doğrulamaları" });
    await expect(productionEvidenceTable).toContainText("Güvenli HTTPS bağlantısı");
    await expect(productionEvidenceTable).toContainText("Hata izleme test olayı");
    await expect(productionEvidenceTable).toContainText("Veritabanı değişiklik arşivi");
    await expect(productionEvidenceTable).toContainText("Harici yedek hedefi");
    await expect(productionEvidenceTable).toContainText("İzleme ve uyarı kullanıcı kabulü");
    await expect(productionEvidenceTable).toContainText("Kullanıcı kabul testi");
    const releaseSummaryTable = page.getByRole("table", { name: "Doğrulama özeti alanları" });
    await expect(releaseSummaryTable).toContainText("result = PASS");
    await expect(releaseSummaryTable).toContainText("reports.uat.rollbackImageTag");
    await expect(releaseSummaryTable).toContainText("reports.deploymentRollback.rollbackImageTag");
    const goLiveDecisionTable = page.getByRole("table", { name: "Canlıya geçiş kararları" });
    await expect(goLiveDecisionTable).toContainText("productionEvidenceSummary.summaryTarget");
    await expect(goLiveDecisionTable).toContainText("pilot.pilotDurationDays >= 14");
    await expect(goLiveDecisionTable).toContainText("pilot.criticalDefectsOpen = 0");
    await expect(goLiveDecisionTable).toContainText("operations.alertChannelReady = true");
    await expect(goLiveDecisionTable).toContainText("goLiveDecision = APPROVED");
    await expect(goLiveDecisionTable).toContainText("approvals: product / technical / operations / dataProtection");
    const externalEvidenceTable = page.getByRole("table", { name: "Dış sistem doğrulamaları" });
    await expect(externalEvidenceTable).toContainText("Deneme veya canlı ortam adresi");
    await expect(externalEvidenceTable).toContainText("Hata izleme ve uyarı kanalı");
    await expect(externalEvidenceTable).toContainText("Harici yedek ve veritabanı arşivi");
    await expect(externalEvidenceTable).toContainText("Pilot değerlendirme sonuçları");
    await expect(externalEvidenceTable).toContainText("Canlıya geçiş karar paketi");
    await expectNoHorizontalOverflow(page, "live-release-governance-mobile");
    await expectNoUnlabeledControls(page, "live-release-governance-mobile");

    await openWithGovernanceMocks(page, "/kurum/canli-yayin", { height: 900, width: 390 }, { roles: ["ASSISTANT_ADMIN"] });
    await expect(page).toHaveURL(/\/kurum$/);
    await expect(page.getByRole("region", { exact: true, name: "Yayın hazırlığı özeti" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Yayın Hazırlığı" })).toHaveCount(0);

    await openWithGovernanceMocks(page, "/kurum/uat-rollback", { height: 900, width: 768 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("Kullanıcı kabulü ve geri dönüş durumu"), {
      "Kanıt kapsamı: Deneme/canlı ortam": 1,
      "Kanıt kapsamı: Canlı kanıt": 1,
      "Kanıt kapsamı: Sistem kaydı": 1,
    });
    await expect(page.getByLabel("Kullanıcı kabulü ve geri dönüş durumu")).toContainText("Canlı kanıt gerekir");
    const uatSummary = page.getByRole("region", { exact: true, name: "Kullanıcı kabulü ve geri dönüş özeti" });
    await expect(uatSummary).toContainText("Yalnızca kontrol");
    await expect(uatSummary).toContainText("Yayın doğrulaması ayrıca yapılır");
    await expect(uatSummary.getByLabel("Kullanıcı kabulü ve geri dönüş özeti önerilen işlemler")).toBeVisible();
    const uatScenarioTable = page.getByRole("table", { name: "Kullanıcı yolculuğu senaryoları" });
    await expect(uatScenarioTable).toContainText("Kurum yolculuğu 1");
    await expect(uatScenarioTable).toContainText("Mevcut veli erişimi 3");
    await expect(uatScenarioTable.getByText("UAT-KURUM-01", { exact: true })).toBeHidden();
    await expect(uatScenarioTable.getByText("UAT-GUARDIAN-03", { exact: true })).toBeHidden();
    await openAllTechnicalDetails(uatScenarioTable);
    await expect(uatScenarioTable.getByText("UAT-KURUM-01", { exact: true })).toBeVisible();
    await expect(uatScenarioTable.getByText("UAT-GUARDIAN-03", { exact: true })).toBeVisible();
    const uatCommandTable = page.getByRole("table", { name: "Yayın öncesi zorunlu kontroller" });
    await expect(uatCommandTable).toContainText("Kurum verisi ayrımı");
    await expect(uatCommandTable).toContainText("Güvenli bağlantı");
    await openAllTechnicalDetails(uatCommandTable);
    await expect(uatCommandTable.getByText("pnpm db:rls:check:live", { exact: true })).toBeVisible();
    await expect(uatCommandTable.getByText("pnpm traefik:https:smoke", { exact: true })).toBeVisible();
    const rollbackFieldTable = page.getByRole("table", { name: "Geri dönüş için zorunlu bilgiler" });
    await expect(rollbackFieldTable).toContainText("Geri dönülecek sürüm");
    await expect(rollbackFieldTable).toContainText("Geri yüklenecek yedek");
    await expect(rollbackFieldTable).toContainText("Açık sorun yok");
    await openAllTechnicalDetails(rollbackFieldTable);
    await expect(rollbackFieldTable.getByText("rollbackImageTag", { exact: true })).toBeVisible();
    await expect(rollbackFieldTable.getByText("restoreBackupReference", { exact: true })).toBeVisible();
    await expect(rollbackFieldTable.getByText("defects boş", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, "uat-rollback-governance-tablet");

    await openWithGovernanceMocks(page, "/kurum/yedek-restore", { height: 900, width: 390 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
    });
    await expectEvidenceScopes(page.getByLabel("Yedekleme ve geri yükleme güven durumu"), {
      "Kanıt kapsamı: Bağlı sistem": 1,
      "Kanıt kapsamı: Ekran güvenliği": 1,
      "Kanıt kapsamı: Deneme/canlı ortam": 1,
    });
    await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu")).toContainText("Kişisel bilgiler açık gösterilmez");
    await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu")).toContainText("Yayın doğrulaması ayrıca yapılır");
    const backupSummary = page.getByRole("region", { exact: true, name: "Yedekleme ve geri yükleme operasyon özeti" });
    await expect(backupSummary).toContainText("Kurum yedeği");
    await expect(backupSummary).toContainText("İndirilebilir");
    await expect(backupSummary).not.toContainText("tenant-export-v1");
    await expect(backupSummary).toContainText("Kişisel bilgiler maskeli");
    await expect(backupSummary.getByLabel("Yedekleme ve geri yükleme operasyon özeti önerilen işlemler")).toBeVisible();
    await expect(page.getByRole("button", { name: "Kurum verisini indir" })).toBeVisible();
    const backupJobsTable = page.getByRole("table", { name: "Yedekleme ve geri yükleme işleri" });
    await expect(backupJobsTable).toContainText("Yedekleme");
    await expect(backupJobsTable).toContainText("Geri yükleme tatbikatı");
    await expect(backupJobsTable).toContainText("s3://<redacted>");
    await expect(backupJobsTable).toContainText("file://<redacted>");
    await expect(backupJobsTable).toContainText("İş referansı maskeli");
    await expect(backupJobsTable).not.toContainText("s3://governance-prod-backups/tenant-governance");
    await expect(backupJobsTable).not.toContainText("file:///mnt/restore-drills/tenant-governance/restore-drill.json");
    await expect(backupJobsTable).not.toContainText("backup-restore-job-secret");
    await expect(backupJobsTable).not.toContainText("user-governance-admin");
    const backupGateTable = page.getByRole("table", { name: "Yedekleme ve geri yükleme kanıtları" });
    await expect(backupGateTable).toContainText("Yerel geri yükleme kontrolü");
    await expect(backupGateTable.getByText("pnpm backup:restore:smoke", { exact: true })).toBeHidden();
    await openAllTechnicalDetails(backupGateTable);
    await expect(backupGateTable.getByText("pnpm backup:restore:smoke", { exact: true })).toBeVisible();
    await expect(backupGateTable.locator("code").filter({ hasText: "pnpm backup:offsite:smoke" })).toBeVisible();
    await expect(backupGateTable.locator("code").filter({ hasText: "pnpm wal:archive:smoke" })).toBeVisible();
    await expect(backupGateTable.locator("code").filter({ hasText: "pnpm restore:drill:check" })).toBeVisible();
    const restoreReportTable = page.getByRole("table", { name: "Geri yükleme tatbikatı rapor alanları" });
    await expect(restoreReportTable).toContainText("Kontrol ortamı: deneme veya canlı");
    await openAllTechnicalDetails(restoreReportTable);
    await expect(restoreReportTable.getByText("environment = staging veya production", { exact: true })).toBeVisible();
    const criticalTables = page.getByRole("table", { name: "Kritik geri yükleme tabloları" });
    await expect(criticalTables).toContainText("Veritabanı güncelleme kayıtları");
    await openAllTechnicalDetails(criticalTables);
    await expect(criticalTables.getByText("_prisma_migrations", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, "backup-restore-governance-mobile");
    await expectNoUnlabeledControls(page, "backup-restore-governance-mobile");
  });

  test("sağlık ve gözlemlenebilirlik kısmi endpoint hatasında kanıtı düşürmez", async ({ page }) => {
    await openWithGovernanceMocks(page, "/kurum/sistem-sagligi", { height: 900, width: 390 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      systemEndpoints: "partial-metrics-failure",
    });
    const healthTrustPanel = page.getByLabel("Sistem sağlığı doğrulama durumu");
    await expectEvidenceScopes(healthTrustPanel, {
      "Kanıt kapsamı: Bu ekrandaki bilgi": 0,
      "Kanıt kapsamı: Bağlı sistem": 2,
      "Kanıt kapsamı: Deneme/canlı ortam": 1,
    });
    const healthSummary = page.getByRole("region", { exact: true, name: "Sistem sağlığı özeti" });
    await expect(healthSummary).toContainText("Kontrol kapsamı");
    await expect(healthSummary).toContainText("Bağlantı durumu");
    await expect(healthSummary.getByLabel("Sistem sağlığı özeti önerilen işlemler")).toBeVisible();
    const dependencyTable = page.getByRole("table", { name: "Sistem bağlantıları ve kullanım durumu" });
    await expect(dependencyTable).toContainText("Veritabanı");
    await expect(dependencyTable).toContainText("Hızlı erişim");
    await expect(dependencyTable).toContainText("Web istekleri");
    await expect(dependencyTable).not.toContainText("Postgres");
    await expect(dependencyTable).not.toContainText("Redis");
    const healthDetails = page.getByRole("region", { name: "Teknik sistem kontrolleri" });
    const healthEndpointTable = healthDetails.getByRole("table", { name: "Teknik sistem kontrol adresleri" });
    await expect(healthEndpointTable).toBeHidden();
    await openAllTechnicalDetails(page.locator("main"));
    await expect(healthEndpointTable).toBeVisible();
    await expect(healthEndpointTable).toContainText("/health");
    await expect(healthEndpointTable).toContainText("/health/ready");
    await expect(healthEndpointTable).toContainText("/metrics");
    await expect(healthEndpointTable).toContainText("200 tamam");
    await expect(healthEndpointTable).toContainText("Bağlantı kurulamadı");
    await expect(page.getByText("Sağlık bilgisi alınamadı.")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "system-health-partial-mobile");

    await openWithGovernanceMocks(page, "/kurum/gozlemlenebilirlik", { height: 900, width: 768 }, {
      roles: ["TENANT_ADMIN", "SYSTEM_ADMIN"],
      systemEndpoints: "partial-metrics-failure",
    });
    const observabilityTrustPanel = page.getByLabel("Sistem izleme doğrulama durumu");
    await expectEvidenceScopes(observabilityTrustPanel, {
      "Kanıt kapsamı: Bu ekrandaki bilgi": 0,
      "Kanıt kapsamı: Bağlı sistem": 2,
      "Kanıt kapsamı: Canlı kanıt": 1,
      "Kanıt kapsamı: Deneme/canlı ortam": 1,
    });
    const observabilitySummary = page.getByRole("region", { exact: true, name: "Sistem izleme özeti" });
    await expect(observabilitySummary).toContainText("Kontrol kapsamı");
    await expect(observabilitySummary).toContainText("Uyarı kanalı");
    await expect(observabilitySummary).toContainText("İzleme panoları");
    await expect(observabilitySummary).toContainText("Anlık durum kısmi");
    await expect(observabilitySummary.getByLabel("Sistem izleme özeti önerilen işlemler")).toBeVisible();
    const observabilitySignals = page.getByRole("region", { name: "Anlık sistem durumu" });
    const observabilitySignalTable = observabilitySignals.getByRole("table", { name: "Anlık sistem kontrol adresleri" });
    await expect(observabilitySignalTable).toContainText("Uygulama");
    await expect(observabilitySignalTable).toContainText("Bağlantılar");
    await expect(observabilitySignalTable).toContainText("Kullanım bilgileri");
    await expect(observabilitySignalTable).not.toContainText("/health");
    await expect(page.getByLabel("Uyarı kuralları", { exact: true })).toContainText("Uyarı ve hata izleme kanalları");
    await expect(page.getByLabel("İzleme panoları", { exact: true })).toContainText("Temel sistem göstergeleri ve uygulama kayıtları");
    const observabilityDetails = page.getByRole("region", { name: "Teknik bağlantı adresleri" });
    const observabilityEndpointTable = observabilityDetails.getByRole("table", { name: "Teknik bağlantı adresleri" });
    await expect(observabilityEndpointTable).toBeHidden();
    await openAllTechnicalDetails(page.locator("main"));
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Kontrol" })).toBeVisible();
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Durum" })).toBeVisible();
    await expect(observabilityEndpointTable.getByRole("columnheader", { name: "Açıklama" })).toBeVisible();
    await expect(observabilityEndpointTable).toContainText("/health");
    await expect(observabilityEndpointTable).toContainText("/health/ready");
    await expect(observabilityEndpointTable).toContainText("/metrics");
    await expect(observabilityEndpointTable).toContainText("200 tamam");
    await expect(observabilityEndpointTable).toContainText("Bağlantı kurulamadı");
    await expect(page.getByLabel("Sistem izleme teknik kontrolleri", { exact: true })).toContainText("observability:uat:check");
    await expect(page.getByLabel("Sistem izleme teknik kontrolleri", { exact: true })).toContainText("alert:webhook:smoke");
    await expect(page.getByLabel("Sistem izleme teknik kontrolleri", { exact: true })).toContainText("sentry:smoke");
    await expect(page.getByText("Sistem izleme bilgisi alınamadı.")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "observability-partial-tablet");
  });
});

async function openAllTechnicalDetails(scope: Locator) {
  const summaries = scope.getByText("İleri ayrıntılar", { exact: true });
  for (let index = 0; index < await summaries.count(); index += 1) {
    const summary = summaries.nth(index);
    if ((await summary.locator("..").getAttribute("open")) === null) {
      await summary.click();
    }
  }
}

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
  if (pathName === "/auth/refresh") return { data: createAuthResponse(options.roles, options.activePersona) };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/institution-dashboard") return { data: createInstitutionDashboardResponse() };
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

function createAuthResponse(roles = ["TENANT_ADMIN"], activePersona: "STAFF" | "TEACHER" | null = "STAFF") {
  return {
    accessToken: "governance-access-token",
    session: {
      id: "session-governance",
      ...(activePersona ? { activePersona } : {}),
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

function createInstitutionDashboardResponse() {
  return {
    activeStudentCount: 0,
    attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
    generatedAt: "2026-06-17T10:00:00.000Z",
    institution: { name: "Governance Akademi" },
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

async function expectEvidenceTiers(region: Locator, expectedCounts: Record<string, number>) {
  for (const [tier, count] of Object.entries(expectedCounts)) {
    await expect(region.locator(`[data-evidence-tier="${tier}"]`)).toHaveCount(count);
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
