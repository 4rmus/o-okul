import { spawnSync } from "node:child_process";

const requiredServices = ["postgres", "redis", "minio"];

const result = spawnSync("docker", ["compose", "ps", "--format", "json"], {
  encoding: "utf8",
});

if (result.status !== 0) {
  fail("docker compose ps çalışmadı.");
}

const services = parseComposePs(result.stdout);
const failures = [];

for (const service of requiredServices) {
  const container = services.find((item) => item.Service === service);
  if (!container) {
    failures.push(`${service} container bulunamadı.`);
    continue;
  }
  if (container.State !== "running") {
    failures.push(`${service} state=${container.State}`);
  }
  if (container.Health !== "healthy") {
    failures.push(`${service} health=${container.Health || "unknown"}`);
  }
}

if (failures.length > 0) {
  fail(`Compose health smoke başarısız:\n- ${failures.join("\n- ")}`);
}

console.log(`Compose health smoke geçti: ${requiredServices.join(", ")} healthy.`);

function parseComposePs(output) {
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      fail("docker compose ps JSON çıktısı okunamadı.");
    }
  }
  return rows;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
