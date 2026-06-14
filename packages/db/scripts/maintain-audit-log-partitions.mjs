import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const { Client } = pg;

const evidenceFile = process.env.AUDIT_LOG_PARTITION_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const startMonth = readStartMonth();
const monthsAhead = readPositiveInteger("AUDIT_LOG_PARTITION_MONTHS_AHEAD", 12);
const shouldApply = process.env.AUDIT_LOG_PARTITION_APPLY === "1";
const partitions = buildPartitionPlan(startMonth, monthsAhead);

if (evidenceFile) {
  await validateEvidenceOutputPath(resolve(evidenceFile));
}

if (shouldApply) {
  await applyPartitions(partitions);
}

const evidence = {
  result: "PASS",
  check: "audit_log_partition_maintenance",
  environment,
  generatedAt: new Date().toISOString(),
  mode: shouldApply ? "apply" : "dry-run",
  applied: shouldApply,
  startMonth,
  monthsPlanned: partitions.length,
  partitions: partitions.map(({ name, from, to }) => ({
    name,
    from,
    to,
    status: shouldApply ? "APPLIED" : "PLANNED",
  })),
  commandsPassed: ["pnpm audit-log-partition:maintain"],
  gaps: [],
};

await writeEvidence(evidenceFile, evidence);

console.log(
  `AuditLog partition bakımı ${shouldApply ? "uygulandı" : "planlandı"}: ${partitions[0]?.name}..${partitions.at(-1)?.name} (${partitions.length} ay).`,
);

function readStartMonth() {
  const value = process.env.AUDIT_LOG_PARTITION_START_MONTH ?? formatMonth(new Date());
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error("AUDIT_LOG_PARTITION_START_MONTH YYYY-MM formatında olmalı.");
  }
  return value;
}

function readPositiveInteger(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 36) {
    throw new Error(`${name} 1-36 arasında pozitif tam sayı olmalı.`);
  }
  return parsed;
}

function buildPartitionPlan(month, count) {
  return Array.from({ length: count }, (_, index) => {
    const fromMonth = addMonths(month, index);
    const toMonth = addMonths(month, index + 1);
    const name = `AuditLog_${fromMonth.replace("-", "_")}`;
    return {
      name,
      from: `${fromMonth}-01`,
      to: `${toMonth}-01`,
      sql: `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "AuditLog"\n  FOR VALUES FROM ('${fromMonth}-01') TO ('${toMonth}-01');`,
    };
  });
}

function addMonths(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  return formatMonth(new Date(Date.UTC(year, monthIndex - 1 + offset, 1)));
}

function formatMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function applyPartitions(partitionPlan) {
  const connectionString = process.env.DIRECT_DATABASE_URL;
  if (!connectionString) {
    throw new Error("AUDIT_LOG_PARTITION_APPLY=1 için DIRECT_DATABASE_URL gerekli.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await requireAuditLogPartitionedTable(client);
    for (const partition of partitionPlan) {
      await client.query(partition.sql);
      await requirePartitionExists(client, partition.name);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function requireAuditLogPartitionedTable(client) {
  const result = await client.query(
    `SELECT pt.partstrat
     FROM pg_partitioned_table pt
     JOIN pg_class c ON c.oid = pt.partrelid
     WHERE c.relname = 'AuditLog'`,
  );
  if (result.rowCount !== 1 || result.rows[0]?.partstrat !== "r") {
    throw new Error("AuditLog RANGE partitioned tablo olmalı.");
  }
}

async function requirePartitionExists(client, name) {
  const result = await client.query("SELECT 1 FROM pg_class WHERE relname = $1", [name]);
  if (result.rowCount !== 1) {
    throw new Error(`${name} partition oluşturulamadı.`);
  }
}

async function writeEvidence(filePath, payload) {
  if (!filePath) return;
  const resolvedPath = resolve(filePath);
  await validateEvidenceOutputPath(resolvedPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await assertParentDirectoryAllowed(dirname(resolvedPath));
  await assertExistingFileArtifact(resolvedPath);
  await writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await assertExistingFileArtifact(resolvedPath);
}

async function validateEvidenceOutputPath(filePath) {
  if (isLocalTempPath(filePath)) {
    throw new Error("AUDIT_LOG_PARTITION_EVIDENCE_FILE lokal temp path olmamalı.");
  }

  await assertParentPathAllowed(dirname(filePath));
  await assertExistingFileArtifact(filePath);
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("AUDIT_LOG_PARTITION_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.");
    }
  }
}

async function assertParentDirectoryAllowed(parentPath) {
  const stat = await lstat(parentPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("AUDIT_LOG_PARTITION_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.");
  }
}

async function assertExistingFileArtifact(filePath) {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("AUDIT_LOG_PARTITION_EVIDENCE_FILE symlink olmayan file artifact olmalı.");
  }
}

function isLocalTempPath(filePath) {
  return filePath === "/tmp" || filePath.startsWith("/tmp/") || filePath === "/var/tmp" || filePath.startsWith("/var/tmp/");
}
