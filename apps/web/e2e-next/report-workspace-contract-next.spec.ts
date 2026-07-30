import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

test.describe("Rapor çalışma alanı sözleşmesi", () => {
  test("aktif rapor sekmesi URL state ile korunur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?tab=exports", { height: 960, width: 1440 });

    await expect(page.getByRole("tab", { name: "Çıktılar" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-ready");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("exports");

    await page.getByRole("tab", { name: "Genel Bakış" }).click();
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");
  });

  test("öğrenci listesini yalnız rapor sorgusunda yükler", async ({ page }) => {
    const studentRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/v1/students") {
        studentRequests.push(request.url());
      }
    });

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    expect(studentRequests).toHaveLength(0);

    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => studentRequests.length).toBe(1);
  });

  test("rapor üretimini job durumuyla izleyip tamamlanınca veriyi yeniler", async ({ page }) => {
    const jobStatusRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname.endsWith("/reports/generation-jobs/job-report-a"),
    );
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });

    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-ready");
    await page.getByRole("button", { name: "Rapor üret" }).click();
    await expect(page.getByRole("button", { name: "İşleniyor" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Raporu getir" })).toBeDisabled();
    await expect(page.getByRole("combobox", { name: "Sınav" })).toBeDisabled();

    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => jobStatusRequests.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByText("Rapor üretimi tamamlandı.", { exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Sınav" })).toBeEnabled();
  });

  test("rapor yüklenirken sınav seçimini kilitleyip yanıt bağlamını korur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });

    let releaseSnapshotRequest = () => {};
    const snapshotRequestGate = new Promise<void>((resolve) => {
      releaseSnapshotRequest = resolve;
    });
    await page.route("**/api/v1/exams/exam-report-ready/reports/snapshots*", async (route) => {
      await snapshotRequestGate;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    const examSelect = page.getByRole("combobox", { name: "Sınav" });
    await expect(examSelect).toBeDisabled();
    await expect(examSelect).toHaveValue("exam-report-ready");

    releaseSnapshotRequest();
    await expect(page.getByRole("region", { name: "Rapor iş akışı" })).toContainText("Excel/PDF hazır");
    await expect(examSelect).toBeEnabled();
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");
  });

  test("genel rapor GET sürerken yeniden üret aksiyonunu kilitler", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });
    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("button", { name: "Yeniden üret" })).toBeEnabled();

    let releaseSnapshotRequest = () => {};
    const snapshotRequestGate = new Promise<void>((resolve) => {
      releaseSnapshotRequest = resolve;
    });
    await page.route("**/api/v1/exams/exam-report-ready/reports/snapshots*", async (route) => {
      await snapshotRequestGate;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("button", { name: "Yeniden üret" })).toBeDisabled();
    releaseSnapshotRequest();
    await expect(page.getByRole("button", { name: "Yeniden üret" })).toBeEnabled();
  });

  test("sınav değişince eski snapshot bağlamını temizler ve yeni sınavı URL state içinde korur", async ({ page }) => {
    const snapshotRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname.endsWith("/reports/snapshots"),
    );
    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("region", { name: "Rapor iş akışı" })).toContainText("Excel/PDF hazır");
    expect(snapshotRequests).toHaveLength(1);

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-general");

    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rapor iş akışı" })).not.toContainText("Excel/PDF hazır");
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    expect(snapshotRequests).toHaveLength(1);
  });

  test("popstate ile sınav değişince bekleyen genel rapor GET sonucu eski bağlamı geri getirmez", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });
    await page.evaluate(() => {
      window.history.pushState(window.history.state, "", "/kurum/raporlar?examId=exam-report-general");
      window.history.back();
    });
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");

    let releaseSnapshotRequest = () => {};
    let markSnapshotRequestStarted = () => {};
    const snapshotRequestGate = new Promise<void>((resolve) => {
      releaseSnapshotRequest = resolve;
    });
    const snapshotRequestStarted = new Promise<void>((resolve) => {
      markSnapshotRequestStarted = resolve;
    });
    await page.route("**/api/v1/exams/exam-report-ready/reports/snapshots*", async (route) => {
      markSnapshotRequestStarted();
      await snapshotRequestGate;
      await route.fallback().catch(() => undefined);
    });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    await snapshotRequestStarted;
    await page.evaluate(() => window.history.forward());
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-general");
    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();

    releaseSnapshotRequest();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(workflowStrip).not.toContainText("Excel/PDF hazır");
    await expect(page.getByRole("button", { name: "Raporu getir" })).toBeEnabled();
  });

  test("geç gelen öğrenci raporu yeni sınavın snapshot bağlamına yazılmaz", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });
    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("region", { name: "Rapor iş akışı" })).toContainText("LGS Rapor Denemesi");
    await expect(page.getByRole("button", { name: "Raporu getir" })).toBeEnabled();
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");

    let releaseStudentReportRequest = () => {};
    let markStudentReportRequestStarted = () => {};
    const studentReportRequestGate = new Promise<void>((resolve) => {
      releaseStudentReportRequest = resolve;
    });
    const studentReportRequestStarted = new Promise<void>((resolve) => {
      markStudentReportRequestStarted = resolve;
    });
    const delayedStudentReportPath =
      "/api/v1/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a";
    await page.route(`**${delayedStudentReportPath}`, async (route) => {
      markStudentReportRequestStarted();
      await studentReportRequestGate;
      await route.fallback().catch(() => undefined);
    });

    const studentsTab = page.getByRole("tab", { name: "Öğrenciler" });
    await studentsTab.click();
    await expect(studentsTab).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("students");
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable).toBeVisible();
    await studentResultsTable.getByRole("button", { name: "Ada Kaya karnesini aç" }).click();
    await studentReportRequestStarted;

    const examSelect = page.getByRole("combobox", { name: "Sınav" });
    await examSelect.selectOption("exam-report-general");
    await expect(examSelect).toHaveValue("exam-report-general");
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();
    await page.getByRole("button", { name: "Raporu getir" }).click();
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");

    releaseStudentReportRequest();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(workflowStrip).not.toContainText("Karne açık");
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Karne" })).toHaveAttribute("aria-selected", "false");
  });

  test("popstate ile sınav değişince bekleyen öğrenci raporu eski bağlama yazılmaz", async ({ page }) => {
    await openWithReportMocks(
      page,
      "/kurum/raporlar?examId=exam-report-ready",
      { height: 960, width: 1440 },
    );
    const examSelect = page.getByRole("combobox", { name: "Sınav" });
    await expect(examSelect).toHaveValue("exam-report-ready");
    await page.evaluate(() => {
      // Gerçek geri geçişten önce Next'e ikinci bir URL-state güncellemesi göndermeden history fixture'ını kur.
      History.prototype.replaceState.call(
        window.history,
        window.history.state,
        "",
        "/kurum/raporlar?examId=exam-report-general",
      );
      History.prototype.pushState.call(
        window.history,
        window.history.state,
        "",
        "/kurum/raporlar?examId=exam-report-ready",
      );
    });
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");
    await expect(examSelect).toHaveValue("exam-report-ready");

    await page.getByRole("button", { name: "Raporu getir" }).click();
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toContainText("Excel/PDF hazır");
    await expect(page.getByRole("button", { name: "Raporu getir" })).toBeEnabled();

    let releaseStudentReportRequest = () => {};
    let markStudentReportRequestStarted = () => {};
    const studentReportRequestGate = new Promise<void>((resolve) => {
      releaseStudentReportRequest = resolve;
    });
    const studentReportRequestStarted = new Promise<void>((resolve) => {
      markStudentReportRequestStarted = resolve;
    });
    await page.route(
      "**/api/v1/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a",
      async (route) => {
        markStudentReportRequestStarted();
        await studentReportRequestGate;
        await route.fallback().catch(() => undefined);
      },
    );

    const studentsTab = page.getByRole("tab", { name: "Öğrenciler" });
    await studentsTab.click();
    await expect(studentsTab).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("students");
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable).toBeVisible();
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await studentResultsTable.getByRole("button", { name: "Ada Kaya karnesini aç" }).click();
    await studentReportRequestStarted;

    await page.evaluate(() => window.history.back());
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-general");
    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();

    releaseStudentReportRequest();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(workflowStrip).not.toContainText("Karne açık");
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Karne" })).toHaveAttribute("aria-selected", "false");
  });

  test("popstate sonrası tamamlanan job POST yanıtı eski sınav polling sonucunu başlatmaz", async ({ page }) => {
    const jobStatusRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname.endsWith("/reports/generation-jobs/job-report-a"),
    );
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });
    await page.evaluate(() => {
      window.history.pushState(window.history.state, "", "/kurum/raporlar?examId=exam-report-general");
      window.history.back();
    });
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-ready");

    let releaseJobRequest = () => {};
    let markJobRequestStarted = () => {};
    const jobRequestGate = new Promise<void>((resolve) => {
      releaseJobRequest = resolve;
    });
    const jobRequestStarted = new Promise<void>((resolve) => {
      markJobRequestStarted = resolve;
    });
    await page.route("**/api/v1/exams/exam-report-ready/reports/generation-jobs", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      markJobRequestStarted();
      await jobRequestGate;
      await route.fallback();
    });

    await page.getByRole("button", { name: "Rapor üret" }).click();
    await jobRequestStarted;
    await page.evaluate(() => window.history.forward());
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-general");
    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();

    const jobResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/exams/exam-report-ready/reports/generation-jobs",
    );
    releaseJobRequest();
    await jobResponse;
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    expect(jobStatusRequests).toHaveLength(0);
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(workflowStrip).not.toContainText("Rapor üretimi tamamlandı.");
  });

  test("polling başladıktan sonraki popstate geç job sonucunu yeni seçime uygulamaz", async ({ page }) => {
    const readySnapshotRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname === "/api/v1/exams/exam-report-ready/reports/snapshots",
    );
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-ready", { height: 960, width: 1440 });
    await page.evaluate(() => {
      History.prototype.replaceState.call(
        window.history,
        window.history.state,
        "",
        "/kurum/raporlar?examId=exam-report-general",
      );
      History.prototype.pushState.call(
        window.history,
        window.history.state,
        "",
        "/kurum/raporlar?examId=exam-report-ready",
      );
    });

    let releasePollingRequest = () => {};
    let markPollingRequestStarted = () => {};
    const pollingRequestGate = new Promise<void>((resolve) => {
      releasePollingRequest = resolve;
    });
    const pollingRequestStarted = new Promise<void>((resolve) => {
      markPollingRequestStarted = resolve;
    });
    await page.route(
      "**/api/v1/exams/exam-report-ready/reports/generation-jobs/job-report-a",
      async (route) => {
        markPollingRequestStarted();
        await pollingRequestGate;
        await fulfillData(route, {
          jobId: "job-report-a",
          snapshotId: "snapshot-ready",
          status: "COMPLETED",
          updatedAt: "2026-06-17T10:00:01.000Z",
        }).catch(() => undefined);
      },
    );

    const jobPostResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/exams/exam-report-ready/reports/generation-jobs",
    );
    await page.getByRole("button", { name: "Rapor üret" }).click();
    expect((await jobPostResponse).status()).toBe(200);
    await pollingRequestStarted;

    await page.evaluate(() => window.history.back());
    await expect.poll(() => new URL(page.url()).searchParams.get("examId")).toBe("exam-report-general");
    await expect(page.getByRole("combobox", { name: "Sınav" })).toHaveValue("exam-report-general");
    await expect(page.getByRole("heading", { name: "Hazır rapor yok" })).toBeVisible();

    releasePollingRequest();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    expect(readySnapshotRequests).toHaveLength(0);
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toContainText("Genel Rapor Denemesi");
    await expect(workflowStrip).not.toContainText("Rapor üretimi tamamlandı.");
    await expect(workflowStrip).not.toContainText("Excel/PDF hazır");
  });

  test("sınıfsız raporda genel öğrenci listesi yerine katılımcı kayıtlarını yükler", async ({ page }) => {
    const bulkStudentRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname === "/api/v1/students" && url.searchParams.has("ids"),
    );
    const oldStudentDetailRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/students\/student-[ab]$/.test(url.pathname),
    );
    const studentDetailRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/exams\/[^/]+\/reports\/(?:snapshots\/[^/]+\/students\/[^/]+(?:\/error-booklet)?|students\/[^/]+\/progress)$/.test(url.pathname),
    );

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-general");
    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => bulkStudentRequests.length).toBe(1);
    expect(new URL(bulkStudentRequests[0]!).searchParams.get("ids")).toBe("student-a,student-b");
    expect(oldStudentDetailRequests).toHaveLength(0);
    expect(studentDetailRequests).toHaveLength(0);

    await page.getByRole("tab", { name: "Öğrenciler" }).click();
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await expect(studentResultsTable).toContainText("Bora Yılmaz");
    expect(bulkStudentRequests).toHaveLength(1);
  });

  test("AYT öğrenci tablosu ders netlerini SAY EA SÖZ puanlarının altında gösterir", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-ayt");
    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("heading", { name: "Puan profili" })).toBeVisible();

    await page.getByRole("tab", { name: "Öğrenciler" }).click();
    const table = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(table.getByRole("columnheader", { name: "Dersler" })).toHaveCount(0);
    await expect(table.getByRole("columnheader", { name: "Sayısal puanı" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "EA puanı" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Sözel puanı" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Başarı sırası" })).toBeVisible();
    await expect(table.getByRole("row").nth(1)).toContainText("Mat 28,75");
    await expect(table.getByRole("row").nth(1)).toContainText("Edb 17,25");
    await expect(table.getByRole("row").nth(1)).toContainText("412");
    await expect(table.getByRole("row").nth(1)).toContainText("398");
    await expect(table.getByRole("row").nth(1)).toContainText("376");
  });

  test("rapor sekmeleri klavyede roving focus ve panel odağını korur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    const overviewTab = page.getByRole("tab", { name: "Genel Bakış" });
    const studentsTab = page.getByRole("tab", { name: "Öğrenciler" });
    const exportsTab = page.getByRole("tab", { name: "Çıktılar" });

    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(overviewTab).toHaveAttribute("tabindex", "0");
    await expect(studentsTab).toHaveAttribute("tabindex", "-1");

    await overviewTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(studentsTab).toBeFocused();
    await expect(studentsTab).toHaveAttribute("aria-selected", "true");
    await expect(studentsTab).toHaveAttribute("tabindex", "0");
    await expect(overviewTab).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("tabpanel", { name: "Öğrenciler" })).toBeVisible();

    await page.keyboard.press("End");
    await expect(exportsTab).toBeFocused();
    await expect(exportsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Home");
    await expect(overviewTab).toBeFocused();
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowLeft");
    await expect(exportsTab).toBeFocused();
    await expect(exportsTab).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel", { name: "Çıktılar" })).toBeFocused();
  });

  test("READY snapshot bağlam, girdi ve çıktı hazırlığını görünür tutar", async ({ page }) => {
    const studentListRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && url.pathname === "/api/v1/students",
    );
    const studentDetailRequests = trackApiRequests(page, (url, method) =>
      method === "GET" && /^\/api\/v1\/exams\/[^/]+\/reports\/(?:snapshots\/[^/]+\/students\/[^/]+(?:\/error-booklet)?|students\/[^/]+\/progress)$/.test(url.pathname),
    );

    await openWithReportMocks(page, "/kurum/raporlar", { height: 960, width: 1440 });

    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    expect(studentListRequests).toHaveLength(0);
    expect(studentDetailRequests).toHaveLength(0);

    await page.getByText("Kapsam filtreleri", { exact: true }).click();
    const reportFilters = page.getByLabel("Rapor filtreleri").locator("select");
    await reportFilters.nth(0).selectOption("campus-main");
    await reportFilters.nth(1).selectOption("grade-8");
    await reportFilters.nth(2).selectOption("class-8a");
    await reportFilters.nth(3).selectOption("course-math");
    await reportFilters.nth(4).selectOption("term-2026");

    const snapshotsRequest = page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/v1/exams/exam-report-ready/reports/snapshots",
    );
    await page.getByRole("button", { name: "Raporu getir" }).click();
    const snapshotsUrl = new URL((await snapshotsRequest).url());
    expect(snapshotsUrl.searchParams.get("campusId")).toBe("campus-main");
    expect(snapshotsUrl.searchParams.get("gradeLevelId")).toBe("grade-8");
    expect(snapshotsUrl.searchParams.get("classId")).toBe("class-8a");
    expect(snapshotsUrl.searchParams.get("courseId")).toBe("course-math");
    expect(snapshotsUrl.searchParams.get("termId")).toBe("term-2026");

    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => studentListRequests.length).toBe(1);
    expect(new URL(studentListRequests[0]!).searchParams.get("classId")).toBe("class-8a");
    expect(studentDetailRequests).toHaveLength(0);
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toHaveClass(/next-report-status-surface/);
    await expect(workflowStrip.locator(".next-report-status-pills > span")).toHaveCount(4);
    await expect(workflowStrip).toContainText("Sorgu");
    await expect(workflowStrip).toContainText("Sorgulandı");
    await expect(workflowStrip).toContainText("Rapor");
    await expect(workflowStrip).toContainText("Hazır");
    await expect(workflowStrip).toContainText("Çıktı");
    await expect(workflowStrip).toContainText("Excel/PDF hazır");
    await expect(workflowStrip).toContainText("Karne");
    await expect(workflowStrip).toContainText("Öğrenci seç");
    await expect(workflowStrip).not.toContainText("exam-report-ready");
    await expect(workflowStrip).not.toContainText("snapshot-ready");
    await expect(workflowStrip).toContainText("LGS Rapor Denemesi");
    const reportDetails = workflowStrip.locator(".next-report-meta-details");
    await reportDetails.getByText("Rapor ayrıntıları", { exact: true }).click();
    await expect(reportDetails).not.toContainText("exam-report-ready");
    await expect(reportDetails).toContainText("Hazır");
    await expect(reportDetails).toContainText("17.06.2026");
    await expect(reportDetails).toContainText("Ana Kampüs");
    await expect(reportDetails).toContainText("8-A");
    await expect(reportDetails).toContainText("Matematik");
    await expect(reportDetails).toContainText("2026 Bahar");
    await expect(reportDetails).toContainText("1 sonuç girdisi");
    await expect(reportDetails).toContainText("cevap anahtarı");

    const analyticsPanel = page.getByRole("tabpanel", { name: "Genel Bakış" });
    await expect(analyticsPanel.getByRole("region", { name: "Kurum analitiği" })).toContainText("Başarı %");
    await expect(analyticsPanel.getByRole("region", { name: "Kurum analitiği" })).toContainText("%81,7");
    await expect(analyticsPanel.getByRole("heading", { name: "Puan profili" })).toHaveCount(0);
    await expect(analyticsPanel.getByRole("region", { name: "Rapor özeti" })).toContainText("LGS deneme puanı");
    await expect(analyticsPanel.getByRole("region", { name: "Rapor özeti" }).locator(".uh-metric-card")).toHaveCount(0);
    await expect(analyticsPanel.getByRole("region", { name: "Rapor özeti" })).toContainText("En güçlü");
    await expect(analyticsPanel.getByRole("heading", { name: "Ders performansı" })).toBeVisible();
    await expect(analyticsPanel.locator(".next-report-summary-card")).toHaveCount(0);

    await page.getByRole("tab", { name: "Öğrenciler" }).click();
    const studentResultsTable = page.getByRole("table", { name: "Öğrenci sıralamaları" });
    await expect(studentResultsTable.getByRole("columnheader", { name: "Performans" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Dersler" })).toHaveCount(0);
    await expect(studentResultsTable.getByRole("columnheader", { name: "LGS puanı" })).toBeVisible();
    await expect(studentResultsTable.getByRole("columnheader", { name: "Başarı sırası" })).toBeVisible();
    await expect(studentResultsTable).toContainText("Ada Kaya");
    await expect(studentResultsTable).toContainText("Bora Yılmaz");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("Ada Kaya");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("%81,7");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("24,50");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("30");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("Tr 13,00");
    await expect(studentResultsTable.getByRole("row").nth(1)).toContainText("Mat 11,50");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("Bora Yılmaz");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("%60,0");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("30");
    await expect(studentResultsTable.getByRole("row").nth(2)).toContainText("50");

    await studentResultsTable.getByRole("button", { name: "Ada Kaya karnesini aç" }).click();
    await expect(page.getByRole("tab", { name: "Karne" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => studentDetailRequests.length).toBe(3);
    await expect(workflowStrip).toContainText("Karne açık");
    const karnePanel = page.getByRole("tabpanel", { name: "Karne" });
    const karneSheet = karnePanel.getByRole("region", { name: "Öğrenci karne özeti özet sayfası" });
    await expect(karneSheet).toHaveClass(/next-report-karne-sheet/);
    await expect(karneSheet).not.toHaveClass(/next-report-list/);
    const karneContext = karneSheet.getByRole("region", { exact: true, name: "Karne rapor bağlamı" });
    const karneContextMetrics = karneContext.getByRole("group", { name: "Karne rapor bağlam metrikleri" });
    await expect(karneContextMetrics).toHaveClass(/uh-info-grid/);
    await expect(karneContextMetrics.locator(".uh-info-item")).toHaveCount(7);
    await expect(karneContext).toContainText("Rapor bağlamı");
    await expect(karneContext).toContainText("Rapor kaydı");
    await expect(karneContext).toContainText("Rapor kaydı hazır");
    await expect(karneContext).toContainText("Rapor hazır");
    await expect(karneContext).not.toContainText("snapshot-ready");
    await expect(karneContext).toContainText("Excel/PDF hazır");
    await expect(karneContext).toContainText("Üretim");
    await expect(karneContext).toContainText("Soru");
    const karneSummary = karneSheet.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(karneSummary).toHaveClass(/uh-metric-grid/);
    await expect(karneSummary.locator(".uh-metric-card")).toHaveCount(6);
    await expect(karneSummary).toContainText("Başarı %");
    await expect(karneSummary).toContainText("%66,7");
    await expect(karneSummary).toContainText("Soru");
    await expect(karneSummary).toContainText("30");
    await expect(karneSummary).toContainText("Net");
    await expect(karneSummary).toContainText("20,00");
    await expect(karneSummary).toContainText("Kurum başarı sırası");
    const scoreTable = karnePanel.locator(".next-karne-score-table");
    await expect(scoreTable.getByRole("columnheader", { name: "PUAN TİPİ" })).toBeVisible();
    await expect(scoreTable.getByRole("columnheader", { name: "DENEME PUANI" })).toBeVisible();
    await expect(scoreTable.getByRole("columnheader", { name: "DERS NETLERİ" })).toBeVisible();
    await expect(scoreTable.getByRole("columnheader", { name: "KURUM BAŞARI SIRASI" })).toBeVisible();
    await expect(scoreTable.getByRole("columnheader", { name: "SINIF BAŞARI SIRASI" })).toBeVisible();
    await expect(scoreTable.getByRole("row", { name: /LGS/ })).toContainText("410");
    await expect(scoreTable.getByRole("row", { name: /LGS/ })).toContainText("Tr 12,00");
    await expect(scoreTable.getByRole("row", { name: /LGS/ })).toContainText("Mat 8,00");
    await expect(karnePanel.getByRole("row", { name: /GELİŞİM/ })).toContainText("-%3,3");
    await expect(karnePanel.getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
    const branchPsychometryTable = karnePanel.getByRole("table", { name: "Öğrenci branş karne tablosu" });
    await expectSuccessRatePrimaryColumns(branchPsychometryTable);
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("8");
    await expect(branchPsychometryTable.getByRole("row", { name: /Matematik/ })).toContainText("10");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("%60,0");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("12");
    await expect(branchPsychometryTable.getByRole("row", { name: /Türkçe/ })).toContainText("20");
    const errorBookletRegion = page.getByRole("region", { name: "Hata kitapçığı" });
    await expect(errorBookletRegion).toHaveClass(/next-report-output-panel/);
    await expect(errorBookletRegion.getByRole("table", { name: "Seçili öğrenci hata kitapçığı" })).toBeVisible();

    await page.getByRole("tab", { name: "Çıktılar" }).click();
    const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
    await expect(exportsRegion).toHaveClass(/next-report-output-panel/);
    await expect(exportsRegion).toContainText("Hazır");
    await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeEnabled();
    await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeEnabled();
    await expect(exportsRegion.getByRole("button", { name: "Toplu karneleri indir" })).toBeEnabled();
    await expect(exportsRegion.getByRole("button", { name: "Tekli karneyi indir" })).toBeEnabled();

    await expectNoHorizontalOverflow(page, "report-workspace-ready");
    await expectNoUnlabeledControls(page, "report-workspace-ready");
  });

  test("PENDING ve FAILED snapshot rozetlerini gösterip çıktıları kilitler", async ({ page }) => {
    let snapshotStatus: "PENDING" | "FAILED" = "PENDING";
    await openWithReportMocks(page, "/kurum/raporlar?examId=exam-report-stale", { height: 960, width: 1440 });
    await page.route("**/api/v1/exams/exam-report-stale/reports/snapshots*", async (route) => {
      await fulfillData(route, [{
        ...createReportSnapshot("exam-report-stale", "STALE"),
        status: snapshotStatus,
      }]);
    });

    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    const exportButtons = ["Excel indir", "PDF indir", "Toplu karneleri indir", "Tekli karneyi indir"];
    for (const status of [
      { label: "Bekliyor", tone: "warning" },
      { label: "Hatalı", tone: "danger" },
    ] as const) {
      await page.getByRole("button", { name: "Raporu getir" }).click();
      const reportStatusBadge = workflowStrip
        .locator(".next-report-status-pills > span")
        .nth(1)
        .locator(".uh-status-badge");
      await expect(reportStatusBadge).toHaveText(status.label);
      await expect(reportStatusBadge).toHaveClass(new RegExp(`uh-status-badge--${status.tone}`));
      await expect(workflowStrip).toContainText("READY snapshot gerekli");

      await page.getByRole("tab", { name: "Çıktılar" }).click();
      const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
      await expect(exportsRegion.locator(".uh-status-badge")).toHaveText(status.label);
      for (const buttonName of exportButtons) {
        await expect(exportsRegion.getByRole("button", { name: buttonName })).toBeDisabled();
      }
      snapshotStatus = "FAILED";
    }
  });

  test("STALE snapshot analizi açık bırakır ama çıktıları kilitler", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 844, width: 390 });

    await page.getByRole("combobox", { name: "Sınav" }).selectOption("exam-report-stale");
    await page.getByRole("button", { name: "Raporu getir" }).click();

    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    const workflowStrip = page.getByRole("region", { name: "Rapor iş akışı" });
    await expect(workflowStrip).toHaveClass(/next-report-status-surface/);
    await expect(workflowStrip.locator(".next-report-status-pills > span")).toHaveCount(4);
    await expect(workflowStrip).toContainText("Sorgulandı");
    await expect(workflowStrip).toContainText("Eski");
    await expect(workflowStrip).toContainText("READY snapshot gerekli");
    await expect(workflowStrip).toContainText("Öğrenci seç");
    await expect(workflowStrip).not.toContainText("exam-report-stale");
    await expect(workflowStrip).not.toContainText("snapshot-stale");
    await expect(workflowStrip).toContainText("Eski Rapor Denemesi");
    const reportDetails = workflowStrip.locator(".next-report-meta-details");
    await reportDetails.getByText("Rapor ayrıntıları", { exact: true }).click();
    await expect(reportDetails).not.toContainText("exam-report-stale");
    await expect(reportDetails).toContainText("Eski");
    await expect(reportDetails).toContainText("1 sonuç girdisi");
    await expect(page.getByText("Snapshot çıktıya hazır değil")).toBeVisible();

    await page.getByRole("tab", { name: "Çıktılar" }).click();
    const exportsRegion = page.getByRole("region", { name: "Rapor çıktıları" });
    await expect(exportsRegion).toHaveClass(/next-report-output-panel/);
    await expect(exportsRegion).toContainText("Eski");
    await expect(exportsRegion.getByRole("button", { name: "Excel indir" })).toBeDisabled();
    await expect(exportsRegion.getByRole("button", { name: "PDF indir" })).toBeDisabled();
    await expect(exportsRegion.getByRole("button", { name: "Toplu karneleri indir" })).toBeDisabled();
    await expect(exportsRegion.getByRole("button", { name: "Tekli karneyi indir" })).toBeDisabled();

    await page.getByRole("tab", { name: "Karne" }).click();
    const karnePanel = page.getByRole("tabpanel", { name: "Karne" });
    await expect(karnePanel).toContainText("Çıktı: READY snapshot gerekli");

    await expectNoHorizontalOverflow(page, "report-workspace-stale-mobile");
    await expectNoUnlabeledControls(page, "report-workspace-stale-mobile");
  });

  test("READY snapshot mobil karne önizleme başarı net ve soru bağlamını taşmadan korur", async ({ page }) => {
    await openWithReportMocks(page, "/kurum/raporlar", { height: 812, width: 375 });

    await page.getByRole("button", { name: "Raporu getir" }).click();
    await expect(page.getByRole("region", { name: "Rapor özeti" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Öğrenciler" }).click();
    await page.getByRole("table", { name: "Öğrenci sıralamaları" }).getByRole("button", { name: "Ada Kaya karnesini aç" }).click();

    const karnePanel = page.getByRole("tabpanel", { name: "Karne" });
    const karneSheet = karnePanel.getByRole("region", { name: "Öğrenci karne özeti özet sayfası" });
    const karneContext = karneSheet.getByRole("region", { exact: true, name: "Karne rapor bağlamı" });
    const karneContextMetrics = karneContext.getByRole("group", { name: "Karne rapor bağlam metrikleri" });
    await expect(karneContextMetrics).toHaveClass(/uh-info-grid/);
    await expect(karneContextMetrics.locator(".uh-info-item")).toHaveCount(7);
    await expect(karneContext).toContainText("Excel/PDF hazır");
    await expect(karneContext).toContainText("Soru");
    const karneSummary = karneSheet.getByRole("region", { exact: true, name: "Karne başarı özeti" });
    await expect(karneSummary).toHaveClass(/uh-metric-grid/);
    await expect(karneSummary.locator(".uh-metric-card")).toHaveCount(6);
    await expect(karneSummary).toContainText("Başarı %");
    await expect(karneSummary).toContainText("%66,7");
    await expect(karneSummary).toContainText("Net");
    await expect(karneSummary).toContainText("20,00");
    const mobileBranchTable = karnePanel.getByRole("table", { name: "Öğrenci branş karne tablosu" });
    await expectSuccessRatePrimaryColumns(mobileBranchTable);
    await expect(mobileBranchTable.getByRole("columnheader", { name: "Başarı %" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Net" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("columnheader", { exact: true, name: "Soru sayısı" })).toBeVisible();
    await expect(mobileBranchTable.getByRole("row", { name: /Matematik/ })).toContainText("%80,0");
    await expect(mobileBranchTable.getByRole("row", { name: /Türkçe/ })).toContainText("%60,0");

    await expectNoHorizontalOverflow(page, "report-workspace-ready-karne-mobile");
    await expectNoUnlabeledControls(page, "report-workspace-ready-karne-mobile");
    await expectNoClippedVisibleText(page, "report-workspace-ready-karne-mobile");
  });
});

async function openWithReportMocks(page: Page, pathName: string, viewport: { height: number; width: number }) {
  await page.setViewportSize(viewport);
  await installReportApiMocks(page);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(pathName);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
}

async function installReportApiMocks(page: Page) {
  let reportJobStatusRequestCount = 0;
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    if (route.request().method() === "GET" && /\/reports\/generation-jobs\/job-report-a$/.test(pathName)) {
      reportJobStatusRequestCount += 1;
      await fulfillData(route, reportJobStatusRequestCount === 1
        ? { jobId: "job-report-a", status: "RUNNING", updatedAt: "2026-06-17T10:00:00.000Z" }
        : { jobId: "job-report-a", snapshotId: "snapshot-a", status: "COMPLETED", updatedAt: "2026-06-17T10:00:01.000Z" });
      return;
    }
    const response = mockReportApiResponse(pathName, route.request().method());
    await fulfillData(route, response.data, response.meta);
  });
}

function mockReportApiResponse(pathName: string, method: string): { data: unknown; meta?: ListMeta } {
  if (pathName === "/auth/refresh") return { data: createAuthResponse() };
  if (pathName === "/me/tenant") return { data: createTenantResponse() };
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/campuses") return listResponse([{ id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-report" }]);
  if (pathName === "/classes") return listResponse([{ campusId: "campus-main", gradeLevelId: "grade-8", id: "class-8a", name: "8-A", tenantId: "tenant-report" }]);
  if (pathName === "/courses") return listResponse([{ id: "course-math", name: "Matematik", tenantId: "tenant-report" }]);
  if (pathName === "/grade-levels") return listResponse([{ id: "grade-8", name: "8. Sınıf", tenantId: "tenant-report" }]);
  if (pathName === "/academic-terms") return listResponse([{ id: "term-2026", name: "2026 Bahar", tenantId: "tenant-report" }]);
  if (pathName === "/students") return listResponse(createStudents());
  if (pathName === "/students/student-a") return { data: createStudents()[0] };
  if (pathName === "/students/student-b") return { data: createStudents()[1] };
  if (pathName === "/exams") {
    return listResponse([
      { courseId: "course-math", id: "exam-report-ready", status: "PUBLISHED", tenantId: "tenant-report", title: "LGS Rapor Denemesi" },
      { courseId: "course-math", id: "exam-report-stale", status: "DRAFT", tenantId: "tenant-report", title: "Eski Rapor Denemesi" },
      { courseId: "course-math", id: "exam-report-general", status: "DRAFT", tenantId: "tenant-report", title: "Genel Rapor Denemesi" },
      { courseId: "course-math", id: "exam-report-ayt", status: "PUBLISHED", tenantId: "tenant-report", title: "AYT Rapor Denemesi" },
    ]);
  }
  if (pathName === "/exams/exam-report-ready/reports/snapshots") return { data: [createReportSnapshot("exam-report-ready", "READY")] };
  if (pathName === "/exams/exam-report-stale/reports/snapshots") return { data: [createReportSnapshot("exam-report-stale", "STALE")] };
  if (pathName === "/exams/exam-report-general/reports/snapshots") return { data: [createReportSnapshot("exam-report-general", "READY", { classId: null })] };
  if (pathName === "/exams/exam-report-ayt/reports/snapshots") return { data: [createReportSnapshot("exam-report-ayt", "READY")] };
  if (pathName === "/exams/exam-report-ready/participants" || pathName === "/exams/exam-report-stale/participants" || pathName === "/exams/exam-report-general/participants" || pathName === "/exams/exam-report-ayt/participants") return { data: createParticipants() };
  if (pathName === "/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a") return { data: createStudentReport() };
  if (pathName === "/exams/exam-report-ready/reports/snapshots/snapshot-ready/students/student-a/error-booklet") return { data: createErrorBooklet() };
  if (pathName === "/exams/exam-report-ready/reports/students/student-a/progress") return { data: createProgress() };
  if (/^\/exams\/[^/]+\/reports\/snapshots\/[^/]+\/students\/student-a$/.test(pathName)) return { data: null };
  if (/^\/exams\/[^/]+\/reports\/snapshots\/[^/]+\/students\/student-a\/error-booklet$/.test(pathName)) return { data: null };
  if (/^\/exams\/[^/]+\/reports\/students\/student-a\/progress$/.test(pathName)) return { data: null };
  if (method === "POST" && /^\/exams\/[^/]+\/reports\/generation-jobs$/.test(pathName)) return { data: { jobId: "job-report-a", status: "queued" } };
  if (method === "GET" && /^\/exams\/[^/]+\/reports\/generation-jobs\/job-report-a$/.test(pathName)) return { data: { jobId: "job-report-a", snapshotId: "snapshot-a", status: "COMPLETED", updatedAt: "2026-06-17T10:00:00.000Z" } };

  return { data: [] };
}

