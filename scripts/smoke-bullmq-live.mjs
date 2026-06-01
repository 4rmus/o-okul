import { setTimeout as delay } from "node:timers/promises";
import { Socket } from "node:net";
import { createBullTenantQueueProducer } from "../apps/api/dist/queue/bullmq-producer.js";
import {
  createExcelImportBullWorker,
  createExamEvaluationBullWorker,
  createRedisConnectionOptions,
} from "../apps/worker/dist/queue/bullmq-worker.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = createRedisConnectionOptions(redisUrl);
const prefix = process.env.QUEUE_PREFIX ?? `smoke-${Date.now()}`;

if (!(await canConnect(connection.host, connection.port))) {
  console.error(
    `BullMQ smoke çalışmadı: ${connection.host}:${connection.port} üzerinde Redis'e bağlanılamadı.`,
  );
  console.error("Önce Redis başlatın, sonra `pnpm queue:smoke` komutunu tekrar çalıştırın.");
  process.exit(1);
}

const processedJobs = new Map();
let resolveProcessedJobs;
const processed = new Promise((resolve) => {
  resolveProcessedJobs = resolve;
});

const producer = createBullTenantQueueProducer({ connection, prefix });
const workers = [
  createExamEvaluationBullWorker({
    connection,
    workerOptions: { prefix },
    processor: async (job) => {
      processedJobs.set(job.name, job);
      if (processedJobs.size === 2) resolveProcessedJobs();
      return createResult(job.payload.tenantId);
    },
  }),
  createExcelImportBullWorker({
    connection,
    workerOptions: { prefix },
    processor: async (job) => {
      processedJobs.set(job.name, job);
      if (processedJobs.size === 2) resolveProcessedJobs();
      return {
        tenantId: job.payload.tenantId,
        importId: job.payload.entityId,
        contentHash: job.payload.contentHash,
        processedRows: 0,
        errorRows: 0,
        status: "completed",
      };
    },
  }),
];

try {
  for (const worker of workers) {
    if (typeof worker.waitUntilReady === "function") {
      await worker.waitUntilReady();
    }
  }

  const examJobInput = {
    queueName: "exam-evaluation",
    tenantId: "tenant-smoke",
    userId: "user-smoke",
    entityId: `raw-import-${Date.now()}`,
    contentHash: "hash-smoke",
    participantId: "participant-smoke",
    rawImportId: "raw-import-smoke",
    answerKeyId: "answer-key-smoke",
  };
  const importJobInput = {
    queueName: "excel-import",
    tenantId: "tenant-smoke",
    userId: "user-smoke",
    entityId: `raw-import-${Date.now()}`,
    contentHash: "hash-smoke-import",
  };
  const producedExamJob = await producer.enqueue(examJobInput);
  const producedImportJob = await producer.enqueue(importJobInput);

  await Promise.race([
    processed,
    delay(5_000).then(() => {
      throw new Error("BULLMQ_SMOKE_TIMEOUT");
    }),
  ]);

  assertProcessedJob("exam-evaluation", producedExamJob, examJobInput);
  assertProcessedJob("excel-import", producedImportJob, importJobInput);

  console.log(
    `BullMQ live smoke passed: consumed exam-evaluation and excel-import with prefix ${prefix}`,
  );
} finally {
  await Promise.all(workers.map((worker) => worker.close()));
  await producer.close();
}

function assertProcessedJob(queueName, producedJob, jobInput) {
  const processedJob = processedJobs.get(queueName);
  if (!processedJob || processedJob.id !== producedJob.options.jobId) {
    throw new Error(`BULLMQ_SMOKE_${queueName}_JOB_ID_MISMATCH`);
  }
  if (processedJob.name !== queueName || processedJob.payload.tenantId !== jobInput.tenantId) {
    throw new Error(`BULLMQ_SMOKE_${queueName}_PAYLOAD_MISMATCH`);
  }
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function createResult(tenantId) {
  return {
    tenantId,
    examId: "exam-smoke",
    studentId: "student-smoke",
    participantId: "participant-smoke",
    rawImportId: "raw-import-smoke",
    answerKeyId: "answer-key-smoke",
    parserConfigVersion: "parser-smoke",
    answerKeyVersion: "answer-key-smoke-v1",
    engineVersion: "scoring-smoke",
    resultKey: "participant-smoke_answer-key-smoke-v1_parser-smoke_scoring-smoke",
    score: {
      total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
      branches: [{ branch: "Smoke", correct: 1, wrong: 0, blank: 0, net: 1 }],
      _meta: {
        answerKeyVersion: "answer-key-smoke-v1",
        engineVersion: "scoring-smoke",
        computedAt: new Date(0).toISOString(),
      },
    },
    status: "completed",
  };
}
