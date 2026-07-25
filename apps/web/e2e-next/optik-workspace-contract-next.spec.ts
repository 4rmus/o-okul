import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

const rawImportId = "raw-import-optik-12345678901";
const rawParseJobId = "parse-job-optik-admin-a@example.test";
const rawEvaluationJobId = "evaluation-job-optik-admin-a@example.test";
const rawImportHash = "abcdef1234567890fedcba0987654321";
const rawImportFileName = "optik-12345678901-admin-a@example.test.txt";
const quarantineRawNationalId = "12345678909";
const quarantineRawEmail = "raw-row-only@example.test";
const quarantineRawAnswers = "ABCDEABCDEABCDEABCDEABCDE";
const quarantineRawLine = `${quarantineRawNationalId} NIL GIZLI ${quarantineRawAnswers} ${quarantineRawEmail}`;
const hostileOptikReferences = [
  rawImportId,
  rawParseJobId,
  rawEvaluationJobId,
  rawImportHash,
  rawImportFileName,
  quarantineRawNationalId,
  quarantineRawEmail,
  quarantineRawAnswers,
  quarantineRawLine,
] as const;
const newOpticalFormCases = [
  {
    preset: "OPTIK_129_TYT",
    name: "OPTİK 129 — TYT",
    rowLength: 223,
    questionCount: 120,
    rows: [
      ["TC KİMLİK NO", "37", "47"],
      ["OKUL NO", "12", "16"],
      ["KİTAPÇIK TÜRÜ", "56", "56"],
      ["AD SOYAD", "17", "36"],
      ["TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", "57", "96"],
      ["SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", "97", "142"],
      ["MATEMATİK", "143", "182"],
      ["FEN BİLİMLERİ", "183", "223"],
    ],
  },
  {
    preset: "OPTIK_129_AYT",
    name: "OPTİK 129 — AYT",
    rowLength: 223,
    questionCount: 160,
    rows: [
      ["TC KİMLİK NO", "37", "47"],
      ["OKUL NO", "12", "16"],
      ["KİTAPÇIK TÜRÜ", "56", "56"],
      ["AD SOYAD", "17", "36"],
      ["TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", "57", "96"],
      ["SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", "97", "142"],
      ["MATEMATİK", "143", "182"],
      ["FEN BİLİMLERİ", "183", "223"],
    ],
  },
  {
    preset: "YANIT_TYT",
    name: "YANIT TYT",
    rowLength: 233,
    questionCount: 120,
    rows: [
      ["TC KİMLİK NO", "13", "23"],
      ["OKUL NO", "7", "12"],
      ["KİTAPÇIK TÜRÜ", "49", "49"],
      ["AD SOYAD", "24", "43"],
      ["TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", "50", "95"],
      ["SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", "96", "141"],
      ["MATEMATİK", "142", "187"],
      ["FEN BİLİMLERİ", "188", "233"],
    ],
  },
  {
    preset: "YANIT_AYT",
    name: "YANIT AYT",
    rowLength: 233,
    questionCount: 160,
    rows: [
      ["TC KİMLİK NO", "13", "23"],
      ["OKUL NO", "7", "12"],
      ["KİTAPÇIK TÜRÜ", "49", "49"],
      ["AD SOYAD", "24", "43"],
      ["TÜRKÇE / TÜRK DİLİ VE EDEBİYATI - SOSYAL BİLİMLER - 1", "50", "95"],
      ["SOSYAL BİLİMLER / SOSYAL BİLİMLER - 2", "96", "141"],
      ["MATEMATİK", "142", "187"],
      ["FEN BİLİMLERİ", "188", "233"],
    ],
  },
  {
    preset: "OPTIK_840_LGS",
    name: "OPTİK 840 — LGS",
    rowLength: 280,
    questionCount: 90,
    rows: [
      ["TC KİMLİK NO", "35", "45"],
      ["OKUL NO", "10", "14"],
      ["KİTAPÇIK TÜRÜ", "60", "60"],
      ["AD SOYAD", "15", "34"],
      ["TÜRKÇE", "161", "180"],
      ["SOSYAL BİLGİLER / T.C. İNKILAP TARİHİ VE ATATÜRKÇÜLÜK", "181", "200"],
      ["DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", "201", "220"],
      ["İNGİLİZCE", "221", "240"],
      ["MATEMATİK", "241", "260"],
      ["FEN BİLİMLERİ", "261", "280"],
    ],
  },
] as const;

