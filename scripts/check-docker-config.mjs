import { readFileSync } from "node:fs";

const compose = readFileSync("docker-compose.yml", "utf8");
const releaseCompose = readFileSync("docker-compose.release.yml", "utf8");
const observability = readFileSync("docker-compose.observability.yml", "utf8");
const externalMonitoring = readFileSync("docker-compose.external-monitoring.yml", "utf8");
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
const stagingDeployWorkflow = readFileSync(".github/workflows/staging-deploy.yml", "utf8");

const expectations = {
  "docker-compose.yml": [
    "postgres:",
    "redis:",
    "clamav:",
    "clamav/clamav:stable",
    "CLAMD_STARTUP_TIMEOUT: ${CLAMD_STARTUP_TIMEOUT:-1800}",
    "clamav_data:",
    "minio:",
    "api:",
    "worker:",
    "queue-board:",
    "target: queue-board",
    "QUEUE_BOARD_BASIC_AUTH_USER: ${QUEUE_BOARD_BASIC_AUTH_USER}",
    "QUEUE_BOARD_BASIC_AUTH_PASSWORD: ${QUEUE_BOARD_BASIC_AUTH_PASSWORD}",
    "QUEUE_BOARD_BASE_PATH: ${QUEUE_BOARD_BASE_PATH:-/admin/queues}",
    "127.0.0.1:${QUEUE_BOARD_HOST_PORT:-3200}:3200",
    "fetch('http://127.0.0.1:3200/health')",
    "REPORT_PDF_RENDERER: ${REPORT_PDF_RENDERER:-worker}",
    "QUEUE_METRICS_ENABLED: ${QUEUE_METRICS_ENABLED:-true}",
    "LOG_LEVEL: ${LOG_LEVEL:-info}",
    "LOG_ENABLED: ${LOG_ENABLED:-true}",
    "OPENAPI_UI_ENABLED: ${OPENAPI_UI_ENABLED:-false}",
    "API_RATE_LIMIT_ENABLED: ${API_RATE_LIMIT_ENABLED:-true}",
    "API_RATE_LIMIT_STORE: ${API_RATE_LIMIT_STORE:-redis}",
    "API_RATE_LIMIT_WINDOW_MS: ${API_RATE_LIMIT_WINDOW_MS:-60000}",
    "API_RATE_LIMIT_MAX: ${API_RATE_LIMIT_MAX:-300}",
    "IDEMPOTENCY_STORE: ${IDEMPOTENCY_STORE:-postgres}",
    "ADMIN_MFA_MODE: ${ADMIN_MFA_MODE:-off}",
    "ADMIN_MFA_SECRET_ENCRYPTION_KEY: ${ADMIN_MFA_SECRET_ENCRYPTION_KEY}",
    "ADMIN_MFA_RECOVERY_HASH_KEY: ${ADMIN_MFA_RECOVERY_HASH_KEY}",
    "ADMIN_MFA_CHALLENGE_SECRET: ${ADMIN_MFA_CHALLENGE_SECRET}",
    "ADMIN_MFA_ISSUER: ${ADMIN_MFA_ISSUER:-Uzman Hocam}",
    "AI_REPORT_SUMMARY_PROVIDER: ${AI_REPORT_SUMMARY_PROVIDER:-disabled}",
    "SUPPORT_ATTACHMENT_STORAGE: ${SUPPORT_ATTACHMENT_STORAGE:-s3}",
    "HOMEWORK_MATERIAL_FILE_STORAGE: ${HOMEWORK_MATERIAL_FILE_STORAGE:-s3}",
    "SENTRY_DSN: ${SENTRY_DSN:-}",
    "SENTRY_SEND_DEFAULT_PII: ${SENTRY_SEND_DEFAULT_PII:-false}",
    "UPLOAD_AV_SCANNER: ${UPLOAD_AV_SCANNER:-disabled}",
    "CLAMAV_HOST: ${CLAMAV_HOST:-clamav}",
    "CLAMAV_PORT: ${CLAMAV_PORT:-3310}",
    "CLAMAV_TIMEOUT_MS: ${CLAMAV_TIMEOUT_MS:-5000}",
    "clamav:\n        condition: service_healthy",
    "frontend_net:",
    "backend_net:",
    "healthcheck:",
    "condition: service_healthy",
  ],
  "docker-compose.traefik.yml": [
    "traefik:",
    "traefik:v3.7.5",
    "--entrypoints.web.address=:80",
    "--entrypoints.websecure.address=:443",
    "--entrypoints.web.http.redirections.entrypoint.to=websecure",
    "--entrypoints.web.http.redirections.entrypoint.scheme=https",
    "--entrypoints.web.http.redirections.entrypoint.permanent=true",
    "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
    "web:",
    "traefik.http.routers.web.rule=Host(`${DOMAIN}`)",
    "traefik.http.routers.web.entrypoints=websecure",
    "traefik.http.routers.web.priority=10",
    "traefik.http.routers.web.tls.certresolver=letsencrypt",
    "traefik.http.routers.web.middlewares=web-security-headers",
    "traefik.http.middlewares.web-security-headers.headers.stsseconds=15552000",
    "traefik.http.middlewares.web-security-headers.headers.contenttypenosniff=true",
    "traefik.http.middlewares.web-security-headers.headers.framedeny=true",
    "traefik.http.services.web.loadbalancer.server.port=3001",
    "PathPrefix(`/health`)",
    "traefik.http.routers.api.entrypoints=websecure",
    "traefik.http.routers.api.priority=100",
    "traefik.http.routers.api.tls.certresolver=letsencrypt",
    "traefik.http.routers.api.middlewares=api-security-headers",
    "traefik.http.middlewares.api-security-headers.headers.stsseconds=15552000",
    "traefik.http.middlewares.api-security-headers.headers.contenttypenosniff=true",
    "traefik.http.middlewares.api-security-headers.headers.framedeny=true",
    "traefik.http.services.api.loadbalancer.server.port=3100",
  ],
  "docker-compose.release.yml": [
    "web:",
    "api:",
    "worker:",
    "queue-board:",
    "image: ${WEB_IMAGE:?WEB_IMAGE is required}",
    "image: ${API_IMAGE:?API_IMAGE is required}",
    "image: ${WORKER_IMAGE:?WORKER_IMAGE is required}",
    "image: ${QUEUE_BOARD_IMAGE:?QUEUE_BOARD_IMAGE is required}",
    "pull_policy: always",
  ],
  "docker-compose.observability.yml": [
    "prometheus:",
    "grafana:",
    "loki:",
    "alloy:",
    "9090:9090",
    "3002:3000",
    "12345:12345",
    "./docker/prometheus/rules:/etc/prometheus/rules:ro",
    "./docker/alloy/config.alloy:/etc/alloy/config.alloy:ro",
    "/var/run/docker.sock:/var/run/docker.sock:ro",
    "./docker/grafana/dashboards:/var/lib/grafana/dashboards:ro",
  ],
  "docker-compose.external-monitoring.yml": [
    "uptime-kuma:",
    "louislam/uptime-kuma:1.23.16",
    "127.0.0.1:${UPTIME_KUMA_HOST_PORT:-3003}:3001",
    "uptime_kuma_data:/app/data",
    "healthcheck:",
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
    "UzmanHocamQueueFailedJobs",
    "uzman_hocam_queue_jobs",
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
    "uzman_hocam_queue_jobs",
    "uzman_hocam_queue_metrics_scrape_error",
    "{stack=\\\"uzman-hocam\\\"}",
  ],
  "docker/loki/local-config.yaml": ["auth_enabled: false", "retention_period: 168h"],
  ".github/workflows/ci.yml": [
    "pnpm install",
    "pnpm --filter @uzman-hocam/web exec playwright install --with-deps chromium",
    "pnpm run ci",
  ],
  ".github/workflows/staging-deploy.yml": [
    "workflow_dispatch:",
    "actions: read",
    "environment: staging",
    "Validate staging dispatch inputs and environment",
    "STAGING_NEXT_PUBLIC_API_URL must be an https:// URL.",
    "validate_tag \"rollback_image_tag\"",
    "github-ci-evidence:",
    "needs: preflight",
    "Generate GitHub CI evidence before deploy",
    "Check staging evidence env before deploy",
    "pnpm run ci",
    "pnpm install --frozen-lockfile",
    "pnpm --filter @uzman-hocam/web exec playwright install --with-deps chromium",
    "docker build",
    "--target web",
    "--target api",
    "--target worker",
    "--target queue-board",
    "ghcr.io",
    "STAGING_SSH_PRIVATE_KEY",
    "STAGING_DEPLOY_DIR",
    "Upload compose bundle",
    "docker/postgres/init",
    "scp -i ~/.ssh/staging_deploy_key",
    "GHCR_READ_TOKEN",
    "docker-compose.release.yml",
    "QUEUE_BOARD_IMAGE",
    "--env-file .env.release",
    "pnpm --filter @uzman-hocam/db db:migrate",
    "STAGING_EVIDENCE_ENV_B64",
    "test -s .staging-evidence.env",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "pnpm staging:evidence-env:check -- --env-file .staging-evidence.env",
    "pnpm staging:evidence-env:check",
    "pnpm github-ci:generate",
    "pnpm github-ci:check",
    "actions/download-artifact@v4",
    "staging-github-ci-evidence-${{ github.sha }}",
    "Check pre-deploy GitHub CI evidence",
    "GITHUB_CI_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/github-ci.json",
    ".ghcr_read_token",
    "GHCR read token file is missing.",
    "pnpm prod:evidence:check",
    "--summary-file",
    "Check staging release artifact bundle",
    "STAGING_RELEASE_ARTIFACTS_TARGET=\"$PWD/artifacts/staging\"",
    "pnpm staging:release-artifacts:check",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "actions/upload-artifact@v4",
    "staging-production-evidence-${{ needs.build-images.outputs.image-tag }}",
  ],
  Dockerfile: [
    "FROM node:24-alpine AS api",
    "FROM node:24-alpine AS worker",
    "FROM node:24-alpine AS queue-board",
    "apk add --no-cache chromium",
    "REPORT_PDF_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser",
    "CMD [\"node\", \"apps/worker/dist/main.js\"]",
    "CMD [\"node\", \"apps/queue-board/dist/main.js\"]",
  ],
};

