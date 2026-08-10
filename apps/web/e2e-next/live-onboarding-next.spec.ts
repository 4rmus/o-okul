import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

interface LiveOnboardingEvidence {
  appendRunId?: boolean;
  firstAdmin: {
    email: string;
    name: string;
    nationalId: string;
    password: string;
  };
  onboarding?: {
    contactEmail?: string;
    importOwner?: string;
    institutionName?: string;
  };
  systemAdmin: {
    loginName: string;
    password: string;
  };
  tenant: {
    name: string;
    plan?: "TRIAL" | "PRO" | "ENTERPRISE";
    seatLimit?: number;
    slug: string;
  };
}

const evidencePath = process.env.LIVE_ONBOARDING_EVIDENCE_PATH;
const enabled = process.env.NEXT_E2E_LIVE_ONBOARDING === "1" && Boolean(evidencePath);

test.skip(!enabled, "NEXT_E2E_LIVE_ONBOARDING=1 ve LIVE_ONBOARDING_EVIDENCE_PATH gerekir.");

test("sistem admin kurum açar, ilk admin girer ve kurulum sihirbazını tamamlar", async ({ page }) => {
  test.setTimeout(180_000);
  const evidence = readEvidence(evidencePath);
  const runStartedAt = new Date().toISOString();
  const runId = createRunId();
  const appendRunId = evidence.appendRunId !== false;
  const tenantName = appendRunId ? `${evidence.tenant.name} ${runId}` : evidence.tenant.name;
  const tenantSlug = appendRunId ? `${evidence.tenant.slug}-${runId}` : evidence.tenant.slug;
  const firstAdminEmail = appendRunId ? appendEmailRunId(evidence.firstAdmin.email, runId) : evidence.firstAdmin.email;
  const onboardingInstitutionName = evidence.onboarding?.institutionName ?? tenantName;

  await page.goto("/sistem/giris");
  await page.locator('input[name="loginName"]').fill(evidence.systemAdmin.loginName);
  await page.locator('input[name="password"]').fill(evidence.systemAdmin.password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await completeMfaEnrollmentIfRequired(page, /\/sistem$/);

  await expect(page).toHaveURL(/\/sistem$/);
  await page.getByRole("link", { name: "Kurumlar" }).click();
  await expect(page).toHaveURL(/\/sistem\/kurumlar$/);

  await page.getByRole("button", { name: "Kurum oluştur" }).click();
  const createDialog = page.getByRole("dialog", { name: "Kurum oluştur" });
  await createDialog.getByLabel("Kurum adı").fill(tenantName);
  await createDialog.getByLabel("Kurum kodu").fill(tenantSlug);
  await createDialog.getByLabel("Plan").selectOption(evidence.tenant.plan ?? "TRIAL");
  await createDialog.getByLabel("Kullanıcı sınırı").fill(String(evidence.tenant.seatLimit ?? 25));
  await createDialog.getByLabel("İlk yönetici ad soyad").fill(evidence.firstAdmin.name);
  await createDialog.getByLabel("İlk yönetici e-posta").fill(firstAdminEmail);
  await createDialog.getByLabel("İlk yönetici TC kimlik no").fill(evidence.firstAdmin.nationalId);
  await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();

  await expect(page.getByRole("row", { name: new RegExp(escapeRegExp(tenantName)) })).toBeVisible();
  await page.getByRole("button", { name: "Çıkış" }).click();

  const activationUrl = await waitForActivationUrl(firstAdminEmail, runStartedAt);
  await page.goto(activationUrl);
  await page.getByLabel("Şifre", { exact: true }).fill(evidence.firstAdmin.password);
  await page.getByLabel("Şifre tekrar", { exact: true }).fill(evidence.firstAdmin.password);
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();
  await expect(page.getByText("Hesabınız etkinleştirildi.")).toBeVisible();

  await page.goto(`/k/${encodeURIComponent(tenantSlug)}/giris`);
  await page.locator('input[name="loginName"]').fill(firstAdminEmail);
  await page.locator('input[name="password"]').fill(evidence.firstAdmin.password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/);
  await expect(page.getByLabel("Kurulum anahtarı")).toHaveCount(0);

  await page.goto("/kurum/kurulum");
  await expect(page.getByRole("heading", { name: "Kurulum Sihirbazı" })).toBeVisible();
  await page.getByLabel("Kurulum formu").getByLabel("Kurum adı").fill(onboardingInstitutionName);
  const contactEmail = evidence.onboarding?.contactEmail ?? firstAdminEmail;
  await page.getByLabel("Kurulum formu").getByLabel("İletişim e-postası").fill(contactEmail);
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByRole("button", { name: "İleri" }).click();
  await page.getByLabel("Kurulum formu").getByLabel("Veri sorumlusu").fill(evidence.onboarding?.importOwner ?? "Canli UAT");
  await page.getByRole("button", { name: "Kaydet ve bitir" }).click();

  await expect(page.getByText("Kurulum taslağı tamamlandı.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum paneline dön" })).toBeVisible();
});