function createAuthResponse() {
  return {
    accessToken: "report-access-token",
    session: {
      id: "session-report",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-report",
      userId: "user-report-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@rapor-akademi.example",
    id: "tenant-report",
    institutionType: "Dershane",
    name: "Rapor Akademi",
  };
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", studentNo: "1001", tenantId: "tenant-report" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yılmaz", studentNo: "1002", tenantId: "tenant-report" },
  ];
}

function createParticipants() {
  return [
    {
      bookletType: "A",
      examId: "exam-report-ready",
      id: "participant-a",
      participantNo: "001",
      status: "ATTENDED",
      studentId: "student-a",
      tenantId: "tenant-report",
    },
    {
      bookletType: "B",
      examId: "exam-report-ready",
      id: "participant-b",
      participantNo: "002",
      status: "ATTENDED",
      studentId: "student-b",
      tenantId: "tenant-report",
    },
  ];
}

function createReportSnapshot(examId: string, status: "READY" | "STALE", options: { classId?: string | null } = {}) {
  const classId = options.classId === undefined ? "class-8a" : options.classId;
  const isAyt = examId === "exam-report-ayt";
  const scoreViews = isAyt
    ? [
        createSnapshotScoreView("SAY", 412),
        createSnapshotScoreView("EA", 398),
        createSnapshotScoreView("SOZ", 376),
      ]
    : [createSnapshotScoreView("LGS", 410)];
  const scoreAverages = scoreViews.map((view) => ({
    calculatedCount: 2,
    practiceScore: view.practiceScore,
    type: view.type,
  }));
  const scoreRankings = scoreViews.map((view) => ({
    class: { outOf: 2, rank: 1 },
    institution: { outOf: 2, rank: 1 },
    type: view.type,
  }));
  const studentBranches = isAyt
    ? [
        { blank: 5, branch: "AYT Matematik", correct: 30, net: 28.75, questionCount: 40, successRate: 71.9, wrong: 5 },
        { blank: 3, branch: "Türk Dili ve Edebiyatı", correct: 18, net: 17.25, questionCount: 24, successRate: 71.9, wrong: 3 },
      ]
    : [
        { blank: 0, branch: "Matematik", correct: 12, net: 11.5, questionCount: 15, successRate: 80, wrong: 3 },
        { blank: 1, branch: "Türkçe", correct: 13, net: 13, questionCount: 15, successRate: 86.7, wrong: 1 },
      ];
  return {
    campusId: "campus-main",
    ...(classId ? { classId } : {}),
    courseId: "course-math",
    createdAt: "2026-06-17T12:00:00.000Z",
    examId,
    generatedAt: "2026-06-17T12:00:00.000Z",
    gradeLevelId: "grade-8",
    id: status === "READY" ? "snapshot-ready" : "snapshot-stale",
    inputRefs: {
      answerKeyId: "answer-key-a",
      parserConfigId: "parser-config-a",
      resultKeys: ["result-a"],
    },
    reportType: "EXAM_RESULT_SUMMARY",
    snapshotData: {
      examType: isAyt ? "AYT" : "LGS",
      examYear: 2026,
      officialComparable: false,
      schemaVersion: 2,
      scoringProfileId: isAyt ? "TR-YKS-2026-NOSD-V1" : "TR-LGS-2026-NOSD-V1",
      averages: {
        blank: 1,
        correct: 25,
        net: 24.5,
        questionCount: 30,
        standardScore: 440,
        successRate: 81.7,
        wrong: 4,
      },
      branches: studentBranches.map((branch) => ({ ...branch, resultCount: 2 })),
      classes: [
        {
          averages: { blank: 1, correct: 25, net: 24.5, questionCount: 30, standardScore: 440, successRate: 81.7, wrong: 4 },
          classId: "class-8a",
          className: "8-A",
          resultCount: 2,
        },
      ],
      generatedAt: "2026-06-17T12:00:00.000Z",
      outcomes: [
        { branch: "Matematik", correct: 4, net: 4, outcomeCode: "M.8.1.1", questionCount: 5, resultCount: 1, successRate: 80, wrong: 1 },
      ],
      resultCount: 2,
      scoreAverages,
      students: [
        {
          branches: studentBranches,
          classId: "class-8a",
          className: "8-A",
          resultKey: "result-a",
          scoreRankings,
          scoreViews: scoreViews.map((view) => ({
            ...view,
            metrics: { blank: 1, correct: 25, net: 24.5, questionCount: 30, successRate: 81.7, wrong: 4 },
          })),
          studentId: "student-a",
          total: {
            blank: 1,
            correct: 25,
            net: 24.5,
            questionCount: 30,
            successRate: 81.7,
            wrong: 4,
          },
        },
        {
          branches: studentBranches.map((branch) => ({ ...branch, net: Math.max(0, branch.net - 4), successRate: Math.max(0, branch.successRate - 10) })),
          classId: "class-8a",
          className: "8-A",
          resultKey: "result-b",
          scoreRankings: scoreRankings.map((ranking) => ({
            ...ranking,
            class: { outOf: 2, rank: 2 },
            institution: { outOf: 2, rank: 2 },
          })),
          scoreViews: scoreViews.map((view) => ({
            ...view,
            metrics: { blank: 10, correct: 35, net: 30, questionCount: 50, successRate: 60, wrong: 5 },
            practiceScore: (view.practiceScore ?? 100) - 20,
          })),
          studentId: "student-b",
          total: {
            blank: 10,
            correct: 35,
            net: 30,
            questionCount: 50,
            successRate: 60,
            wrong: 5,
          },
        },
      ],
    },
    status,
    tenantId: "tenant-report",
    termId: "term-2026",
    updatedAt: "2026-06-17T12:00:00.000Z",
  };
}