test.describe("Optik çalışma alanı sözleşmesi", () => {
  test("aktif sınav ve adım URL state ile korunur", async ({ page }) => {
    await openWithOptikMocks(page, "/kurum/optik?examId=exam-optik&tab=upload");

    await expect(page.getByRole("tab", { name: "2. Optik yükleme" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-optik");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("upload");

    await page.getByRole("tab", { name: "3. Eşleşmeyen satırlar" }).click();
    await expect(page.getByRole("tab", { name: "3. Eşleşmeyen satırlar" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-optik");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("quarantine");

    await page.getByRole("tab", { name: "1. Format" }).click();
    await expect(page.getByRole("tab", { name: "1. Format" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-optik");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBeNull();
  });

  test("yeni TXT/DAT presetleri soru sayısı, satır uzunluğu ve kolon önizlemesini korur", async ({ page }) => {
    const suggestionBodies: Array<Record<string, unknown>> = [];
    const approvalBodies: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const pathName = new URL(request.url()).pathname;
      if (pathName.endsWith("/parser-configs/suggestions")) {
        suggestionBodies.push(request.postDataJSON() as Record<string, unknown>);
      }
      if (pathName.endsWith("/parser-configs/approvals")) {
        approvalBodies.push(request.postDataJSON() as Record<string, unknown>);
      }
    });

    await openWithOptikMocks(page, "/kurum/optik");

    const presetSelect = page.getByRole("combobox", { name: "Kayıtlı TXT/DAT formu" });
    const selectedFormSummary = page.getByLabel("Seçili form özeti");
    const formPreviewTable = page.getByRole("table", { name: "Optik form alan önizlemesi" });
    const unverifiedPresetAlert = page.getByRole("status").filter({ hasText: "Gerçek TXT/DAT örneği bekleniyor" });

    await expect(unverifiedPresetAlert).toHaveCount(0);

    for (const testCase of newOpticalFormCases) {
      await presetSelect.selectOption(testCase.preset);
      await expect(presetSelect).toHaveValue(testCase.preset);
      await expect(presetSelect.locator("option:checked")).toHaveText(testCase.name);
      await expect(selectedFormSummary).toContainText(`${testCase.rowLength} karakter`);
      await expect(selectedFormSummary).toContainText(`${testCase.questionCount} soru`);
      await expect(unverifiedPresetAlert).toBeVisible();
      await expect(unverifiedPresetAlert).toContainText("referans görsel kolonlarından türetildi");
      await expect(unverifiedPresetAlert).toContainText("gerçek üretici TXT/DAT dosyasıyla henüz doğrulanmadı");
      await expect(unverifiedPresetAlert).toContainText("Kullanıcı bunu bilerek seçiyor");
      await expect(unverifiedPresetAlert).toContainText(
        "Tablo fiziksel kolon kapasitesini, soru sayısı seçilen modda okunan mantıksal cevapları gösterir.",
      );
      await expect(formPreviewTable.locator("tbody tr")).toHaveCount(testCase.rows.length);

      for (const [index, [section, start, end]] of testCase.rows.entries()) {
        const row = formPreviewTable.locator("tbody tr").nth(index);
        await expect(row.locator('[data-column-key="section"]')).toHaveText(section);
        await expect(row.locator('[data-column-key="start"]')).toHaveText(start);
        await expect(row.locator('[data-column-key="end"]')).toHaveText(end);
      }
    }

    await page.getByRole("button", { name: "Seç ve ilerle" }).click();
    await expect.poll(() => suggestionBodies).toEqual([{ preset: "OPTIK_840_LGS" }]);
    await expect.poll(() => approvalBodies).toHaveLength(1);
    expect(approvalBodies[0]).toMatchObject({ version: "optik-840-lgs-v1" });
  });

  test("mobilde optik akışı rapor çalışma alanına güvenli geçiş verir", async ({ page }) => {
    const broadStudentRequests: string[] = [];
    const studentDetailRequests: string[] = [];
    const studentSearchRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") return;
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/v1/students/")) {
        studentDetailRequests.push(url.toString());
        return;
      }
      if (url.pathname !== "/api/v1/students") return;
      if (url.search) {
        studentSearchRequests.push(url.toString());
      } else {
        broadStudentRequests.push(url.toString());
      }
    });

    await openWithOptikMocks(page, "/kurum/optik");

    await expect(page.getByRole("heading", { level: 1, name: "Optik İşlemleri" })).toBeVisible();
    const workflowStrip = page.getByRole("region", { name: "Optik iş akışı" });
    await expect(workflowStrip).toHaveClass(/uh-info-grid/);
    await expect(workflowStrip.locator(".uh-info-item")).toHaveCount(4);
    await expect(workflowStrip).toContainText("Format");
    await expect(workflowStrip).toContainText("Format bekliyor");
    await expect(workflowStrip).toContainText("Yükleme");
    await expect(workflowStrip).toContainText("Dosya bekliyor");
    await expect(workflowStrip).toContainText("Analiz");
    await expect(workflowStrip).toContainText("Yükleme bekliyor");
    await expect(workflowStrip).toContainText("Çıktı");
    await expect(workflowStrip).toContainText("Analiz bekliyor");
    await expect(page.getByRole("tab", { name: "1. Format" })).toHaveAttribute("aria-selected", "true");
    const selectedFormSummary = page.getByLabel("Seçili form özeti");
    await expect(selectedFormSummary).toHaveClass(/uh-info-grid/);
    await expect(selectedFormSummary.locator(".uh-info-item")).toHaveCount(4);
    await expect(selectedFormSummary).toContainText("90 soru");
    const parserSummary = page.locator(".next-parser-summary").first();
    await expect(parserSummary).toHaveClass(/uh-info-grid/);
    await expect(parserSummary.locator(".uh-info-item")).toHaveCount(1);
    await expect(parserSummary).toContainText("Format seçimi bekliyor");
    const formPreviewTable = page.getByRole("table", { name: "Optik form alan önizlemesi" });
    await expect(formPreviewTable.getByRole("columnheader", { name: "Bölüm" })).toBeVisible();
    await expect(formPreviewTable.locator('th[data-column-key="section"]')).toHaveAttribute("data-mobile-priority", "primary");

    await expect(page.getByRole("tab", { name: "2. Optik yükleme" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Cevap anahtarı/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Seç ve ilerle" }).click();
    await expect(page.getByRole("tab", { name: "2. Optik yükleme" })).toHaveAttribute("aria-selected", "true");
    await expect(workflowStrip).toContainText("Format hazır");
    const uploadPanel = page.getByRole("tabpanel", { name: "2. Optik yükleme" });
    await uploadPanel.getByLabel("Optik cevap dosyası").setInputFiles({
      buffer: Buffer.from("optik cevap satiri"),
      mimeType: "text/plain",
      name: rawImportFileName,
    });
    await expect(uploadPanel).toContainText("TXT dosyası seçildi");
    await expect(workflowStrip).toContainText("Dosya seçildi");
    await uploadPanel.getByRole("button", { name: "Yükle ve kontrol et" }).click();
    const uploadResult = page.getByLabel("Optik yükleme sonucu");
    await expect(uploadResult).toContainText("Kontrol tamamlandı");
    await expect(workflowStrip).toContainText("Kontrol tamamlandı");
    const uploadSummary = uploadResult.locator(".next-parser-summary");
    await expect(uploadSummary).toHaveClass(/uh-info-grid/);
    await expect(uploadSummary.locator(".uh-info-item")).toHaveCount(4);
    await expect(uploadSummary).toContainText("Eşleşmeyen");
    await expect(uploadResult.getByRole("status").filter({ hasText: "Eşleşmeyen" })).toBeVisible();
    await uploadResult.getByText("Teknik yükleme bilgisi").click();
    await expect(uploadResult).toContainText("Dosya ref: maskeli");
    await expect(uploadResult).toContainText("Kuyruk ref: maskeli");
    await expect(uploadResult).toContainText("Dosya izi: maskeli");
    await expect(uploadResult).toContainText("Ham id, kuyruk id ve dosya izi ekran görüntülerinde gösterilmez.");
    for (const value of hostileOptikReferences) {
      await expect(page.locator("body")).not.toContainText(value);
    }

    await uploadResult.getByRole("button", { name: "Analizi başlat" }).click();
    await expect(page.getByRole("tab", { name: "3. Eşleşmeyen satırlar" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "2. Optik yükleme" }).click();
    await expect(uploadResult.getByRole("status").filter({ hasText: "1/1 analiz işi kuyruğa alındı." })).toBeVisible();
    await expect(uploadResult.getByRole("status").filter({ hasText: "1/1 analiz sonucu tamamlandı." })).toBeVisible();
    await expect(workflowStrip).toContainText("Tamamlandı");

    await page.getByRole("tab", { name: "3. Eşleşmeyen satırlar" }).click();
    const optikReportPanel = page.getByRole("tabpanel", { name: "3. Eşleşmeyen satırlar" });
    await optikReportPanel.getByRole("button", { name: "Eşleşmeyen satırları getir" }).click();
    const quarantineTable = page.getByRole("table", { name: "Eşleşmeyen satır listesi" });
    await expect(quarantineTable).toContainText("7");
    await expect(quarantineTable).toContainText("STUDENT_NOT_FOUND");
    await expect(quarantineTable).toContainText("Bekliyor");
    for (const value of hostileOptikReferences) {
      await expect(page.locator("body")).not.toContainText(value);
    }
    expect(broadStudentRequests).toHaveLength(0);
    expect(studentSearchRequests).toHaveLength(0);
    await optikReportPanel.getByLabel("Öğrenci adı/no ara").fill("Ada");
    await optikReportPanel.getByRole("button", { name: "Öğrencileri ara" }).click();
    await expect.poll(() => studentSearchRequests.length).toBe(1);
    const studentSearchUrl = new URL(studentSearchRequests[0]!);
    expect(studentSearchUrl.searchParams.get("q")).toBe("Ada");
    expect(studentSearchUrl.searchParams.get("limit")).toBe("10");
    expect(broadStudentRequests).toHaveLength(0);
    await expect(quarantineTable.locator('select[aria-label="7. satır öğrencisi"]')).toContainText("Ada Kaya");
    await expect(optikReportPanel).toContainText("Raporlara geçiş");
    const reportStatus = optikReportPanel.getByRole("region", { name: "Rapor üretim durumu" });
    await expect(reportStatus).toHaveClass(/uh-metric-grid/);
    await expect(reportStatus.locator(".uh-metric-card")).toHaveCount(2);
    await expect(reportStatus).toContainText("Analiz");
    await expect(optikReportPanel.locator(".next-report-status-grid")).toHaveCount(0);
    await expect(optikReportPanel.getByRole("link", { name: "Rapor çalışma alanına geç" })).toHaveAttribute("href", "/kurum/raporlar?examId=exam-optik");
    await expect(page.getByRole("table", { name: "Hazır optik raporlar" })).toHaveCount(0);
    await expect(page.getByRole("table", { name: "Optik katılımcı sonuçları" })).toHaveCount(0);
    await expect(workflowStrip).toContainText("Raporlara geç");
    for (const value of hostileOptikReferences) {
      await expect(workflowStrip).not.toContainText(value);
    }

    expect(broadStudentRequests, "optik rapor yenileme geniş /students listesi yüklememeli").toHaveLength(0);
    expect(studentSearchRequests).toHaveLength(1);
    expect(studentDetailRequests).toHaveLength(0);
    for (const value of hostileOptikReferences) {
      await expect(page.locator("body")).not.toContainText(value);
    }

    await page.getByRole("combobox", { name: "Sınav seç" }).selectOption("exam-optik-second");
    await expect(quarantineTable).not.toContainText("STUDENT_NOT_FOUND");
    await expect(reportStatus).toContainText("Bekleniyor");

    await expectNoHorizontalOverflow(page, "optik-mobile");
    await expectNoUnlabeledControls(page, "optik-mobile");
    await expectNoClippedVisibleText(page, "optik-mobile");
  });
});

async function openWithOptikMocks(page: Page, pathName: string) {
  await page.setViewportSize({ height: 844, width: 390 });
  await installOptikApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installOptikApiMocks(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/parser-configs/suggestions") {
      await fulfillData(route, createParserConfigSuggestionResult());
      return;
    }
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/parser-configs/approvals") {
      await fulfillData(route, createSavedParserConfig());
      return;
    }
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/raw-imports") {
      await fulfillData(route, createRawImportUploadResult());
      return;
    }
    if (route.request().method() === "POST" && pathName === `/exams/exam-optik/raw-imports/${rawImportId}/evaluation-jobs`) {
      await fulfillData(route, createRawImportEvaluationQueueResult());
      return;
    }
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/answer-keys/imports/dry-run") {
      await fulfillData(route, createAnswerKeyDryRunResult());
      return;
    }
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/answer-keys/imports") {
      await fulfillData(route, createAnswerKeyImportResult());
      return;
    }
    if (route.request().method() === "POST" && pathName === "/exams/exam-optik/answer-keys") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as { dryRun?: boolean; version?: string };
      await fulfillData(route, payload.dryRun ? createManualAnswerKeyDryRunResult(payload.version) : createManualAnswerKeyResult(payload.version));
      return;
    }
    const response = mockOptikApiResponse(pathName);
    await fulfillData(route, response.data, response.meta);
  });
}

function mockOptikApiResponse(pathName: string): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/exams") return { data: createExams() };
  if (pathName === "/optical-form-templates") return { data: createOpticalTemplates() };
  if (pathName === "/students/student-a") return { data: createStudents()[0] };
  if (pathName === "/students") return { data: createStudents() };
  if (pathName === "/exams/exam-optik/participants") return { data: createExamParticipants() };
  if (pathName === `/exams/exam-optik/raw-imports/${rawImportId}/summary`) return { data: createRawImportSummary() };
  if (pathName === `/exams/exam-optik/raw-imports/${rawImportId}/evaluation-status`) return { data: createRawImportEvaluationStatus() };
  if (pathName === `/exams/exam-optik/raw-imports/${rawImportId}/quarantines`) return { data: createImportQuarantines() };

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "optik-access-token",
    session: {
      id: "session-optik",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-optik",
      userId: "user-optik-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@optik-akademi.example",
    id: "tenant-optik",
    institutionType: "Dershane",
    name: "Optik Akademi",
  };
}

