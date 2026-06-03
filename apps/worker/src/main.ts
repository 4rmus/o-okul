import {
  createAnnouncementDeliveryBullWorker,
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createReportGenerationBullWorker,
  createRedisConnectionOptions,
  createSmsBatchBullWorker,
} from "./queue/bullmq-worker.js";

const connection = createRedisConnectionOptions();
const workerOptions = process.env.QUEUE_PREFIX ? { prefix: process.env.QUEUE_PREFIX } : undefined;
const workers = [
  createAnnouncementDeliveryBullWorker({
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
  createSmsBatchBullWorker({
    connection,
    workerOptions,
  }),
];

console.log("announcement-delivery, exam-evaluation, excel-import, report-generation and sms-batch workers started");

async function shutdown(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