function createSnapshotScoreView(type: "LGS" | "SAY" | "EA" | "SOZ", practiceScore: number) {
  return {
    metrics: { blank: 8, correct: 20, net: 20, questionCount: 30, successRate: 66.7, wrong: 2 },
    officialComparable: false,
    practiceScore,
    profileId: type === "LGS" ? "TR-LGS-2026-NOSD-V1" : "TR-YKS-2026-NOSD-V1",
    status: "CALCULATED",
    type,
  };
}

function createStudentReport() {
  return {
    branches: [
      { blank: 2, branch: "Matematik", classNetAverage: 10.5, correct: 8, generalNetAverage: 9.8, net: 8, questionCount: 10, schoolNetAverage: 10.8, successRate: 80, wrong: 0 },
      { blank: 6, branch: "Türkçe", classNetAverage: 12.2, correct: 12, generalNetAverage: 11.1, net: 12, questionCount: 20, schoolNetAverage: 12.9, successRate: 60, wrong: 2 },
    ],
    classId: "class-8a",
    className: "8-A",
    courseId: "course-math",
    examId: "exam-report-ready",
    examType: "LGS",
    examStartsAt: "2026-06-17T09:00:00.000Z",
    examTitle: "LGS Rapor Denemesi",
    generatedAt: "2026-06-17T12:00:00.000Z",
    institutionName: "Rapor Akademi",
    outcomes: [
      { branch: "Matematik", correct: 4, net: 4, outcomeCode: "M.8.1.1", questionCount: 5, successRate: 80, wrong: 1 },
    ],
    participantNo: "001",
    bookletType: "A",
    questions: createQuestionSummaries(),
    resultKey: "result-a",
    scoreViews: [{
      metrics: { blank: 8, correct: 20, net: 20, questionCount: 30, successRate: 66.7, wrong: 2 },
      officialComparable: false,
      practiceScore: 410,
      profileId: "lgs-2026-v1",
      status: "CALCULATED",
      type: "LGS",
    }],
    scoreRankings: [{ type: "LGS", institution: { outOf: 2, rank: 1 }, class: { outOf: 2, rank: 1 } }],
    snapshotId: "snapshot-ready",
    statistics: {
      branches: [],
      class: { outOf: 1, percentile: 1, rank: 1 },
      general: { outOf: 1, percentile: 1, rank: 1 },
      standardScore: 440,
    },
    studentId: "student-a",
    studentName: "Ada Kaya",
    tenantId: "tenant-report",
    termId: "term-2026",
    total: {
      blank: 8,
      correct: 20,
      net: 20,
      questionCount: 30,
      standardScore: 410,
      successRate: 66.7,
      wrong: 2,
    },
  };
}