function createExams() {
  return [
    {
      courseId: "course-math",
      answerKeySummary: {
        branchCount: 6,
        questionCount: 90,
        status: "PUBLISHED",
        updatedAt: "2026-06-10T09:00:00.000Z",
        version: "optik-answer-key-v1",
      },
      createdAt: "2026-06-10T09:00:00.000Z",
      id: "exam-optik",
      startsAt: "2026-06-17T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-optik",
      title: "Optik Rapor Denemesi",
      updatedAt: "2026-06-10T09:00:00.000Z",
    },
    {
      courseId: "course-math",
      answerKeySummary: { branchCount: 6, questionCount: 90, status: "PUBLISHED", updatedAt: "2026-06-11T09:00:00.000Z", version: "optik-answer-key-v1" },
      createdAt: "2026-06-11T09:00:00.000Z",
      id: "exam-optik-second",
      startsAt: "2026-06-18T09:00:00.000Z",
      status: "PUBLISHED",
      tenantId: "tenant-optik",
      title: "İkinci Optik Denemesi",
      updatedAt: "2026-06-11T09:00:00.000Z",
    },
  ];
}

function createOpticalTemplates() {
  return [
    {
      createdAt: "2026-06-10T09:00:00.000Z",
      encoding: "utf8",
      fieldMapping: {
        answers: {
          estimatedQuestionCount: 90,
          kind: "fixed",
          segments: [
            { length: 20, start: 51 },
            { length: 10, start: 71 },
            { length: 10, start: 91 },
            { length: 10, start: 111 },
            { length: 20, start: 131 },
            { length: 20, start: 151 },
          ],
        },
        bookletType: { kind: "fixed", length: 1, start: 50 },
        nationalId: { kind: "fixed", length: 11, start: 37 },
        studentNo: { kind: "fixed", length: 4, start: 11 },
      },
      id: "template-optik",
      name: "OPTİK FORM-7108",
      preset: "OPTIK_7108_LGS",
      skipHeaderLines: 0,
      status: "APPROVED",
      tenantId: "tenant-optik",
      updatedAt: "2026-06-10T09:00:00.000Z",
      version: "template-v1",
    },
  ];
}

