import { readFileSync } from "node:fs";

const compose = readFileSync("docker-compose.yml", "utf8");
const releaseCompose = readFileSync("docker-compose.release.yml", "utf8");
const rateLimitShardCompose = readFileSync("docker-compose.rate-limit-shard.yml", "utf8");
const observability = readFileSync("docker-compose.observability.yml", "utf8");
const externalMonitoring = readFileSync("docker-compose.external-monitoring.yml", "utf8");
const traefik = readFileSync("docker-compose.traefik.yml", "utf8");
const traefikIp = readFileSync("docker-compose.traefik-ip.yml", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const alloy = readFileSync("docker/alloy/config.alloy", "utf8");
const prometheus = readFileSync("docker/prometheus/prometheus.yml", "utf8");
const prometheusAlerts = readFileSync("docker/prometheus/rules/api-alerts.yml", "utf8");
const grafanaDatasources = readFileSync("docker/grafana/provisioning/datasources/datasources.yml", "utf8");
const grafanaDashboards = readFileSync("docker/grafana/provisioning/dashboards/dashboards.yml", "utf8");
const grafanaApiOverview = readFileSync("docker/grafana/dashboards/api-overview.json", "utf8");
const loki = readFileSync("docker/loki/local-config.yaml", "utf8");
const evidenceNginx = readFileSync("docker/evidence/nginx.conf", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const stagingDeployWorkflow = readFileSync(".github/workflows/staging-deploy.yml", "utf8");
const secretDeliveryWorkerBootstrap = readFileSync("docker/postgres/init/003_bootstrap_secret_delivery_worker_role.sh", "utf8");

const expectations = {
  "docker-compose.yml": [
    "postgres:",
    "redis:",
    "clamav:",
    "profiles: [\"av\"]",
    "clamav/clamav:stable",
    "CLAMD_STARTUP_TIMEOUT: ${CLAMD_STARTUP_TIMEOUT:-1800}",
    "clamav_data:",
    "minio:",
    "minio/minio:RELEASE.2025-09-07T16-13-09Z",
    "api:",
    "evidence:",
    "nginx:1.27-alpine",
    "EVIDENCE_HOST_PORT:-3300",
    "./artifacts/staging/reports:/usr/share/nginx/html:ro",
    "./docker/evidence/nginx.conf:/etc/nginx/conf.d/default.conf:ro",
    "http://127.0.0.1:8080/healthz",
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
    "SMS_ENABLED: ${SMS_ENABLED:-false}",
    "LOG_LEVEL: ${LOG_LEVEL:-info}",
    "LOG_ENABLED: ${LOG_ENABLED:-true}",
    "wal_level=${POSTGRES_WAL_LEVEL:-replica}",
    "archive_mode=${POSTGRES_ARCHIVE_MODE:-on}",
    "archive_command=${POSTGRES_ARCHIVE_COMMAND:-test ! -f /var/lib/postgresql/wal-archive/%f && cp %p /var/lib/postgresql/wal-archive/%f}",
    "postgres_wal_archive:/var/lib/postgresql/wal-archive",
    "postgres_wal_archive:",
    "OPENAPI_UI_ENABLED: ${OPENAPI_UI_ENABLED:-false}",
    "API_RATE_LIMIT_ENABLED: ${API_RATE_LIMIT_ENABLED:-true}",
    "API_RATE_LIMIT_STORE: ${API_RATE_LIMIT_STORE:-redis}",
    "LOGIN_ATTEMPT_LIMITER_STORE: ${LOGIN_ATTEMPT_LIMITER_STORE:-redis}",
    "API_RATE_LIMIT_WINDOW_MS: ${API_RATE_LIMIT_WINDOW_MS:-60000}",
    "API_RATE_LIMIT_MAX: ${API_RATE_LIMIT_MAX:-300}",
    "TRUSTED_PROXY_CIDRS: ${TRUSTED_PROXY_CIDRS:-${TRAEFIK_PROXY_IP:-172.31.255.2}/32}",
    "IDEMPOTENCY_STORE: ${IDEMPOTENCY_STORE:-postgres}",
    "ADMIN_MFA_MODE: ${ADMIN_MFA_MODE:-off}",
    "ADMIN_MFA_SECRET_ENCRYPTION_KEY: ${ADMIN_MFA_SECRET_ENCRYPTION_KEY:-}",
    "SECRET_DELIVERY_ENCRYPTION_KEY: ${SECRET_DELIVERY_ENCRYPTION_KEY:-}",
    "SECRET_DELIVERY_OUTBOX_DATABASE_URL: ${DOCKER_SECRET_DELIVERY_OUTBOX_DATABASE_URL:-}",
    "SECRET_DELIVERY_WORKER_DB_PASSWORD: ${SECRET_DELIVERY_WORKER_DB_PASSWORD:-}",
    "ADMIN_MFA_RECOVERY_HASH_KEY: ${ADMIN_MFA_RECOVERY_HASH_KEY:-}",
    "ADMIN_MFA_CHALLENGE_SECRET: ${ADMIN_MFA_CHALLENGE_SECRET:-}",
    "ADMIN_MFA_ISSUER: ${ADMIN_MFA_ISSUER:-o-okul}",
    "SUPPORT_ATTACHMENT_STORAGE: ${SUPPORT_ATTACHMENT_STORAGE:-s3}",
    "HOMEWORK_MATERIAL_FILE_STORAGE: ${HOMEWORK_MATERIAL_FILE_STORAGE:-s3}",
    "SENTRY_DSN: ${SENTRY_DSN:-}",
    "SENTRY_SEND_DEFAULT_PII: ${SENTRY_SEND_DEFAULT_PII:-false}",
    "UPLOAD_AV_SCANNER: ${UPLOAD_AV_SCANNER:-disabled}",
    "CLAMAV_HOST: ${CLAMAV_HOST:-clamav}",
    "CLAMAV_PORT: ${CLAMAV_PORT:-3310}",
    "CLAMAV_TIMEOUT_MS: ${CLAMAV_TIMEOUT_MS:-5000}",
    "cpus: ${API_CPUS:-1.00}",
    "mem_limit: ${WORKER_MEM_LIMIT:-2g}",
    "NODE_OPTIONS: ${WORKER_NODE_OPTIONS:---max-old-space-size=1536}",
    "--maxmemory",
    "frontend_net:",
    "proxy_net:",
    "internal: true",
    "subnet: ${DOCKER_PROXY_SUBNET:-172.31.255.0/29}",
    "ipv4_address: ${API_PROXY_IP:-172.31.255.3}",
    "backend_net:",
    "healthcheck:",
    "condition: service_healthy",
  ],
  "docker-compose.traefik.yml": [
    "traefik:",
    "traefik:v3.7.5",
    "--entrypoints.web.address=:80",
    "--entrypoints.websecure.address=:443",
    "--entrypoints.web.forwardedheaders.insecure=false",
    "--entrypoints.websecure.forwardedheaders.insecure=false",
    "--entrypoints.web.forwardedheaders.trustedips=${TRAEFIK_TRUSTED_FORWARDER_CIDRS:-127.0.0.1/32}",
    "ipv4_address: ${TRAEFIK_PROXY_IP:-172.31.255.2}",
    "--entrypoints.web.http.redirections.entrypoint.to=websecure",
    "--entrypoints.web.http.redirections.entrypoint.scheme=https",
    "--entrypoints.web.http.redirections.entrypoint.permanent=true",
    "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web",
    "web:",
    "traefik.http.routers.web.rule=Host(`${DOMAIN}`)",
    "traefik.http.routers.web.entrypoints=websecure",
    "traefik.http.routers.web.priority=10",
    "traefik.http.routers.web.service=web",
    "traefik.http.routers.web.tls.certresolver=letsencrypt",
    "traefik.http.routers.web.middlewares=web-security-headers",
    "traefik.http.middlewares.web-security-headers.headers.stsseconds=15552000",
    "traefik.http.middlewares.web-security-headers.headers.contenttypenosniff=true",
    "traefik.http.middlewares.web-security-headers.headers.framedeny=true",
    "traefik.http.middlewares.web-security-headers.headers.contentsecuritypolicy=",
    "traefik.http.services.web.loadbalancer.server.port=3001",
    "PathPrefix(`/health`)",
    "traefik.http.routers.api.entrypoints=websecure",
    "traefik.http.routers.api.priority=100",
    "traefik.http.routers.api.service=api",
    "traefik.http.routers.api.tls.certresolver=letsencrypt",
    "traefik.http.routers.api.middlewares=api-security-headers",
    "traefik.docker.network=${DOCKER_PROXY_NETWORK:-o-okul_proxy_net}",
    "traefik.http.middlewares.api-security-headers.headers.stsseconds=15552000",
    "traefik.http.middlewares.api-security-headers.headers.contenttypenosniff=true",
    "traefik.http.middlewares.api-security-headers.headers.framedeny=true",
    "traefik.http.middlewares.api-security-headers.headers.contentsecuritypolicy=",
    "traefik.http.services.api.loadbalancer.server.port=3100",
    "traefik.http.routers.evidence.rule=Host(`${DOMAIN}`) && PathPrefix(`/evidence`)",
    "traefik.http.routers.evidence.priority=110",
    "traefik.http.routers.evidence.middlewares=evidence-strip,evidence-security-headers",
    "traefik.http.middlewares.evidence-strip.stripprefix.prefixes=/evidence",
    "traefik.http.services.evidence.loadbalancer.server.port=8080",
  ],
  "docker-compose.traefik-ip.yml": [
    "traefik:v3.7.5",
    "--entrypoints.web.forwardedheaders.insecure=false",
    "--entrypoints.websecure.forwardedheaders.insecure=false",
    "--entrypoints.web.forwardedheaders.trustedips=${TRAEFIK_TRUSTED_FORWARDER_CIDRS:-127.0.0.1/32}",
    "ipv4_address: ${TRAEFIK_PROXY_IP:-172.31.255.2}",
    "traefik.http.routers.web-ip.rule=Host(`${SERVER_DOMAIN:-127.0.0.1}`)",
    "traefik.http.routers.web-ip.service=web-ip",
    "traefik.http.routers.web-ip.tls=true",
    "traefik.http.services.web-ip.loadbalancer.server.port=3001",
    "traefik.http.routers.api-ip.rule=Host(`${SERVER_DOMAIN:-127.0.0.1}`) && (PathPrefix(`/api`) || PathPrefix(`/health`))",
    "traefik.http.routers.api-ip.service=api-ip",
    "traefik.http.routers.api-ip.tls=true",
    "traefik.http.services.api-ip.loadbalancer.server.port=3100",
    "traefik.http.routers.evidence-ip.rule=Host(`${SERVER_DOMAIN:-127.0.0.1}`) && PathPrefix(`/evidence`)",
    "traefik.http.routers.evidence-ip.priority=110",
    "traefik.http.routers.evidence-ip.middlewares=evidence-ip-strip,evidence-ip-security-headers",
    "traefik.http.middlewares.evidence-ip-strip.stripprefix.prefixes=/evidence",
    "traefik.http.services.evidence-ip.loadbalancer.server.port=8080",
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
  "docker-compose.rate-limit-shard.yml": [
    "api-rate-limit-shard:",
    "service: api",
    "image: ${API_IMAGE:-o-okul-api}",
    "ports: !reset []",
    "ipv4_address: ${RATE_LIMIT_SMOKE_EGRESS_IP:-172.31.255.4}",
    "traefik.docker.network=${DOCKER_PROXY_NETWORK:-o-okul_proxy_net}",
    "traefik.http.routers.api-rate-limit-shard-ip.rule=Host(`${SERVER_DOMAIN:-127.0.0.1}`) && PathPrefix(`/__rate-limit-shard`)",
    "traefik.http.routers.api-rate-limit-shard-ip.service=api-rate-limit-shard-ip",
    "traefik.http.routers.api-rate-limit-shard-ip.middlewares=api-rate-limit-shard-strip,api-rate-limit-shard-security-headers",
    "traefik.http.middlewares.api-rate-limit-shard-strip.stripprefix.prefixes=/__rate-limit-shard",
    "traefik.http.services.api-rate-limit-shard-ip.loadbalancer.server.port=3100",
  ],
  "docker-compose.observability.yml": [
    "prometheus:",
    "grafana:",
    "loki:",
    "alloy:",
    "127.0.0.1:${PROMETHEUS_HOST_PORT:-9090}:9090",
    "127.0.0.1:${GRAFANA_HOST_PORT:-3002}:3000",
    "127.0.0.1:${LOKI_HOST_PORT:-3101}:3100",
    "127.0.0.1:${ALLOY_HOST_PORT:-12345}:12345",
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
    "stack\" = \"o-okul",
  ],
  "docker/prometheus/prometheus.yml": [
    "rule_files:",
    "/etc/prometheus/rules/*.yml",
    "job_name: o-okul-api",
    "metrics_path: /metrics",
    "api:3100",
  ],
  "docker/prometheus/rules/api-alerts.yml": [
    "OOkulApiDown",
    "OOkulApiHighErrorRate",
    "OOkulApiSlowRequests",
    "OOkulReadinessFailing",
    "OOkulQueueFailedJobs",
    "o_okul_queue_jobs",
  ],
  "docker/grafana/provisioning/datasources/datasources.yml": [
    "uid: Prometheus",
    "uid: Loki",
    "http://prometheus:9090",
    "http://loki:3100",
  ],
  "docker/grafana/provisioning/dashboards/dashboards.yml": ["path: /var/lib/grafana/dashboards"],
  "docker/grafana/dashboards/api-overview.json": [
    "o-okul API Overview",
    "up{job=\\\"o-okul-api\\\"}",
    "o_okul_http_requests_total",
    "o_okul_http_request_duration_seconds_sum",
    "o_okul_queue_jobs",
    "o_okul_queue_metrics_scrape_error",
    "{stack=\\\"o-okul\\\"}",
  ],
  "docker/loki/local-config.yaml": ["auth_enabled: false", "retention_period: 168h"],
  "docker/evidence/nginx.conf": [
    "listen 8080",
    "server_tokens off",
    "X-Content-Type-Options nosniff",
    "Cache-Control \"no-store\"",
    "location = /healthz",
    "application/json json",
    "try_files $uri =404",
  ],
  ".github/workflows/ci.yml": [
    "pnpm install",
    "pnpm --filter @o-okul/web exec playwright install --with-deps chromium",
    "pnpm run ci",
  ],
  ".github/workflows/staging-deploy.yml": [
    "workflow_dispatch:",
    "full_evidence:",
    "workflow_run:",
    "workflows:",
    "- CI",
    "github.event.workflow_run.conclusion == 'success'",
    "actions: read",
    "environment: staging",
    "Validate staging dispatch inputs and environment",
    "STAGING_NEXT_PUBLIC_API_URL must be an https:// URL.",
    "STAGING_DEPLOY_DIR must be /root/o-okul.",
    "validate_tag \"rollback_image_tag\"",
    "github-ci-evidence:",
    "needs: preflight",
    "Generate GitHub CI evidence before deploy",
    "Check staging evidence env before deploy",
    "pnpm install --frozen-lockfile",
    "docker build",
    "--target web",
    "--target api",
    "--target worker",
    "--target queue-board",
    "ghcr.io",
    "STAGING_SSH_PRIVATE_KEY",
    "--build-arg NEXT_PUBLIC_SMS_ENABLED=\"$NEXT_PUBLIC_SMS_ENABLED\"",
    "STAGING_DEPLOY_DIR",
    "Upload compose bundle",
    "docker-compose.observability.yml",
    "docker/evidence",
    "docker/postgres/init",
    "scripts",
    "003_bootstrap_secret_delivery_worker_role.sh",
    "scp -i ~/.ssh/staging_deploy_key",
    "GHCR_READ_TOKEN",
    "GHCR_READ_TOKEN: ${{ github.token }}",
    "docker-compose.release.yml",
    "QUEUE_BOARD_IMAGE",
    ".env.release.next",
    "--env-file \"$release_env_file\"",
    "prune_old_release_images",
    "require_disk_space_mb 2048",
    "timeout 20m docker compose",
    "cd packages/db && ./node_modules/.bin/prisma migrate deploy --config prisma.config.ts",
    "ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT=artifacts/staging/reports/account-management-preflight.json",
    "ACCOUNT_MANAGEMENT_BACKFILL_MODE=APPLY",
    "ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM=apply-pr4-backfill",
    "ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT=artifacts/staging/reports/account-management-backfill.json",
    "Run secret delivery outbox staging smoke",
    "mv \"$release_env_file\" .env.release",
    "require_running_image web \"${IMAGE_PREFIX}/web:${IMAGE_TAG}\"",
    "require_running_image api \"${IMAGE_PREFIX}/api:${IMAGE_TAG}\"",
    "require_running_image worker \"${IMAGE_PREFIX}/worker:${IMAGE_TAG}\"",
    "require_running_image queue-board \"${IMAGE_PREFIX}/queue-board:${IMAGE_TAG}\"",
    "STAGING_EVIDENCE_ENV_B64",
    "test -s .staging-evidence.env",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "pnpm staging:evidence-env:check -- --env-file .staging-evidence.env",
    "pnpm staging:evidence-env:check",
    "pnpm github-ci:generate",
    "pnpm github-ci:check",
    "actions/download-artifact@v4",
    "staging-github-ci-evidence-${{ needs.build-images.outputs.deploy-sha }}",
    "Check pre-deploy GitHub CI evidence",
    "Open staging data tunnels",
    "ExitOnForwardFailure=yes",
    "scripts/append-staging-evidence-tunnel-env.mjs",
    "GITHUB_CI_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/github-ci.json",
    ".ghcr_read_token",
    "GHCR read token file is missing.",
    "if: ${{ github.event_name == 'workflow_dispatch' && inputs.full_evidence == true }}",
    "pnpm prod:evidence:check",
    "--summary-file",
    "Check staging release artifact bundle",
    "STAGING_RELEASE_ARTIFACTS_TARGET=\"$PWD/artifacts/staging\"",
    "pnpm staging:release-artifacts:check",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "actions/upload-artifact@v4",
    "UI_UX_REDESIGN_VERIFY_REMOTE_REFERENCES: \"1\"",
    "staging-activation-evidence-${{ needs.build-images.outputs.image-tag }}",
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
  "docker/postgres/init/003_bootstrap_secret_delivery_worker_role.sh": [
    "SECRET_DELIVERY_WORKER_DB_PASSWORD is required",
    "CREATE ROLE secret_delivery_worker LOGIN",
    "ALTER ROLE secret_delivery_worker PASSWORD",
    "GRANT CONNECT ON DATABASE",
  ],
};

const files = {
  "docker-compose.yml": compose,
  "docker-compose.release.yml": releaseCompose,
  "docker-compose.rate-limit-shard.yml": rateLimitShardCompose,
  "docker-compose.observability.yml": observability,
  "docker-compose.external-monitoring.yml": externalMonitoring,
  "docker-compose.traefik.yml": traefik,
  "docker-compose.traefik-ip.yml": traefikIp,
  "docker/alloy/config.alloy": alloy,
  "docker/prometheus/prometheus.yml": prometheus,
  "docker/prometheus/rules/api-alerts.yml": prometheusAlerts,
  "docker/grafana/provisioning/datasources/datasources.yml": grafanaDatasources,
  "docker/grafana/provisioning/dashboards/dashboards.yml": grafanaDashboards,
  "docker/grafana/dashboards/api-overview.json": grafanaApiOverview,
  "docker/loki/local-config.yaml": loki,
  "docker/evidence/nginx.conf": evidenceNginx,
  Dockerfile: dockerfile,
  ".github/workflows/ci.yml": workflow,
  ".github/workflows/staging-deploy.yml": stagingDeployWorkflow,
  "docker/postgres/init/003_bootstrap_secret_delivery_worker_role.sh": secretDeliveryWorkerBootstrap,
};

const failures = [];

for (const [file, tokens] of Object.entries(expectations)) {
  for (const token of tokens) {
    if (!files[file].includes(token)) {
      failures.push(`${file} eksik: ${token}`);
    }
  }
}

const dockerfileLines = dockerfile.split(/\r?\n/).map((line) => line.trim());
const buildWebStageIndex = dockerfileLines.indexOf("FROM deps AS build-web");
const buildApiStageIndex = dockerfileLines.indexOf("FROM deps AS build-api");
const webBuildIndex = dockerfileLines.indexOf("RUN pnpm turbo run build --filter=@o-okul/web...");
const tokenCopyIndexes = dockerfileLines.flatMap((line, index) =>
  line === "COPY tokens.css ./tokens.css" ? [index] : [],
);
if (
  tokenCopyIndexes.length !== 1 ||
  !(
    buildWebStageIndex < tokenCopyIndexes[0] &&
    tokenCopyIndexes[0] < webBuildIndex &&
    webBuildIndex < buildApiStageIndex
  )
) {
  failures.push("Dockerfile: tokens.css yalnız build-web aşamasında ve web build komutundan önce kopyalanmalı");
}

const queuePrefixOccurrences = compose.match(/QUEUE_PREFIX: \${QUEUE_PREFIX}/g)?.length ?? 0;
if (queuePrefixOccurrences < 2) {
  failures.push("docker-compose.yml eksik: api ve worker aynı QUEUE_PREFIX değerini almalı");
}

const studentPiiHashKeyOccurrences = compose.match(/STUDENT_PII_HASH_KEY: \${STUDENT_PII_HASH_KEY}/g)?.length ?? 0;
if (studentPiiHashKeyOccurrences < 2) {
  failures.push("docker-compose.yml eksik: STUDENT_PII_HASH_KEY api ve worker içinde olmalı");
}

if (stagingDeployWorkflow.includes("pnpm run ci")) {
  failures.push("staging-deploy workflow tam CI'yi tekrar çalıştırmamalı; workflow_run CI başarısı ve GitHub CI evidence kullanılmalı");
}

if (stagingDeployWorkflow.includes("playwright install --with-deps chromium")) {
  failures.push("staging-deploy workflow web Playwright bağımlılığı kurmamalı; bu yalnız CI workflow'unda kalmalı");
}

const logLevelOccurrences = compose.match(/LOG_LEVEL: \${LOG_LEVEL:-info}/g)?.length ?? 0;
if (logLevelOccurrences < 2) {
  failures.push("docker-compose.yml eksik: LOG_LEVEL api ve worker içinde olmalı");
}

const sentryDsnOccurrences = compose.match(/SENTRY_DSN: \${SENTRY_DSN:-}/g)?.length ?? 0;
if (sentryDsnOccurrences < 2) {
  failures.push("docker-compose.yml eksik: SENTRY_DSN api ve worker içinde olmalı");
}

const workerBlock = compose.match(/\n  worker:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|\nvolumes:|\nnetworks:|$)/)?.[1] ?? "";
if (workerBlock.includes("DIRECT_DATABASE_URL:")) {
  failures.push("docker-compose.yml worker migration DIRECT_DATABASE_URL almamalı");
}
if (!workerBlock.includes("SECRET_DELIVERY_OUTBOX_DATABASE_URL: ${DOCKER_SECRET_DELIVERY_OUTBOX_DATABASE_URL:-}")) {
  failures.push("docker-compose.yml worker dedicated SECRET_DELIVERY_OUTBOX_DATABASE_URL almalı");
}

if (failures.length > 0) {
  console.error("Docker/CI statik kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Docker/CI statik kontrolü geçti.");
