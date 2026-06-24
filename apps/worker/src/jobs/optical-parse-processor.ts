import { createTenantPgPool, type TenantQueryable } from "@o-okul/db";
import { type QueueJob } from "../queue/queues.js";
import {
  type ExcelImportJobResult,
  processExcelImportJob,
} from "./excel-import-job.js";
import { OpticalParseWorkflow, type OpticalParseWorkflowResult } from "./optical-parse-workflow.js";
import { PostgresOpticalParseAdapter } from "./postgres-optical-parse-adapter.js";
import { PostgresOpticalParseInputAdapter } from "./postgres-optical-parse-input-adapter.js";
import {
  createS3RawImportContentReaderFromEnv,
} from "./s3-raw-import-content-reader.js";
import type { RawImportContentReader } from "./optical-parse-workflow.js";

export interface OpticalParseProcessorOptions {
  pool?: TenantQueryable;
  workflow?: OpticalParseWorkflowRunner;
  contentReader?: RawImportContentReader;
}

export interface OpticalParseWorkflowRunner {
  process(input: { tenantId: string; rawImportId: string }): Promise<OpticalParseWorkflowResult>;
}

export type OpticalParseProcessor = (
  job: QueueJob,
) => Promise<ExcelImportJobResult>;

export function createOpticalParseProcessor(
  options: OpticalParseProcessorOptions = {},
): OpticalParseProcessor {
  const workflow = options.workflow ?? createWorkflow(options);

  return (job) =>
    processExcelImportJob(job, {
      async process(input) {
        const result = await workflow.process({
          tenantId: input.tenantId,
          rawImportId: input.importId,
        });

        return toExcelImportResult(input, result);
      },
    });
}

function createWorkflow(options: OpticalParseProcessorOptions): OpticalParseWorkflowRunner {
  const pool = options.pool ?? createTenantPgPool();
  return new OpticalParseWorkflow(
    new PostgresOpticalParseInputAdapter(pool),
    options.contentReader ?? createS3RawImportContentReaderFromEnv(),
    new PostgresOpticalParseAdapter(pool),
  );
}

function toExcelImportResult(
  input: { tenantId: string; importId: string; contentHash: string },
  result: OpticalParseWorkflowResult,
): ExcelImportJobResult {
  return {
    tenantId: input.tenantId,
    importId: input.importId,
    contentHash: input.contentHash,
    processedRows: result.matchedRows + result.unmatchedRows,
    errorRows: result.unmatchedRows,
    status: "completed",
  };
}
