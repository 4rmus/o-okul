import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { parseArgs, validateTarget, validateContext, validateContainer, executeDrill } from "./tenant-reset-postgres-drill.mjs";

const options = { execute: true, context: "desktop-linux", socket: "/drill-home/.docker/run/docker.sock" };
test("default and dry-run cannot opt into execution; ambiguous/unknown targets fail", async () => {
  assert.deepEqual(parseArgs([]), { execute: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { execute: false });
  assert.deepEqual(parseArgs(["--dry-run", "--with-queue"]), { execute: false, withQueue: true });
  assert.throws(() => parseArgs(["--with-queue", "--with-queue"]));
  assert.deepEqual(parseArgs(["--with-legacy-status"]), { execute: false, withLegacyStatus: true });
  assert.throws(() => parseArgs(["--with-legacy-status", "--with-legacy-status"]));
  for (const args of [["--dry-run", "--execute"], ["--execute", "--dry-run"], ["--database-url", "postgres://remote"], ["--docker-context"]]) assert.throws(() => parseArgs(args));
  await assert.rejects(executeDrill({ execute: false }), /EXECUTION_FLAG_REQUIRED/);
});
test("Redis ownership requires its exact image, tmpfs data and loopback Redis port", () => {
  const redis = container();
  redis.Config.Image = "redis:7";
  redis.HostConfig.Tmpfs = { "/data": "rw" };
  redis.NetworkSettings.Ports = { "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "43210" }] };
  const owner = { ...owned, image: "redis:7" };
  assert.equal(validateContainer(redis, owner), 43210);
  assert.throws(() => validateContainer(redis, owned));
  redis.NetworkSettings.Ports["6379/tcp"][0].HostIp = "0.0.0.0";
  assert.throws(() => validateContainer(redis, owner));
});
test("execution requires exact known local context/socket and rejects ambient connection/loaders", () => {
  validateTarget(options, {}, "/drill-home");
  const colima = { execute: true, context: "colima-o-okul-reset-drill", socket: "/drill-home/.colima/o-okul-reset-drill/docker.sock" };
  validateTarget(colima, {}, "/drill-home");
  for (const override of [{ context: "colima" }, { socket: "/drill-home/.colima/default/docker.sock" }, { socket: options.socket }]) assert.throws(() => validateTarget({ ...colima, ...override }, {}, "/drill-home"));
  for (const override of [{ context: "remote" }, { socket: "/tmp/proxy.sock" }, { socket: "tcp://remote:2375" }, { context: undefined }]) assert.throws(() => validateTarget({ ...options, ...override }, {}, "/drill-home"));
  for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL", "PGHOST", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "NODE_OPTIONS", "DOTENV_CONFIG_PATH"]) assert.throws(() => validateTarget(options, { [key]: "untrusted" }, "/drill-home"), /OVERRIDE_REJECTED/);
});
test("inspected context must match approved Unix socket, not a remote fallback", () => {
  validateContext({ Name: options.context, Endpoints: { docker: { Host: `unix://${options.socket}` } } }, options);
  for (const endpoint of ["ssh://remote", "tcp://localhost:2375", "unix:///tmp/other.sock"]) assert.throws(() => validateContext({ Name: options.context, Endpoints: { docker: { Host: endpoint } } }, options));
});
const owned = { id: "a".repeat(64), name: "o-okul-reset-drill-123", nonce: "123", imageId: `sha256:${"b".repeat(64)}` };
function container() { return { Id: owned.id, Name: `/${owned.name}`, Image: owned.imageId, Config: { Image: "postgres:16", Labels: { "com.o-okul.tenant-reset-drill": owned.nonce } }, HostConfig: { Tmpfs: { "/var/lib/postgresql/data": "rw" }, NetworkMode: "bridge", Privileged: false }, Mounts: [{ Type: "tmpfs" }], NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "43127" }] } } }; }
test("cleanup ownership needs ID+nonce+name+image+tmpfs+loopback, not a matching name alone", () => {
  assert.equal(validateContainer(container(), owned), 43127);
  for (const mutate of [
    (value) => value.Id = "c".repeat(64), (value) => value.Name = "/existing-database",
    (value) => value.Config.Labels = {}, (value) => value.Image = "unexpected",
    (value) => value.HostConfig.Privileged = true, (value) => value.HostConfig.Tmpfs = {},
    (value) => value.Mounts = [{ Type: "bind" }], (value) => value.HostConfig.NetworkMode = "host",
    (value) => value.NetworkSettings.Ports["5432/tcp"][0].HostIp = "0.0.0.0",
    (value) => value.NetworkSettings.Ports["5432/tcp"][0].HostPort = "5432;rm",
  ]) { const value = container(); mutate(value); assert.throws(() => validateContainer(value, owned)); }
});
test("default CLI emits source/migration manifest with no Docker, DB or runtime dependency import", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/tenant-reset-postgres-drill.mjs"], { cwd: new URL("../", import.meta.url), env: { PATH: "/nonexistent" } });
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.executed, false); assert.equal(manifest.evidenceClass, "LOCAL_STATIC");
  assert.equal(manifest.requiresExplicitUserApproval, true); assert.equal(manifest.quiescence, "WRITE_QUIESCENCE_UNVERIFIED");
  assert.equal(manifest.migrationMode, "PRISMA_MIGRATE_DEPLOY_VERIFIED_LEDGER");
  assert.ok(manifest.migrations.length > 50); assert.match(manifest.runtimeSourceSha256, /^[a-f0-9]{64}$/);
  for (const migration of manifest.migrations) assert.match(migration.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.scenarios.length, 11);
});
test("queue dry-run declares five local scenarios without starting Redis or a provider", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/tenant-reset-postgres-drill.mjs", "--with-queue"], { cwd: new URL("../", import.meta.url), env: { PATH: "/nonexistent" } });
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.executed, false);
  assert.equal(manifest.queueScenarios.length, 5);
  const source = await readFile(new URL("./tenant-reset-queue-drill.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env|fetch\(|DELETE FROM|\.obliterate\(|\.clean\(/);
  for (const text of ["LOCAL_STUB_NO_EXTERNAL_SEND", "providerCalls, 1", "await uncertain.retry()", "requireNoTenantMutationActivity", "validateContainer(inspected[0], owned)"]) assert.ok(source.includes(text), text);
});
test("legacy upgrade dry-run stays offline and declares the populated baseline check", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/tenant-reset-postgres-drill.mjs", "--with-legacy-status"], { cwd: new URL("../", import.meta.url), env: { PATH: "/nonexistent" } });
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.executed, false); assert.equal(manifest.legacyStatusUpgrade, true);
  const source = await readFile(new URL("./tenant-legacy-status-drill.mjs", import.meta.url), "utf8");
  for (const text of ["LEGACY_LINKED_DATA_CHANGED", "TENANT_STATUS_UNSUPPORTED", "SYSTEM_TENANT_STATUS_INVALID", "REJECTED_MIGRATION_CHANGED_DATA"]) assert.ok(source.includes(text), text);
});
test("runtime contract keeps real sources, no pull/envfile/Prisma fake ledger and explicit success-only owned cleanup", async () => {
  const source = await readFile(new URL("./tenant-reset-postgres-drill.mjs", import.meta.url), "utf8");
  for (const text of ["--pull=never", "127.0.0.1::5432", "assertResetWorkerRole(reset)", "PostgresAuthUserStore(app)", "runTenantMutationActivity(app", "pg_terminate_backend", "RUNTIME_SOURCE_CHANGED", "validateContainer(final[0], owned)", 'docker(["rm", "--force", owned.id])', '"--env", "POSTGRES_PASSWORD"', "{ POSTGRES_PASSWORD: password }", "parseInstitutionResetRequest({", 'setPhase("REQUEST_IMMUTABILITY")', "other-tenant-progress"]) assert.ok(source.includes(text), text);
  assert.equal(source.includes("POSTGRES_PASSWORD=${"), false);
  for (const text of ['"prisma", "migrate", "deploy", "--config", configPath', "MIGRATION_LEDGER_MISMATCH", "process.env.DRILL_DATABASE_URL"]) assert.ok(source.includes(text), text);
  assert.doesNotMatch(source, /SET ROLE|docker\(\["pull"|--env-file|dotenv\/config|INSERT INTO.*_prisma_migrations|process\.env\.DATABASE_URL/);
});