function createStudents() {
  return [
    {
      classId: "class-8a",
      firstName: "Ada",
      id: "student-a",
      lastName: "Kaya",
      studentNo: "1001",
      tenantId: "tenant-optik",
    },
  ];
}

function createExamParticipants() {
  return [
    {
      bookletType: "A",
      createdAt: "2026-06-10T09:00:00.000Z",
      examId: "exam-optik",
      id: "participant-a",
      participantNo: "176",
      status: "ATTENDED",
      studentId: "student-a",
      tenantId: "tenant-optik",
      updatedAt: "2026-06-10T09:00:00.000Z",
    },
  ];
}

function createParserConfigSuggestionResult() {
  return {
    examId: "exam-optik",
    status: "suggested",
    suggestion: {
      delimiter: "fixed",
      encoding: "utf8",
      fieldMapping: createOpticalTemplates()[0]!.fieldMapping,
      skipHeaderLines: 0,
    },
  };
}

function createSavedParserConfig() {
  const suggestion = createParserConfigSuggestionResult().suggestion;

  return {
    ...suggestion,
    examId: "exam-optik",
    status: "APPROVED",
    tenantId: "tenant-optik",
    version: "optik-form-7108-v1",
  };
}

function createRawImportUploadResult() {
  return {
    rawImport: {
      examId: "exam-optik",
      fileName: rawImportFileName,
      id: rawImportId,
      parserConfigVersion: "optik-form-7108-v1",
      sha256: rawImportHash,
    },
    parseJob: { jobId: rawParseJobId, queueName: "optical-parse", status: "queued" },
    status: "uploaded",
  };
}

