import { describe, expect, it } from "vitest";
import { TenantDbAccess } from "../db/tenant-db.js";
import { createJobId, type QueueJob } from "../queue/queues.js";
import { type ExcelImportJobAdapter, processExcelImportJob } from "./excel-import-job.js";

describe("excel-import worker job", () => {
  it("geçerli job adapter'ı tenant context içinde çağırır", async () => {
    const db = new TenantDbAccess();
    const adapter: ExcelImportJobAdapter = {
      process(input) {
        db.writeTenantEntity(input.importId, "excel-import");
        return {
          tenantId: input.tenantId,
          importId: input.importId,
          contentHash: input.contentHash,
          processedRows: 3,
          errorRows: 0,
          status: "completed",
        };
      },
    };

    const result = await processExcelImportJob(createExcelImportJob(), adapter);

    expect(result).toEqual({
      tenantId: "tenant-a",
      importId: "import-1",
      contentHash: "hash-1",
      processedRows: 3,
      errorRows: 0,
      status: "completed",
    });
    expect(db.writes).toEqual([{ tenantId: "tenant-a", entityId: "import-1", action: "excel-import" }]);
  });

  it("tenant payload eksikse adapter çağırmadan fail eder", async () => {
    const adapter = createCountingAdapter();
    const job = {
      ...createExcelImportJob(),
      payload: { entityId: "import-1", contentHash: "hash-1" },
    } as QueueJob;

    await expect(processExcelImportJob(job, adapter))
      .rejects.toThrow("TENANT_JOB_PAYLOAD_INVALID");
    expect(adapter.calls).toBe(0);
  });

  it("excel-import dışı job adını reddeder", async () => {
    const adapter = createCountingAdapter();
    const job = {
      ...createExcelImportJob(),
      name: "report-generation",
    } as QueueJob;

    await expect(processExcelImportJob(job, adapter))
      .rejects.toThrow("EXCEL_IMPORT_JOB_NAME_INVALID");
    expect(adapter.calls).toBe(0);
  });

  it("adapter hata verirse rollback davranışı için yazım yapmadan fail eder", async () => {
    const db = new TenantDbAccess();
    const adapter: ExcelImportJobAdapter = {
      process() {
        throw new Error("STUDENT_QUOTA_EXCEEDED");
      },
    };

    await expect(processExcelImportJob(createExcelImportJob(), adapter))
      .rejects.toThrow("STUDENT_QUOTA_EXCEEDED");
    expect(db.writes).toHaveLength(0);
  });
});

function createExcelImportJob(): QueueJob {
  return {
    id: createJobId("import-1", "hash-1"),
    name: "excel-import",
    payload: {
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "import-1",
      contentHash: "hash-1",
    },
  };
}

function createCountingAdapter(): ExcelImportJobAdapter & { calls: number } {
  return {
    calls: 0,
    process(input) {
      this.calls += 1;
      return {
        tenantId: input.tenantId,
        importId: input.importId,
        contentHash: input.contentHash,
        processedRows: 0,
        errorRows: 0,
        status: "completed",
      };
    },
  };
}