function createQuestionSummaries() {
  return [
    { answer: "A", branch: "Matematik", correctAnswer: "A", outcomeCode: "M.8.1.1", questionNo: 1, status: "CORRECT" },
    { answer: "B", branch: "Matematik", correctAnswer: "C", outcomeCode: "M.8.1.1", questionNo: 2, status: "WRONG" },
    { answer: "", branch: "Türkçe", correctAnswer: "D", outcomeCode: "T.8.2.1", questionNo: 3, status: "BLANK" },
  ];
}

function createErrorBooklet() {
  return {
    examId: "exam-report-ready",
    generatedAt: "2026-06-17T12:00:00.000Z",
    items: createQuestionSummaries().filter((question) => question.status !== "CORRECT"),
    snapshotId: "snapshot-ready",
    studentId: "student-a",
    tenantId: "tenant-report",
  };
}

function createProgress() {
  return {
    examId: "exam-report-ready",
    netDelta: -1,
    points: [
      { examTitle: "Mayıs Denemesi", generatedAt: "2026-05-17T12:00:00.000Z", snapshotId: "snapshot-prev", total: { blank: 2, correct: 22, net: 21, questionCount: 30, standardScore: 405, successRate: 70, wrong: 6 } },
      { examTitle: "LGS Rapor Denemesi", generatedAt: "2026-06-17T12:00:00.000Z", snapshotId: "snapshot-ready", total: { blank: 8, correct: 20, net: 20, questionCount: 30, standardScore: 410, successRate: 66.7, wrong: 2 } },
    ],
    standardScoreDelta: 5,
    successRateDelta: -3.3,
    studentId: "student-a",
    tenantId: "tenant-report",
  };
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

function trackApiRequests(page: Page, predicate: (url: URL, method: string) => boolean): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (predicate(url, request.method())) {
      requests.push(request.url());
    }
  });
  return requests;
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    return Math.max(documentElement.scrollWidth - documentElement.clientWidth, body.scrollWidth - body.clientWidth);
  });

  expect(overflow, `${label}: yatay taşma ${overflow}px`).toBeLessThanOrEqual(1);
}

async function expectSuccessRatePrimaryColumns(table: Locator) {
  const headers = (await table.getByRole("columnheader").allTextContents()).map((text) => text.trim());
  const questionHeaderIndex = headers.findIndex((header) => header === "Soru" || header === "Soru sayısı");
  expect(headers.indexOf("Başarı %")).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf("Başarı %")).toBeLessThan(headers.indexOf("Net"));
  expect(headers.indexOf("Başarı %")).toBeLessThan(questionHeaderIndex);
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

async function expectNoClippedVisibleText(page: Page, label: string) {
  const clippedTexts = await page.evaluate(() => {
    function isVisible(element: Element) {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = window.getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }

    return Array.from(document.querySelectorAll(
      [
        "a",
        "label",
        "button",
        ".uh-status-badge",
        ".next-report-status-surface",
        ".next-report-summary-hero",
        ".next-report-export-grid > div",
        ".next-karne-context-strip .uh-info-item",
        ".next-karne-summary-strip .uh-metric-card",
      ].join(", "),
    ))
      .filter((element) => isVisible(element))
      .filter((element) => element.textContent?.trim())
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