function createAnswerKeyDryRunResult() {
  return {
    bookletVariants: [{ code: "B", questionCount: 90 }],
    branches: [
      { branch: "Türkçe", questionCount: 20 },
      { branch: "Matematik", questionCount: 20 },
      { branch: "Fen", questionCount: 20 },
    ],
    dryRun: true,
    examId: "exam-optik",
    questionCount: 90,
    version: "optik-answer-key-v1",
    wouldImport: true,
  };
}

function createAnswerKeyImportResult() {
  return {
    answerKey: createManualAnswerKeyResult("optik-answer-key-v1"),
    bookletVariants: [{ code: "B", questionCount: 90 }],
    imported: true,
  };
}

function createManualAnswerKeyDryRunResult(version = "manual-key-v1") {
  return {
    bookletVariants: [{ code: "B", questionCount: 90 }],
    branches: [
      { branch: "Türkçe", questionCount: 20 },
      { branch: "Matematik", questionCount: 20 },
      { branch: "Fen", questionCount: 20 },
    ],
    examId: "exam-optik",
    questionCount: 90,
    status: "DRY_RUN",
    tenantId: "tenant-optik",
    version,
  };
}

function createManualAnswerKeyResult(version = "manual-key-v1") {
  return {
    createdAt: "2026-06-10T10:00:00.000Z",
    examId: "exam-optik",
    id: `answer-key-${version}`,
    questionCount: 90,
    scoringConfig: { wrongPenalty: 1 / 3 },
    tenantId: "tenant-optik",
    updatedAt: "2026-06-10T10:00:00.000Z",
    version,
  };
}

