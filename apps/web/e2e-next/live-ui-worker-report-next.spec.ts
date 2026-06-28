import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

interface LiveReportEvidence {
  examId: string;
  firstStudentId: string;
  guardianPortal?: LiveReportPortalCredentials;
  nationalId: string;
  password: string;
  studentPortal?: LiveReportPortalCredentials;
  tenantSlug: string;
}

interface LiveReportPortalCredentials {
  nationalId: string;
  password: string;
  tenantSlug?: string;
}

const evidencePath = process.env.LIVE_UI_WORKER_EVIDENCE_PATH;
const resultEvidencePath = process.env.LIVE_UI_WORKER_RESULT_EVIDENCE_FILE ?? process.env.LIVE_UI_WORKER_RESULT_EVIDENCE_PATH;
const enabled = process.env.NEXT_E2E_LIVE_UI_WORKER === "1" && Boolean(evidencePath);

test.skip(!enabled, "NEXT_E2E_LIVE_UI_WORKER=1 ve LIVE_UI_WORKER_EVIDENCE_PATH gerekir.");
test.setTimeout(90_000);

test("worker tarafından üretilen canlı rapor kurum UI içinde açılır", async ({ page }) => {
  const evidence = readEvidence(evidencePath);

  await loginAs(page, evidence.tenantSlug, evidence.nationalId, evidence.password, /\/kurum(?:[/?#]|$)/);
  await expect(page).toHaveURL(/\/kurum$/);
  await page.goto("/kurum/raporlar");
  await fillReportExamReference(page, evidence.examId);
  await page.getByRole("button", { name: "Raporu getir" }).click();

  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await page.getByRole("tab", { name: "Öğrenci Sonuçları" }).click();
  await page.getByRole("button", { name: /karnesini aç/ }).first().click();
  await page.getByRole("tab", { name: "Karne Önizleme" }).click();
  await expect(page.getByLabel("Öğrenci karne özeti").getByText("BÖLÜM ANALİZİ")).toBeVisible();
  await openExportsTab(page);
  await expectReportDownload(page, "Excel indir", /\.xlsx$/);
  await openExportsTab(page);
  await expectReportDownload(page, "PDF indir", /\.pdf$/);

  let studentPortalViewed = false;
  if (evidence.studentPortal) {
    await logout(page);
    await loginAs(page, evidence.studentPortal.tenantSlug ?? evidence.tenantSlug, evidence.studentPortal.nationalId, evidence.studentPortal.password, /\/ogrenci(?:[/?#]|$)/);
    await page.goto(`/ogrenci?examId=${encodeURIComponent(evidence.examId)}`);
    await expect(page.getByRole("heading", { name: "Öğrenci Portalı" })).toBeVisible();
    await openPortalKarneDetail(page);
    studentPortalViewed = true;
  }

  let guardianPortalViewed = false;
  if (evidence.guardianPortal) {
    await logout(page);
    await loginAs(page, evidence.guardianPortal.tenantSlug ?? evidence.tenantSlug, evidence.guardianPortal.nationalId, evidence.guardianPortal.password, /\/veli(?:[/?#]|$)/);
    await page.goto(`/veli?examId=${encodeURIComponent(evidence.examId)}`);
    await expect(page.getByRole("heading", { name: "Veli Portalı" })).toBeVisible();
    await openPortalKarneDetail(page);
    guardianPortalViewed = true;
  }

  writeResultEvidence(resultEvidencePath, {
    result: "PASS",
    check: "live_ui_worker_report_smoke",
    generatedAt: new Date().toISOString(),
    environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    checkedAt: new Date().toISOString(),
    examHash: hashIdentifier(evidence.examId),
    firstStudentHash: hashIdentifier(evidence.firstStudentId),
    reportStatus: "READY",
    downloadedArtifacts: ["xlsx", "pdf"],
    karnePdfDownloaded: true,
    excelDownloaded: true,
    studentPortalViewed,
    guardianPortalViewed,
    commandsPassed: ["pnpm live:ui-worker:smoke"],
    gaps: [],
  });
});

async function loginAs(page: Page, tenantSlug: string, nationalId: string, password: string, expectedUrl: RegExp) {
  await page.goto(`/k/${encodeURIComponent(tenantSlug)}/giris`);
  await page.locator('input[name="nationalId"]').fill(nationalId);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(expectedUrl),
    page.getByRole("button", { name: "Giriş yap" }).click(),
  ]);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function fillReportExamReference(page: Page, examId: string) {
  const manualExamReference = page.getByLabel("Manuel sınav referansı");
  if (!(await manualExamReference.isVisible())) {
    await page.getByText("Gelişmiş sınav referansı", { exact: true }).click();
  }
  await manualExamReference.fill(examId);
}

async function expectReportDownload(
  page: Page,
  buttonName: string,
  fileNamePattern: RegExp,
) {
  const button = page.getByRole("button", { name: buttonName });
  await expect(button).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(fileNamePattern);
  await expect(download.failure()).resolves.toBeNull();
}

async function openExportsTab(page: Page) {
  await page.getByRole("tab", { name: "Çıktılar" }).click();
  await expect(page.getByLabel("Rapor çıktıları")).toBeVisible();
}

async function openPortalKarneDetail(page: Page) {
  const reportSummary = page.getByLabel("Portal rapor özeti");
  await expect(reportSummary.getByText("Hazır")).toBeVisible();
  await reportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
  await expect(page.getByLabel("Sınav raporu").getByText("BÖLÜM ANALİZİ")).toBeVisible();
}

function readEvidence(path: string | undefined): LiveReportEvidence {
  if (!path) {
    throw new Error("LIVE_UI_WORKER_EVIDENCE_PATH_MISSING");
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveReportEvidence>;
  const failures: string[] = [];
  if (!parsed.tenantSlug) failures.push("tenantSlug");
  if (!parsed.nationalId) failures.push("nationalId");
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
  if (!value.nationalId) failures.push(`${label}.nationalId`);
  if (!value.password) failures.push(`${label}.password`);
}

function writeResultEvidence(path: string | undefined, payload: Record<string, unknown>) {
  if (!path) return;
  const resolvedPath = resolve(path);
  validateResultEvidenceOutputPath(resolvedPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  validateParentPath(dirname(resolvedPath));
  validateExistingFileArtifact(resolvedPath);
  writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  validateExistingFileArtifact(resolvedPath);
}

function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function validateResultEvidenceOutputPath(path: string) {
  if (isLocalTempPath(path)) {
    throw new Error("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE lokal temp path olmamalı.");
  }
  validateParentPath(dirname(path));
  validateExistingFileArtifact(path);
}

function validateParentPath(parentPath: string) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.");
    }
  }
}

function validateExistingFileArtifact(path: string) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("LIVE_UI_WORKER_RESULT_EVIDENCE_FILE symlink olmayan file artifact olmalı.");
  }
}

function isLocalTempPath(path: string) {
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}
