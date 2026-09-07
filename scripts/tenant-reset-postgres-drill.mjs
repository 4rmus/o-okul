import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, mkdir, writeFile, stat, mkdtemp, rm, cp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { queueScenarios } from "./tenant-reset-queue-drill.mjs";
import { statusMigration, seedLegacyStatusUpgrade, verifyLegacyStatusUpgrade, verifyLegacyBackfills } from "./tenant-legacy-status-drill.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const image = "postgres:16";
const label = "com.o-okul.tenant-reset-drill";
const migrationRoot = resolve(root, "packages/db/prisma/migrations");
const scenarioNames = ["shared-exclusive-contention", "other-tenant-progress", "read-only-polling", "session-loss-unlock", "app-rls", "reset-worker-grants", "secret-worker-grants", "request-immutability", "outbox-provenance-and-uncertainty", "original-epoch-admission", "original-user-version-cas"];

export function parseArgs(args) {
  const options = { execute: false };
  let mode;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--with-queue") { if (options.withQueue) throw new Error("DUPLICATE_ARGUMENT"); options.withQueue = true; }
    else if (arg === "--with-legacy-status") { if (options.withLegacyStatus) throw new Error("DUPLICATE_ARGUMENT"); options.withLegacyStatus = true; }
    else if (arg === "--execute" || arg === "--dry-run") { if (mode) throw new Error("CONFLICTING_MODE"); mode = arg; options.execute = arg === "--execute"; }
    else if (["--docker-context", "--approved-local-socket"].includes(arg)) {
      if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error("ARGUMENT_VALUE_REQUIRED");
      const key = arg === "--docker-context" ? "context" : "socket";
      if (options[key]) throw new Error("DUPLICATE_ARGUMENT");
      options[key] = args[++index];
    } else throw new Error("UNKNOWN_ARGUMENT");
  }
  return options;
}
export function validateTarget(options, environment = process.env, home = homedir()) {
  if (!options.execute) return;
  const sockets = { default: "/var/run/docker.sock", "desktop-linux": `${home}/.docker/run/docker.sock`, "colima-o-okul-reset-drill": `${home}/.colima/o-okul-reset-drill/docker.sock` };
  if (!Object.hasOwn(sockets, options.context)) throw new Error("LOCAL_DOCKER_CONTEXT_REQUIRED");
  if (options.socket !== sockets[options.context]) throw new Error("APPROVED_LOCAL_SOCKET_REQUIRED");
  if (Object.keys(environment).some((key) => /(^PG|DATABASE_URL$|^DOCKER_|^DOTENV_CONFIG_|^NODE_OPTIONS$)/.test(key) && environment[key])) throw new Error("AMBIENT_CONNECTION_OR_LOADER_OVERRIDE_REJECTED");
}
export function validateContext(context, options) {
  if (context.Name !== options.context || context.Endpoints?.docker?.Host !== `unix://${options.socket}` || context.Endpoints?.docker?.SkipTLSVerify === true) throw new Error("DOCKER_CONTEXT_ENDPOINT_MISMATCH");
}
export function validateContainer(container, owned) {
  const redis = owned.image === "redis:7";
  if (!/^[a-f0-9]{64}$/.test(owned.id) || container.Id !== owned.id || container.Name !== `/${owned.name}` || container.Config?.Labels?.[label] !== owned.nonce || container.Config?.Image !== (redis ? "redis:7" : image) || container.Image !== owned.imageId) throw new Error("CONTAINER_OWNERSHIP_MISMATCH");
  if (!container.HostConfig?.Tmpfs?.[redis ? "/data" : "/var/lib/postgresql/data"] || container.HostConfig?.Privileged || container.HostConfig?.NetworkMode === "host" || container.HostConfig?.Binds?.length || container.HostConfig?.VolumesFrom?.length || (container.Mounts ?? []).some((mount) => mount.Type !== "tmpfs")) throw new Error("CONTAINER_STORAGE_OR_NETWORK_UNSAFE");
  const ports = container.NetworkSettings?.Ports?.[redis ? "6379/tcp" : "5432/tcp"];
  if (!Array.isArray(ports) || ports.length !== 1 || ports[0].HostIp !== "127.0.0.1" || !/^\d+$/.test(ports[0].HostPort) || Number(ports[0].HostPort) < 1024 || Number(ports[0].HostPort) > 65535) throw new Error("LOOPBACK_RANDOM_PORT_REQUIRED");
  return Number(ports[0].HostPort);
}
async function sourceFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await sourceFiles(resolve(directory, entry.name)));
    else if (entry.name.endsWith(".ts")) found.push(resolve(directory, entry.name));
  }
  return found;
}
export async function plan(options = {}) {
  const names = (await readdir(migrationRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const migrations = [];
  for (const name of names) migrations.push({ name, path: `packages/db/prisma/migrations/${name}/migration.sql`, sha256: createHash("sha256").update(await readFile(resolve(migrationRoot, name, "migration.sql"))).digest("hex") });
  const sources = (await Promise.all(["packages/db/src", "packages/shared-types/src", "apps/api/src", "apps/worker/src", "packages/sms-adapter/src", "packages/notification-adapter/src"].map((path) => sourceFiles(resolve(root, path))))).flat().sort();
  const digest = createHash("sha256");
  for (const path of sources) digest.update(path.slice(root.length)).update(await readFile(path));
  digest.update(await readFile(fileURLToPath(import.meta.url)));
  digest.update(await readFile(resolve(root, "scripts/tenant-reset-queue-drill.mjs")));
  digest.update(await readFile(resolve(root, "scripts/tenant-legacy-status-drill.mjs")));
  digest.update(await readFile(resolve(root, "docker/postgres/init/005_bootstrap_tenant_reset_worker_role.sh")));
  for (const file of ["backfill-account-management.mjs", "backfill-license-terms.mjs", "check-account-management-backfill.mjs", "check-license-term-backfill.mjs"]) digest.update(await readFile(resolve(root, "scripts", file)));
  return { evidenceClass: "LOCAL_STATIC", mode: "DRY_RUN", executed: false, runtime: "NOT_RUN", prerequisites: "NOT_CHECKED", image, pull: "never", containerStorage: "tmpfs only", host: "127.0.0.1", port: "Docker-assigned", migrations, migrationMode: "PRISMA_MIGRATE_DEPLOY_VERIFIED_LEDGER", bootstrap: "FRESH_DB_ROLES_AND_GENERATED_LOGIN_CREDENTIALS_ONLY", runtimeSourceSha256: digest.digest("hex"), scenarios: scenarioNames, queueScenarios: options.withQueue ? queueScenarios : [], legacyStatusUpgrade: options.withLegacyStatus === true, requiresExplicitUserApproval: true, provesFullReset: false, quiescence: "WRITE_QUIESCENCE_UNVERIFIED" };
}
function subprocessEnv() {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}
async function command(program, args, extraEnv = {}) {
  return (await exec(program, args, { cwd: root, env: { ...subprocessEnv(), ...extraEnv }, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}

export async function executeDrill(options) {
  assert.equal(options.execute, true, "EXECUTION_FLAG_REQUIRED");
  validateTarget(options);
  if (!(await stat(options.socket)).isSocket()) throw new Error("LOCAL_DOCKER_SOCKET_UNAVAILABLE");
  const docker = (args, extraEnv) => command("docker", ["--context", options.context, ...args], extraEnv);
  const context = JSON.parse(await docker(["context", "inspect", options.context]));
  assert.equal(context.length, 1); validateContext(context[0], options);
  const images = JSON.parse(await docker(["image", "inspect", image])); // No implicit pull.
  assert.equal(images.length, 1); assert.match(images[0].Id, /^sha256:[a-f0-9]{64}$/);
  await command("pnpm", ["--filter", "@o-okul/shared-types", "build"]);
  await command("pnpm", ["--filter", "@o-okul/db", "build"]);
  const manifest = await plan(options);
  const nonce = randomBytes(12).toString("hex"), name = `o-okul-reset-drill-${nonce}`;
  const password = randomBytes(24).toString("hex");
  const owned = { nonce, name, imageId: images[0].Id, id: "" };
  const evidence = { ...manifest, evidenceClass: "LOCAL_RUNTIME", mode: "EXECUTE", executed: true, runtime: "ATTEMPTED", prerequisites: "LOCAL_CONTEXT_AND_IMAGE_VERIFIED", status: "FAIL", phase: "CREATE_CONTAINER", container: { name, imageId: owned.imageId }, checks: [], cleanup: "NOT_CREATED" };
  const evidencePath = resolve(root, "artifacts/tenant-reset-postgres-drill", `${nonce}.json`);
  let pool, unexpectedPoolError = false;
  try {
    // The flag is an execution guard, never a replacement for action-time user approval.
    owned.id = await docker(["run", "--detach", "--pull=never", "--name", name, "--label", `${label}=${nonce}`, "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,size=512m", "--memory", "768m", "--cpus", "2", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB=o_okul_reset_drill", image], { POSTGRES_PASSWORD: password });
    evidence.cleanup = "RETAINED_UNTIL_VERIFIED";
    const inspected = JSON.parse(await docker(["inspect", owned.id])); assert.equal(inspected.length, 1);
    const port = validateContainer(inspected[0], owned);
    evidence.container.id = owned.id;
    evidence.container.host = "127.0.0.1";
    evidence.container.port = port;
    const require = createRequire(resolve(root, "packages/db/package.json"));
    const pg = require("pg");
    evidence.phase = "POSTGRES_READINESS";
    const connection = { host: "127.0.0.1", port, database: "o_okul_reset_drill", password, max: 6, connectionTimeoutMillis: 2000, statement_timeout: 10000 };
    pool = new pg.Pool({ ...connection, user: "postgres" });
    pool.on("error", () => { unexpectedPoolError = true; });
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await pool.query("SELECT 1"); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
    }
    assert.equal(ready, true, "POSTGRES_NOT_READY");
    assert.equal(Math.floor(Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num) / 10000), 16, "POSTGRES_16_REQUIRED");
    evidence.serverMajor = 16;
    evidence.phase = "BOOTSTRAP_AND_MIGRATIONS";
    await pool.query("CREATE ROLE app NOLOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE secret_delivery_worker NOLOGIN NOSUPERUSER NOBYPASSRLS");
    await pool.query(`CREATE ROLE migration LOGIN PASSWORD '${password}' NOCREATEROLE NOSUPERUSER NOBYPASSRLS;
      GRANT CONNECT, CREATE ON DATABASE o_okul_reset_drill TO migration;
      ALTER SCHEMA public OWNER TO migration`);
    const resetRoleScript = await readFile(resolve(root, "docker/postgres/init/005_bootstrap_tenant_reset_worker_role.sh"), "utf8");
    const bootstrapResetRole = () => docker(["exec", "--env", "POSTGRES_USER=postgres", owned.id, "sh", "-c", resetRoleScript]);
    await bootstrapResetRole();
    const resetRoleFlags = () => pool.query("SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = 'o_okul_reset_worker'");
    const roleBefore = (await resetRoleFlags()).rows;
    for (const [unsafe, undo] of [
      ["ALTER ROLE o_okul_reset_worker LOGIN", "ALTER ROLE o_okul_reset_worker NOLOGIN"],
      ["GRANT o_okul_reset_worker TO app", "REVOKE o_okul_reset_worker FROM app"],
      ["GRANT app TO o_okul_reset_worker", "REVOKE app FROM o_okul_reset_worker"],
    ]) {
      await pool.query(unsafe);
      await assert.rejects(bootstrapResetRole(), (error) => String(error.stderr).includes("TENANT_RESET_WORKER_ROLE_UNSAFE"));
      await pool.query(undo);
    }
    await bootstrapResetRole();
    assert.deepEqual((await resetRoleFlags()).rows, roleBefore);
    evidence.resetRoleBootstrap = { status: "PASS", loginRejected: true, inboundMembershipRejected: true, outboundMembershipRejected: true, replayPreserved: true };
    const migrator = new pg.Pool({ ...connection, user: "migration" });
    try {
      assert.deepEqual((await migrator.query("SELECT current_user AS name, rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = current_user")).rows[0], { name: "migration", rolsuper: false, rolcreaterole: false, rolbypassrls: false });
    } finally { await migrator.end(); }
    evidence.migrationIdentity = "migration:NOSUPERUSER:NOCREATEROLE:NOBYPASSRLS";
    const configDirectory = await mkdtemp(resolve(tmpdir(), "o-okul-reset-drill-"));
    let legacyBefore;
    try {
      const configPath = resolve(configDirectory, "prisma.config.mjs");
      const deployMigrations = options.withLegacyStatus ? resolve(configDirectory, "migrations") : migrationRoot;
      if (options.withLegacyStatus) {
        await mkdir(deployMigrations);
        await cp(resolve(migrationRoot, "migration_lock.toml"), resolve(deployMigrations, "migration_lock.toml"));
        for (const migration of manifest.migrations.filter((m) => m.name < statusMigration)) await cp(resolve(migrationRoot, migration.name), resolve(deployMigrations, migration.name), { recursive: true });
      }
      // Isolated config never loads the repository .env; URL exists only in child env.
      await writeFile(configPath, `import { defineConfig } from ${JSON.stringify(pathToFileURL(require.resolve("prisma/config")).href)};\nexport default defineConfig({ schema: ${JSON.stringify(resolve(root, "packages/db/prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(deployMigrations)} }, datasource: { url: process.env.DRILL_DATABASE_URL } });\n`, { flag: "wx", mode: 0o600 });
      const deploy = () => command("pnpm", ["--filter", "@o-okul/db", "exec", "prisma", "migrate", "deploy", "--config", configPath], { DRILL_DATABASE_URL: `postgresql://migration:${password}@127.0.0.1:${port}/o_okul_reset_drill` });
      await deploy();
      if (options.withLegacyStatus) {
        evidence.phase = "LEGACY_STATUS_UPGRADE";
        legacyBefore = await seedLegacyStatusUpgrade(pool, await readFile(resolve(migrationRoot, statusMigration, "migration.sql"), "utf8"));
        for (const migration of manifest.migrations.filter((m) => m.name >= statusMigration)) await cp(resolve(migrationRoot, migration.name), resolve(deployMigrations, migration.name), { recursive: true });
        await deploy();
        evidence.legacyStatus = await verifyLegacyStatusUpgrade(pool, legacyBefore);
        await deploy(); // Actual Prisma no-op replay must not change the preserved rows.
        assert.deepEqual(await verifyLegacyStatusUpgrade(pool, legacyBefore), evidence.legacyStatus);
        evidence.phase = "LEGACY_BACKFILL_COMPATIBILITY";
        evidence.legacyBackfills = await verifyLegacyBackfills(pool, (script, env) => command(process.execPath, [script], {
          ...env, STAGING_ENVIRONMENT: "staging", DIRECT_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/o_okul_reset_drill`,
        }), resolve(root, "artifacts/tenant-reset-postgres-drill", nonce));
      }
    } finally { await rm(configDirectory, { recursive: true }); }
    const ledger = await pool.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    assert.deepEqual(ledger.rows, manifest.migrations.map(({ name, sha256 }) => ({ migration_name: name, checksum: sha256 })), "MIGRATION_LEDGER_MISMATCH");
    evidence.checks.push("repository-migrations-applied-with-verified-prisma-ledger");
    evidence.phase = "SOURCE_IMPORT_AND_ROLE_LOGIN";
    // Disposable bootstrap supplies credentials only; migrations remain the source of grants.
    for (const role of ["app", "secret_delivery_worker", "o_okul_reset_worker"]) await pool.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    const { tsImport } = require("tsx/esm/api");
    const db = await tsImport(resolve(root, "packages/db/src/tenant-db.ts"), import.meta.url);
    const activity = await tsImport(resolve(root, "packages/db/src/tenant-mutation-activity.ts"), import.meta.url);
    const auth = await tsImport(resolve(root, "apps/api/src/auth/auth-user-store.ts"), import.meta.url);
    const resetSource = await tsImport(resolve(root, "packages/db/src/tenant-fresh-reset.ts"), import.meta.url);
    const requestSource = await tsImport(resolve(root, "packages/db/src/tenant-reset-request.ts"), import.meta.url);
    const rolePools = Object.fromEntries(["app", "secret_delivery_worker", "o_okul_reset_worker"].map((user) => [user, new pg.Pool({ ...connection, user })]));
    for (const rolePool of Object.values(rolePools)) rolePool.on("error", () => { unexpectedPoolError = true; });
    try {
      await verifyDatabase(pool, rolePools, { ...db, ...activity, ...auth, ...resetSource, ...requestSource }, evidence.checks, (phase) => { evidence.phase = phase; });
      if (options.withLegacyStatus) {
        let calls = 0;
        await assert.rejects(activity.runTenantMutationActivity(rolePools.app, { tenantId: "legacy-closed-1", lifecycleVersion: 0, kind: "WORKER_JOB" }, async () => { calls++; }), /TENANT_ACTIVITY_INACTIVE/);
        assert.equal(calls, 0);
        evidence.legacyStatus.closedAdmissionBlocked = true;
      }
      if (options.withQueue) {
        evidence.phase = "REDIS_BULLMQ_DRILL";
        const { verifyQueueDrill } = await import("./tenant-reset-queue-drill.mjs");
        await verifyQueueDrill({ pool, app: rolePools.app, tsImport, docker, evidence, root, validateContainer });
      }
    }
    finally { await Promise.all(Object.values(rolePools).map((rolePool) => rolePool.end())); }
    assert.equal(unexpectedPoolError, false, "UNEXPECTED_POOL_ERROR");
    evidence.phase = "FINAL_SOURCE_INTEGRITY";
    const finalManifest = await plan(options);
    assert.equal(finalManifest.runtimeSourceSha256, manifest.runtimeSourceSha256, "RUNTIME_SOURCE_CHANGED");
    assert.deepEqual(finalManifest.migrations, manifest.migrations, "MIGRATION_SOURCE_CHANGED");
    await pool.end(); pool = undefined;
    evidence.phase = "OWNED_CONTAINER_CLEANUP";
    const final = JSON.parse(await docker(["inspect", owned.id])); assert.equal(final.length, 1); validateContainer(final[0], owned);
    await docker(["rm", "--force", owned.id]);
    evidence.cleanup = "OWNED_CONTAINER_REMOVED"; evidence.status = "PASS"; evidence.phase = "DONE";
  } catch (error) {
    // Never print raw child-process/SQL errors or credential-bearing connection details.
    evidence.errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "DRILL_FAILED_REVIEW_REQUIRED";
    if (owned.id) evidence.container.id = owned.id;
    evidence.cleanup = owned.id ? "RETAINED_NO_AUTOMATIC_RETRY" : "CREATION_OUTCOME_REQUIRES_INSPECTION";
  } finally {
    await pool?.end().catch(() => {});
    await mkdir(resolve(root, "artifacts/tenant-reset-postgres-drill"), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  return { status: evidence.status, evidencePath, containerName: name, cleanup: evidence.cleanup };
}

async function verifyDatabase(pool, rolePools, source, checks, setPhase) {
  const { withTenantDb, tenantDatabaseLockKey, runTenantMutationActivity, PostgresAuthUserStore, assertResetWorkerRole, parseInstitutionResetRequest } = source;
  setPhase("FIXTURES_AND_ROLE_IDENTITIES");
  const a = "drill-tenant-a", b = "drill-tenant-b";
  await pool.query('INSERT INTO "Tenant" ("id","name","slug","updatedAt") VALUES ($1,$1,$1,now()),($2,$2,$2,now())', [a, b]);
  await pool.query('INSERT INTO "User" ("id","tenantId","name","passwordHash","updatedAt") VALUES ($1,$2,$1,\'synthetic-noncredential\',now()),($3,$4,$3,\'synthetic-noncredential\',now())', ["drill-user-a", a, "drill-user-b", b]);
  const app = rolePools.app, reset = rolePools.o_okul_reset_worker, secret = rolePools.secret_delivery_worker;
  for (const [role, connection] of Object.entries(rolePools)) assert.deepEqual((await connection.query("SELECT current_user, session_user")).rows[0], { current_user: role, session_user: role });
  await assertResetWorkerRole(reset);
  const holder = await pool.connect(); holder.on("error", () => {});
  const lock = "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked";
  const unlock = "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS locked";
  setPhase("SHARED_EXCLUSIVE_OTHER_TENANT_AND_READ_ONLY");
  try {
    await withTenantDb(app, { tenantId: a }, async () => assert.equal((await holder.query(lock, [tenantDatabaseLockKey(a)])).rows[0].locked, false));
    assert.equal((await holder.query(lock, [tenantDatabaseLockKey(a)])).rows[0].locked, true);
    let called = false;
    await assert.rejects(withTenantDb(app, { tenantId: a }, async () => { called = true; }), /TENANT_DATABASE_BUSY/); assert.equal(called, false);
    await withTenantDb(app, { tenantId: b }, async (db) => {
      const changed = await db.query('UPDATE "User" SET "name" = \'other-tenant-progress\' WHERE "id" = \'drill-user-b\' RETURNING "id"');
      assert.deepEqual(changed.rows, [{ id: "drill-user-b" }]);
    });
    assert.equal((await pool.query('SELECT "name" FROM "User" WHERE "id" = \'drill-user-b\'')).rows[0].name, "other-tenant-progress");
    await withTenantDb(app, { tenantId: a, readOnly: true }, (db) => db.query('SELECT "id" FROM "User"'));
    await assert.rejects(withTenantDb(app, { tenantId: a, readOnly: true }, (db) => db.query('UPDATE "User" SET "name" = \'forbidden\'')), (error) => error.code === "25006");
    checks.push("shared-exclusive-contention", "other-tenant-progress", "read-only-polling");
    setPhase("SESSION_LOSS_UNLOCK");
    const pid = (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const terminated = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("SESSION_TERMINATION_TIMEOUT")), 10000);
      holder.once("error", () => { clearTimeout(timeout); resolve(); });
    });
    await Promise.all([terminated, pool.query("SELECT pg_terminate_backend($1)", [pid])]);
  } finally { holder.release(true); }
  const afterLoss = await pool.connect();
  try {
    let released = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await afterLoss.query(lock, [tenantDatabaseLockKey(a)])).rows[0].locked === true) { released = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(released, true, "SESSION_LOSS_LOCK_NOT_RELEASED");
    await afterLoss.query(unlock, [tenantDatabaseLockKey(a)]);
  } finally { afterLoss.release(true); }
  checks.push("session-loss-unlock");
  setPhase("APP_RLS");
  assert.deepEqual((await withTenantDb(app, { tenantId: a }, (db) => db.query('SELECT "id" FROM "User"'))).rows.map((row) => row.id), ["drill-user-a"]);
  checks.push("app-rls");
  setPhase("RESET_WORKER_GRANTS");
  assert.deepEqual((await withTenantDb(reset, { tenantId: a, bypassRls: true }, (db) => db.query('SELECT "id" FROM "Tenant"'))).rows.map((row) => row.id), [a]);
  await assert.rejects(withTenantDb(reset, { tenantId: a }, (db) => db.query('DELETE FROM "Tenant" WHERE "id" = $1', [a])), (error) => error.code === "42501");
  await assert.rejects(withTenantDb(reset, { tenantId: a }, (db) => db.query('UPDATE "User" SET "passwordHash" = \'forbidden\' WHERE "tenantId" = $1', [a])), (error) => error.code === "42501");
  checks.push("reset-worker-grants");
  setPhase("SECRET_WORKER_GRANTS");
  await withTenantDb(secret, { tenantId: a }, (db) => db.query('SELECT "id", "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1', [a]));
  await assert.rejects(withTenantDb(secret, { tenantId: a }, (db) => db.query('SELECT "name" FROM "Tenant"')), (error) => error.code === "42501");
  await assert.rejects(withTenantDb(secret, { tenantId: a }, (db) => db.query('SELECT "id" FROM "User"')), (error) => error.code === "42501");
  checks.push("secret-worker-grants");
  setPhase("REQUEST_IMMUTABILITY");
  const request = parseInstitutionResetRequest({ id: "a".repeat(32), tenantId: a, status: "PENDING", operationId: null, requestedBy: "drill-user-a", requestedAt: new Date().toISOString(), lifecycleVersion: 0 });
  await assert.rejects(withTenantDb(reset, { tenantId: a }, (db) => db.query('UPDATE "Tenant" SET "resetRequest" = $2 WHERE "id" = $1', [a, request])), /RESET_REQUEST_ACTOR_INVALID/);
  await pool.query('UPDATE "Tenant" SET "resetRequest" = $2 WHERE "id" = $1', [a, parseInstitutionResetRequest({ ...request, status: "ACCEPTED", operationId: "b".repeat(32) })]);
  await assert.rejects(pool.query('UPDATE "Tenant" SET "resetRequest" = NULL WHERE "id" = $1', [a]), /RESET_REQUEST_ALREADY_ACCEPTED/);
  checks.push("request-immutability");
  setPhase("OUTBOX_PROVENANCE_AND_UNCERTAINTY");
  await pool.query('INSERT INTO "SecretDeliveryOutbox" ("id","tenantId","purpose","sourceId","sourceScope","tenantLifecycleVersion","status","attempts","expiresAt") VALUES (\'drill-outbox\',$1,\'PASSWORD_RESET\',\'synthetic-source\',\'TENANT\',0,\'UNCERTAIN\',1,now() + interval \'1 hour\')', [a]);
  await assert.rejects(pool.query('UPDATE "SecretDeliveryOutbox" SET "tenantLifecycleVersion" = 1 WHERE "id" = \'drill-outbox\''), /OUTBOX_PROVENANCE_IMMUTABLE/);
  await assert.rejects(pool.query('UPDATE "SecretDeliveryOutbox" SET "status" = \'PENDING\' WHERE "id" = \'drill-outbox\''), /OUTBOX_DISPATCH_UNCERTAIN/);
  await pool.query('UPDATE "SecretDeliveryOutbox" SET "status" = \'EXPIRED\' WHERE "id" = \'drill-outbox\'');
  assert.equal((await pool.query('SELECT "status" FROM "SecretDeliveryOutbox" WHERE "id" = \'drill-outbox\'')).rows[0].status, "UNCERTAIN");
  await assert.rejects(pool.query('INSERT INTO "SecretDeliveryOutbox" ("id","tenantId","purpose","sourceId","sourceScope","expiresAt") VALUES (\'invalid-source\',$1,\'PASSWORD_RESET\',\'bad\',\'TENANT\',now())', [a]), (error) => error.code === "23514");
  checks.push("outbox-provenance-and-uncertainty");
  setPhase("ORIGINAL_EPOCH_ADMISSION");
  await pool.query('UPDATE "Tenant" SET "lifecycleVersion" = 1 WHERE "id" = $1', [a]);
  let admitted = 0;
  await assert.rejects(runTenantMutationActivity(app, { tenantId: a, lifecycleVersion: 0, kind: "WORKER_JOB", referenceId: "drill-old" }, async () => { admitted++; }), /TENANT_ACTIVITY_STALE/);
  assert.equal(admitted, 0);
  await runTenantMutationActivity(app, { tenantId: a, lifecycleVersion: 1, kind: "WORKER_JOB", referenceId: "drill-new" }, async () => { admitted++; });
  await runTenantMutationActivity(app, { tenantId: b, lifecycleVersion: 0, kind: "WORKER_JOB", referenceId: "drill-b" }, async () => { admitted++; });
  assert.equal(admitted, 2); checks.push("original-epoch-admission");
  setPhase("ORIGINAL_USER_VERSION_CAS");
  const users = new PostgresAuthUserStore(app);
  await pool.query('UPDATE "User" SET "membershipVersion" = 2 WHERE "id" = \'drill-user-a\'');
  assert.equal(await users.markTotpCounterUsed("drill-user-a", "10", { tenantId: a, membershipVersion: 1 }), false);
  assert.equal(await users.markTotpCounterUsed("drill-user-a", "10", { tenantId: b, membershipVersion: 2 }), false);
  assert.equal(await users.markTotpCounterUsed("drill-user-a", "10", { tenantId: a, membershipVersion: 2 }), true);
  assert.equal(await users.markTotpCounterUsed("drill-user-b", "10", { tenantId: b, membershipVersion: 1 }), true);
  checks.push("original-user-version-cas");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.execute ? await executeDrill(options) : await plan(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "FAIL") process.exitCode = 1;
  } catch { console.error("DRILL_PREFLIGHT_FAILED: inspect local prerequisites; no automatic retry or target fallback."); process.exitCode = 1; }
}