function createRawImportSummary() {
  return {
    examId: "exam-optik",
    matchedCount: 1,
    quarantineReasons: [{ count: 1, reason: "STUDENT_NOT_FOUND" }],
    quarantinedCount: 1,
    rawImportId,
    tenantId: "tenant-optik",
    totalRows: 2,
  };
}

function createImportQuarantines() {
  return [
    {
      examId: "exam-optik",
      id: "quarantine-visible-a",
      rawImportId,
      rawImportSha256: rawImportHash,
      rawRow: {
        answers: quarantineRawAnswers,
        email: quarantineRawEmail,
        nationalId: quarantineRawNationalId,
        rawLine: quarantineRawLine,
      },
      reason: "STUDENT_NOT_FOUND",
      rowNumber: 7,
      status: "OPEN",
      tenantId: "tenant-optik",
    },
  ];
}

function createRawImportEvaluationQueueResult() {
  return {
    answerKeyId: "answer-key-optik-answer-key-v1",
    examId: "exam-optik",
    jobs: [{ jobId: rawEvaluationJobId, participantId: "participant-a", status: "queued" }],
    matchedCount: 1,
    queueName: "exam-evaluation",
    queuedCount: 1,
    rawImportId,
    rawImportSha256: rawImportHash,
    tenantId: "tenant-optik",
  };
}

