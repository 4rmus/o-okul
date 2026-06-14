import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

interface LiveReportEvidence {
  email: string;
  examId: string;
  firstStudentId: string;
  guardianPortal?: LiveReportPortalCredentials;
  password: string;
  studentPortal?: LiveReportPortalCredentials;
}

interface LiveReportPortalCredentials {
  email: string;
  password: string;
}

const evidencePath = process.env.LIVE_UI_WORKER_EVIDENCE_PATH;
const enabled = process.env.NEXT_E2E_LIVE_UI_WORKER === "1" && Boolean(evidencePath);

test.skip(!enabled, "NEXT_E2E_LIVE_UI_WORKER=1 ve LIVE_UI_WORKER_EVIDENCE_PATH gerekir.");

test("worker tarafından üretilen canlı rapor kurum UI içinde açılır", async ({ page }) => {
  const evidence = readEvidence(evidencePath);

  await loginAs(page, evidence.email, evidence.password);
  await expect(page).toHaveURL(/\/kurum$/);
  await page.getByRole("link", { name: "Raporlar" }).click();
  await page.getByLabel("Rapor sınav ID").fill(evidence.examId);
  await page.getByRole("button", { name: "Raporu getir" }).click();

  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByText(evidence.firstStudentId)).toBeVisible();
  await expectReportDownload(page, "Excel indir", /\.xlsx$/);
  await expectReportDownload(page, "PDF indir", /\.pdf$/);

  if (evidence.studentPortal) {
    await logout(page);
    await loginAs(page, evidence.studentPortal.email, evidence.studentPortal.password);
    await page.goto(`/ogrenci?examId=${encodeURIComponent(evidence.examId)}`);
    await expect(page.getByRole("heading", { name: "Öğrenci Portalı" })).toBeVisible();
    await expect(page.getByLabel("Sınav raporu").getByText(evidence.firstStudentId)).toBeVisible();
  }

  if (evidence.guardianPortal) {
    await logout(page);
    await loginAs(page, evidence.guardianPortal.email, evidence.guardianPortal.password);
    await page.goto(`/veli?examId=${encodeURIComponent(evidence.examId)}`);
    await expect(page.getByRole("heading", { name: "Veli Portalı" })).toBeVisible();
    await expect(page.getByLabel("Sınav raporu").getByText(evidence.firstStudentId)).toBeVisible();
  }
});

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function expectReportDownload(
  page: Page,
  buttonName: string,
  fileNamePattern: RegExp,
) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(fileNamePattern);
  await expect(download.failure()).resolves.toBeNull();
}

function readEvidence(path: string | undefined): LiveReportEvidence {
  if (!path) {
    throw new Error("LIVE_UI_WORKER_EVIDENCE_PATH_MISSING");
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveReportEvidence>;
  const failures: string[] = [];
  if (!parsed.email) failures.push("email");
  if (!parsed.password) failures.push("password");
  if (!parsed.examId) failures.push("examId");
  if (!parsed.firstStudentId) failures.push("firstStudentId");
  validatePortalCredentials(parsed.studentPortal, "studentPortal", failures);
  validatePortalCredentials(parsed.guardianPortal, "guardianPortal", failures);

  if (failures.length > 0) {
    throw new Error(`LIVE_UI_WORKER_EVIDENCE_INVALID: ${failures.join(", ")}`);
  }

  return parsed as LiveReportEvidence;
}

function validatePortalCredentials(
  value: LiveReportPortalCredentials | undefined,
  label: string,
  failures: string[],
) {
  if (!value) return;
  if (!value.email) failures.push(`${label}.email`);
  if (!value.password) failures.push(`${label}.password`);
}
