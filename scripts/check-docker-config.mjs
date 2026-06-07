import { readFileSync } from "node:fs";

const compose = readFileSync("docker-compose.yml", "utf8");
const observability = readFileSync("docker-compose.observability.yml", "utf8");
const traefik = readFileSync("docker-compose.traefik.yml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const alloy = readFileSync("docker/alloy/config.alloy", "utf8");
const prometheus = readFileSync("docker/prometheus/prometheus.yml", "utf8");
const prometheusAlerts = readFileSync("docker/prometheus/rules/api-alerts.yml", "utf8");
const grafanaDatasources = readFileSync("docker/grafana/provisioning/datasources/datasources.yml", "utf8");
const grafanaDashboards = readFileSync("docker/grafana/provisioning/dashboards/dashboards.yml", "utf8");
const grafanaApiOverview = readFileSync("docker/grafana/dashboards/api-overview.json", "utf8");
const loki = readFileSync("docker/loki/local-config.yaml", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

const expectations = {
  "docker-compose.yml": [
    "postgres:",
    "redis:",
    "minio:",
    "api:",
    "worker:",
    "frontend_net:",
    "backend_net:",
    "healthcheck:",
    "condition: service_healthy",
  ],
  "docker-compose.traefik.yml": [
    "traefik:",
    "traefik:v2.11",
    "--entrypoints.web.address=:80",
    "--entrypoints.websecure.address=:443",
    "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
    "PathPrefix(`/health`)",
    "traefik.http.routers.api.entrypoints=websecure",
    "traefik.http.routers.api.tls.certresolver=letsencrypt",
    "traefik.http.services.api.loadbalancer.server.port=3100",
  ],
  "docker-compose.observability.yml": [
    "prometheus:",
    "grafana:",
    "loki:",
    "alloy:",
    "9090:9090",
    "3001:3000",
    "12345:12345",
    "./docker/prometheus/rules:/etc/prometheus/rules:ro",
    "./docker/alloy/config.alloy:/etc/alloy/config.alloy:ro",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    "./docker/grafana/dashboards:/var/lib/grafana/dashboards:ro",
  ],
  "docker/alloy/config.alloy": [
    "discovery.docker",
    "loki.source.docker",
    "loki.write",
    "http://loki:3100/loki/api/v1/push",
    "stack\" = \"uzman-hocam",
  ],
  "docker/prometheus/prometheus.yml": [
    "rule_files:",
    "/etc/prometheus/rules/*.yml",
    "job_name: uzman-hocam-api",
    "metrics_path: /metrics",
    "api:3100",
  ],
  "docker/prometheus/rules/api-alerts.yml": [
    "UzmanHocamApiDown",
    "UzmanHocamApiHighErrorRate",
    "UzmanHocamApiSlowRequests",
    "UzmanHocamReadinessFailing",
  ],
  "docker/grafana/provisioning/datasources/datasources.yml": [
    "uid: Prometheus",
    "uid: Loki",
    "http://prometheus:9090",
    "http://loki:3100",
  ],
  "docker/grafana/provisioning/dashboards/dashboards.yml": ["path: /var/lib/grafana/dashboards"],
  "docker/grafana/dashboards/api-overview.json": [
    "Uzman Hocam API Overview",
    "up{job=\\\"uzman-hocam-api\\\"}",
    "uzman_hocam_http_requests_total",
    "uzman_hocam_http_request_duration_seconds_sum",
    "{stack=\\\"uzman-hocam\\\"}",
  ],
  "docker/loki/local-config.yaml": ["auth_enabled: false", "retention_period: 168h"],
  ".github/workflows/ci.yml": [
    "pnpm install",
    "pnpm docker:check",
    "pnpm ops:check",
    "pnpm report-listing:k6:check",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
    "pnpm db:rls:check",
  ],
  Dockerfile: [
    "FROM node:24-alpine AS api",
    "apk add --no-cache chromium",
    "REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser",
  ],
};

const files = {
  "docker-compose.yml": compose,
  "docker-compose.observability.yml": observability,
  "docker-compose.traefik.yml": traefik,
  "docker/alloy/config.alloy": alloy,
  "docker/prometheus/prometheus.yml": prometheus,
  "docker/prometheus/rules/api-alerts.yml": prometheusAlerts,
  "docker/grafana/provisioning/datasources/datasources.yml": grafanaDatasources,
  "docker/grafana/provisioning/dashboards/dashboards.yml": grafanaDashboards,
  "docker/grafana/dashboards/api-overview.json": grafanaApiOverview,
  "docker/loki/local-config.yaml": loki,
  Dockerfile: dockerfile,
  ".github/workflows/ci.yml": workflow,
};

const failures = [];

for (const [file, tokens] of Object.entries(expectations)) {
  for (const token of tokens) {
    if (!files[file].includes(token)) {
      failures.push(`${file} eksik: ${token}`);
    }
  }
}

const queuePrefixOccurrences = compose.match(/QUEUE_PREFIX: \${QUEUE_PREFIX}/g)?.length ?? 0;
if (queuePrefixOccurrences < 2) {
  failures.push("docker-compose.yml eksik: api ve worker aynı QUEUE_PREFIX değerini almalı");
}

const studentPiiHashKeyOccurrences = compose.match(/STUDENT_PII_HASH_KEY: \${STUDENT_PII_HASH_KEY}/g)?.length ?? 0;
if (studentPiiHashKeyOccurrences < 2) {
  failures.push("docker-compose.yml eksik: STUDENT_PII_HASH_KEY api ve worker içinde olmalı");
}

if (failures.length > 0) {
  console.error("Docker/CI statik kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Docker/CI statik kontrolü geçti.");