function createRawImportEvaluationStatus() {
  return {
    answerKeyId: "answer-key-optik-answer-key-v1",
    evaluatedCount: 1,
    examId: "exam-optik",
    matchedCount: 1,
    pendingCount: 0,
    rawImportId,
    status: "COMPLETED",
    tenantId: "tenant-optik",
  };
}

interface ListMeta {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

async function fulfillData(route: Route, data: unknown, meta?: ListMeta) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: {
      ...corsHeadersFor(route),
      "content-type": "application/json",
    },
    status: 200,
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

async function expectNoClippedVisibleText(page: Page, label: string) {
  const clippedTexts = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    const textSelectors = [
      "label",
      "button",
      ".uh-status-badge",
      ".uh-info-item__label",
      ".uh-info-item__value",
      ".uh-metric-card__label",
      ".uh-metric-card__value",
      ".uh-data-table th",
      ".uh-data-table td",
    ].join(", ");

    return Array.from(document.querySelectorAll(textSelectors))
      .filter((element) => isVisible(element))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible") return false;
        return htmlElement.scrollWidth - htmlElement.clientWidth > 1 || htmlElement.scrollHeight - htmlElement.clientHeight > 1;
      })
      .map((element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 120))
      .filter(Boolean);
  });

  expect(clippedTexts, `${label}: kırpılmış görünen metin`).toEqual([]);
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
