import { createGuardianPaymentDueScanner } from "./jobs/guardian-payment-due-scanner.js";
import { createTenantFreshResetWorker } from "./jobs/tenant-fresh-reset-worker.js";
import { createLicenseExpiryPurgeCandidateReporter } from "./jobs/license-expiry-purge-candidates.js";
import {
  createAnnouncementDeliveryBullWorker,
  closeWorkerMutationPool,
  createBackupRestoreBullWorker,
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createReportPdfRenderBullWorker,
  createReportGenerationBullWorker,
  createRedisConnectionOptions,
  createSmsBatchBullWorker,
} from "./queue/bullmq-worker.js";
import { assertSecretDeliveryEncryptionConfig } from "@o-okul/db";
import { workerLogger } from "./observability/logging.js";
import { flushWorkerSentry, initWorkerSentry } from "./observability/sentry.js";
import {
  assertSecretDeliveryOutboxDatabaseConfig,
  createSecretDeliveryOutboxRunner,
} from "./jobs/secret-delivery-outbox.js";

initWorkerSentry();
assertSecretDeliveryEncryptionConfig();
assertSecretDeliveryOutboxDatabaseConfig();
const connection = createRedisConnectionOptions();
const workerOptions = process.env.QUEUE_PREFIX ? { prefix: process.env.QUEUE_PREFIX } : undefined;
const queueNames = [
  "secret-delivery-outbox",
  "announcement-delivery",
  "backup-restore",
  "exam-evaluation",
  "excel-import",
  "report-generation",
  "report-pdf-render",
  "sms-batch",
];
const resetWorker = createTenantFreshResetWorker(connection);
// Reports only; never deletes (DEC-20261005-03).
const purgeCandidateReporter = createLicenseExpiryPurgeCandidateReporter();
const workers = [
  ...(resetWorker ? [resetWorker] : []),
  ...(purgeCandidateReporter ? [purgeCandidateReporter] : []),
  createSecretDeliveryOutboxRunner(),
  // KV-8: business-hours payment due reminders, enqueued onto announcement-delivery.
  createGuardianPaymentDueScanner({ connection, prefix: process.env.QUEUE_PREFIX }),
  createAnnouncementDeliveryBullWorker({
    connection,
    workerOptions,
  }),
  createBackupRestoreBullWorker({
    connection,
    workerOptions,
  }),
  createExamEvaluationBullWorker({
    connection,
    workerOptions,
  }),
  createExcelImportBullWorker({
    connection,
    workerOptions,
  }),
  createReportGenerationBullWorker({
    connection,
    workerOptions,
  }),
  createReportPdfRenderBullWorker({
    connection,
    workerOptions,
  }),
  createSmsBatchBullWorker({
    connection,
    workerOptions,
  }),
];

workerLogger.info({ queueNames, workerCount: workers.length }, "workers_started");

async function shutdown(): Promise<void> {
  workerLogger.info({ workerCount: workers.length }, "workers_shutdown_started");
  await Promise.all(workers.map((worker) => worker.close()));
  await closeWorkerMutationPool();
  await flushWorkerSentry();
  workerLogger.info({ workerCount: workers.length }, "workers_shutdown_completed");
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
