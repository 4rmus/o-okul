import request from "supertest";

type TestServer = Parameters<typeof request>[0];

interface TestLoginIdentity {
  loginName: string;
  password: string;
  tenantSlug: string;
}

const testLoginIdentities = new Map<string, TestLoginIdentity>([
  ["admin-a@example.test", { loginName: "admin-a@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["admin-b@example.test", { loginName: "admin-b@example.test", password: "password", tenantSlug: "demo-kurum-b" }],
  ["assistant-a@example.test", { loginName: "assistant-a@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["teacher-a@example.test", { loginName: "teacher-a@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["student-a@example.test", { loginName: "student-a@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["guardian-a@example.test", { loginName: "guardian-a@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["system@example.test", { loginName: "system@example.test", password: "password", tenantSlug: "system" }],
  ["expired-tenant@example.test", { loginName: "expired-tenant@example.test", password: "password", tenantSlug: "demo-suresi-dolmus-kurum" }],
  ["privacy@example.test", { loginName: "privacy@example.test", password: "password", tenantSlug: "dna-egitim" }],
  ["finance-privacy@example.test", { loginName: "finance-privacy@example.test", password: "password", tenantSlug: "dna-egitim" }],
]);

export function registerTestLoginIdentity(
  email: string,
  identity: Pick<TestLoginIdentity, "tenantSlug"> & { password?: string },
) {
  testLoginIdentities.set(email.toLowerCase(), {
    ...identity,
    loginName: email.toLowerCase(),
    password: identity.password ?? "password",
  });
}

export function testLoginBody(email: string, password?: string) {
  const identity = testLoginIdentities.get(email.toLowerCase());
  if (!identity) throw new Error(`UNKNOWN_TEST_LOGIN_IDENTITY:${email}`);
  return {
    loginName: identity.loginName,
    password: password ?? identity.password,
    tenantSlug: identity.tenantSlug,
  };
}

export async function loginAs(server: TestServer, email: string, password?: string): Promise<string> {
  const response = await request(server).post("/auth/login").send(testLoginBody(email, password)).expect(200);
  return (response.body as { accessToken: string }).accessToken;
}

export async function loginAsSettled(server: TestServer, email: string, password?: string): Promise<string> {
  const firstLogin = await request(server).post("/auth/login").send(testLoginBody(email, password)).expect(200);
  const body = firstLogin.body as { accessToken: string; session?: { mustChangePassword?: boolean } };
  if (!body.session?.mustChangePassword) return body.accessToken;

  const identity = testLoginIdentities.get(email.toLowerCase());
  if (!identity) throw new Error(`UNKNOWN_TEST_LOGIN_IDENTITY:${email}`);
  const currentPassword = password ?? identity.password;
  const newPassword = `${currentPassword}-changed`;
  await request(server)
    .post("/me/password")
    .set("Authorization", `Bearer ${body.accessToken}`)
    .send({ currentPassword, newPassword })
    .expect(200);
  identity.password = newPassword;

  const nextLogin = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
  return (nextLogin.body as { accessToken: string }).accessToken;
}
