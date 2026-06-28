import request from "supertest";

type TestServer = Parameters<typeof request>[0];

interface TestLoginIdentity {
  nationalId: string;
  password: string;
  tenantSlug: string;
}

const testLoginIdentities = new Map<string, TestLoginIdentity>([
  ["admin-a@example.test", { nationalId: "10000000146", password: "password", tenantSlug: "dna-egitim" }],
  ["admin-b@example.test", { nationalId: "10000000832", password: "password", tenantSlug: "demo-kurum-b" }],
  ["assistant-a@example.test", { nationalId: "10000000382", password: "password", tenantSlug: "dna-egitim" }],
  ["teacher-a@example.test", { nationalId: "10000000696", password: "password", tenantSlug: "dna-egitim" }],
  ["student-a@example.test", { nationalId: "10000000528", password: "password", tenantSlug: "dna-egitim" }],
  ["guardian-a@example.test", { nationalId: "10000000764", password: "password", tenantSlug: "dna-egitim" }],
  ["system@example.test", { nationalId: "10000000214", password: "password", tenantSlug: "system" }],
  ["expired-tenant@example.test", { nationalId: "10000000900", password: "password", tenantSlug: "demo-suresi-dolmus-kurum" }],
  ["privacy@example.test", { nationalId: "10000001068", password: "password", tenantSlug: "dna-egitim" }],
  ["finance-privacy@example.test", { nationalId: "10000001136", password: "password", tenantSlug: "dna-egitim" }],
]);

export function registerTestLoginIdentity(
  email: string,
  identity: Omit<TestLoginIdentity, "password"> & { password?: string },
) {
  testLoginIdentities.set(email.toLowerCase(), {
    ...identity,
    password: identity.password ?? "password",
  });
}

export function testLoginBody(email: string, password?: string) {
  const identity = testLoginIdentities.get(email.toLowerCase());
  if (!identity) throw new Error(`UNKNOWN_TEST_LOGIN_IDENTITY:${email}`);
  return {
    nationalId: identity.nationalId,
    password: password ?? identity.password,
    tenantSlug: identity.tenantSlug,
  };
}

export async function loginAs(server: TestServer, email: string, password?: string): Promise<string> {
  const response = await request(server).post("/auth/login").send(testLoginBody(email, password)).expect(200);
  return (response.body as { accessToken: string }).accessToken;
}