function readEvidence(path: string | undefined): LiveOnboardingEvidence {
  if (!path) {
    throw new Error("LIVE_ONBOARDING_EVIDENCE_PATH_MISSING");
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LiveOnboardingEvidence>;
  const failures: string[] = [];
  if (!parsed.systemAdmin?.loginName) failures.push("systemAdmin.loginName");
  if (!parsed.systemAdmin?.password) failures.push("systemAdmin.password");
  if (!parsed.tenant?.name) failures.push("tenant.name");
  if (!parsed.tenant?.slug) failures.push("tenant.slug");
  if (!parsed.firstAdmin?.name) failures.push("firstAdmin.name");
  if (!parsed.firstAdmin?.email) failures.push("firstAdmin.email");
  if (!parsed.firstAdmin?.nationalId) failures.push("firstAdmin.nationalId");
  if (!parsed.firstAdmin?.password) failures.push("firstAdmin.password");

  if (failures.length > 0) {
    throw new Error(`LIVE_ONBOARDING_EVIDENCE_INVALID: ${failures.join(", ")}`);
  }

  return parsed as LiveOnboardingEvidence;
}

function createRunId() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function appendEmailRunId(email: string, runId: string) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0) return email;
  return `${email.slice(0, atIndex)}+${runId}${email.slice(atIndex)}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForActivationUrl(recipient: string, createdAfter: string): Promise<string> {
  const endpoint = process.env.LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT;
  const bearerToken = process.env.LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN;
  if (!endpoint || !bearerToken) throw new Error("LIVE_ONBOARDING_EMAIL_EVIDENCE_CONFIG_REQUIRED");

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(endpoint, {
      body: JSON.stringify({ recipient, purpose: "PASSWORD_RESET", createdAfter }),
      headers: { authorization: `Bearer ${bearerToken}`, "content-type": "application/json" },
      method: "POST",
    });
    if (response.ok) {
      const body = await response.json() as { activationUrl?: unknown };
      if (typeof body.activationUrl === "string") return validateActivationUrl(body.activationUrl);
    } else if (response.status !== 404 && response.status !== 204) {
      throw new Error(`LIVE_ONBOARDING_EMAIL_EVIDENCE_FAILED:${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("LIVE_ONBOARDING_ACTIVATION_EMAIL_TIMEOUT");
}

function validateActivationUrl(value: string): string {
  const activationUrl = new URL(value);
  const baseUrl = new URL(process.env.NEXT_E2E_BASE_URL ?? "http://localhost:3001");
  const fragmentToken = new URLSearchParams(activationUrl.hash.slice(1)).get("token");
  const allowedHost = activationUrl.hostname === baseUrl.hostname || activationUrl.hostname.endsWith(`.${baseUrl.hostname}`);
  if (activationUrl.protocol !== baseUrl.protocol || activationUrl.port !== baseUrl.port || !allowedHost
    || activationUrl.pathname !== "/parola-sifirla" || activationUrl.searchParams.has("token") || !fragmentToken) {
    throw new Error("LIVE_ONBOARDING_ACTIVATION_URL_INVALID");
  }
  return activationUrl.toString();
}

function createTotpCode(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/g, "").toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("LIVE_ONBOARDING_MFA_SECRET_INVALID");
    bits += value.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function completeMfaEnrollmentIfRequired(page: Page, destination: RegExp) {
  const enrollmentSecret = page.getByLabel("Kurulum anahtarı");
  await Promise.race([
    page.waitForURL(destination),
    enrollmentSecret.waitFor({ state: "visible" }),
  ]);
  if (!await enrollmentSecret.isVisible()) return;
  await page.getByLabel("Doğrulama kodu", { exact: true }).fill(createTotpCode(await enrollmentSecret.inputValue()));
  await page.getByRole("button", { name: "Etkinleştir ve giriş yap" }).click();
  await expect(page).toHaveURL(destination);
}
