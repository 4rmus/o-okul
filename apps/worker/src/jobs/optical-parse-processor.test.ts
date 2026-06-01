import { describe, expect, it } from "vitest";
import { createJobId, type QueueJob } from "../queue/queues.js";
import { createOpticalParseProcessor, type OpticalParseWorkflowRunner } from "./optical-parse-processor.js";

describe("optical parse processor composition", () => {
  it("excel-import job'unu OpticalParseWorkflow girdisine bağlar", async () => {
    const calls: Array<{ tenantId: string; rawImportId: string }> = [];
    const workflow: OpticalParseWorkflowRunner = {
      async process(input) {
        calls.push(input);
        return {
          tenantId: input.tenantId,
          rawImportId: input.rawImportId,
          s3Key: "raw/import/a.dat",
          matchedRows: 2,
          unmatchedRows: 1,
          matchedSaved: 2,
          unmatchedSaved: 1,
        };
      },
    };
    const processor = createOpticalParseProcessor({ workflow });

    const result = await processor(createExcelImportJob());

    expect(calls).toEqual([{ tenantId: "tenant-a", rawImportId: "raw-import-a" }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      importId: "raw-import-a",
      contentHash: "hash-a",
      processedRows: 3,
      errorRows: 1,
      status: "completed",
    });
  });

  it("excel-import dışı job adını workflow'a gitmeden reddeder", async () => {
    let workflowCalled = false;
    const processor = createOpticalParseProcessor({
      workflow: {
        async process() {
          workflowCalled = true;
          throw new Error("SHOULD_NOT_RUN");
        },
      },
    });

    await expect(processor({ ...createExcelImportJob(), name: "report-generation" }))
      .rejects.toThrow("EXCEL_IMPORT_JOB_NAME_INVALID");
    expect(workflowCalled).toBe(false);
  });

  it("workflow hatasını saklamaz", async () => {
    const processor = createOpticalParseProcessor({
      workflow: {
        async process() {
          throw new Error("OPTICAL_PARSE_INPUT_NOT_FOUND");
        },
      },
    });

    await expect(processor(createExcelImportJob()))
      .rejects.toThrow("OPTICAL_PARSE_INPUT_NOT_FOUND");
  });
});

function createExcelImportJob(): QueueJob {
  return {
    id: createJobId("raw-import-a", "hash-a"),
    name: "excel-import",
    payload: {
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "raw-import-a",
      contentHash: "hash-a",
    },
  };
}
