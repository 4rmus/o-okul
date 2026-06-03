import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

interface LiveReportEvidence {
  email: string;
  password: string;
  examId: string;
  firstStudentId: string;
}

const evidencePath = process.env.LIVE_UI_WORKER_EVIDENCE_PATH;
const enabled = process.env.NEXT_E2E_LIVE_UI_WORKER === "1" && Boolean(evidencePath);

test.skip(!enabled, "NEXT_E2E_LIVE_UI_WORKER=1 ve LIVE_UI_WORKER_EVIDENCE_PATH gerekir.");

test("worker tarafından üretilen canlı rapor kurum UI içinde açılır", async ({ page }) => {
  const evidence = readEvidence(evidencePath);

  await page.goto("/login");
  await page.getByLabel("E-posta").fill(evidence.email);
  await page.getByLabel("Şifre").fill(evidence.password);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/kurum$/);
  await page.getByRole("link", { name: "Raporlar" }).click();
  await page.getByLabel("Rapor sınav ID").fill(evidence.examId);
  await page.getByRole("button", { name: "Raporu getir" }).click();

  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByText(evidence.firstStudentId)).toBeVisible();
});

function readEvidence(path: string | undefined): LiveReportEvidence {
  if (!path) {
    throw new Error("LIVE_UI_WORKER_EVIDENCE_PATH_MISSING");
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveReportEvidence>;
  if (!parsed.email || !parsed.password || !parsed.examId || !parsed.firstStudentId) {
    throw new Error("LIVE_UI_WORKER_EVIDENCE_INVALID");
  }

  return parsed as LiveReportEvidence;
}