const files = {
  "docker-compose.yml": compose,
  "docker-compose.release.yml": releaseCompose,
  "docker-compose.observability.yml": observability,
  "docker-compose.external-monitoring.yml": externalMonitoring,
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
  ".github/workflows/staging-deploy.yml": stagingDeployWorkflow,
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

const logLevelOccurrences = compose.match(/LOG_LEVEL: \${LOG_LEVEL:-info}/g)?.length ?? 0;
if (logLevelOccurrences < 2) {
  failures.push("docker-compose.yml eksik: LOG_LEVEL api ve worker içinde olmalı");
}

const sentryDsnOccurrences = compose.match(/SENTRY_DSN: \${SENTRY_DSN:-}/g)?.length ?? 0;
if (sentryDsnOccurrences < 2) {
  failures.push("docker-compose.yml eksik: SENTRY_DSN api ve worker içinde olmalı");
}

const aiReportSummaryProviderOccurrences = compose.match(/AI_REPORT_SUMMARY_PROVIDER: \${AI_REPORT_SUMMARY_PROVIDER:-disabled}/g)?.length ?? 0;
if (aiReportSummaryProviderOccurrences < 2) {
  failures.push("docker-compose.yml eksik: AI_REPORT_SUMMARY_PROVIDER api ve worker içinde olmalı");
}

if (failures.length > 0) {
  console.error("Docker/CI statik kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Docker/CI statik kontrolü geçti.");
