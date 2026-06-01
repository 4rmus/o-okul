import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob } from "../queue/queues.js";

export interface ExcelImportJobInput {
  tenantId: string;
  userId: string;
  jobId: string;
  importId: string;
  contentHash: string;
}

export interface ExcelImportJobResult {
  tenantId: string;
  importId: string;
  contentHash: string;
  processedRows: number;
  errorRows: number;
  status: "completed";
}

export interface ExcelImportJobAdapter {
  process(input: ExcelImportJobInput): Promise<ExcelImportJobResult> | ExcelImportJobResult;
}

export async function processExcelImportJob(
  job: QueueJob,
  adapter: ExcelImportJobAdapter,
): Promise<ExcelImportJobResult> {
  if (job.name !== "excel-import") {
    throw new Error("EXCEL_IMPORT_JOB_NAME_INVALID");
  }
  assertTenantJobPayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    () =>
      adapter.process({
        tenantId: job.payload.tenantId,
        userId: job.payload.userId,
        jobId: job.id,
        importId: job.payload.entityId,
        contentHash: job.payload.contentHash,
      }),
  );
}
