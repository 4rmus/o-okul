import {
  createAnnouncementDeliveryBullWorker,
  createBackupRestoreBullWorker,
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createReportPdfRenderBullWorker,
  createReportGenerationBullWorker,
  createRedisConnectionOptions,
  createSmsBatchBullWorker,
} from "./queue/bullmq-worker.js";
import { workerLogger } from "./observability/logging.js";
import { flushWorkerSentry, initWorkerSentry } from "./observability/sentry.js";

initWorkerSentry();
const connection = createRedisConnectionOptions();
const workerOptions = process.env.QUEUE_PREFIX ? { prefix: process.env.QUEUE_PREFIX } : undefined;
const queueNames = [
  "announcement-delivery",
  "backup-restore",
  "exam-evaluation",
  "excel-import",
  "report-generation",
  "report-pdf-render",
  "sms-batch",
];
const workers = [
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
