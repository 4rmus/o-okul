import { describe, expect, it } from "vitest";
import {
  OpticalParseWorkflow,
  type OpticalParseInputLoader,
  type OpticalParseResultSaver,
  type RawImportContentReader,
} from "./optical-parse-workflow.js";
import type { SaveOpticalParseResultInput } from "./postgres-optical-parse-adapter.js";
import type { OpticalParseInputBundle } from "./postgres-optical-parse-input-adapter.js";

describe("OpticalParseWorkflow", () => {
  it("DB input, raw content, parser ve save adapter zincirini çalıştırır", async () => {
    const bundle = createBundle();
    const loader: OpticalParseInputLoader = {
      async load(input) {
        expect(input).toEqual({ tenantId: "tenant-a", rawImportId: "raw-import-a" });
        return bundle;
      },
    };
    const reader: RawImportContentReader = {
      async read(input) {
        expect(input).toEqual({ s3Key: "raw/import/a.dat", fileName: "a.dat" });
        return [
          "ogrenci_no\tkitapcik\tcevaplar",
          "12345\tA\tABCDE",
          "99999\tA\tABCDE",
        ].join("\n");
      },
    };
    let savedInput: SaveOpticalParseResultInput | undefined;
    const saver: OpticalParseResultSaver = {
      async save(input) {
        savedInput = input;
        return {
          matchedSaved: input.result.matched.length,
          unmatchedSaved: input.result.unmatched.length,
        };
      },
    };
    const workflow = new OpticalParseWorkflow(loader, reader, saver);

    const result = await workflow.process({ tenantId: "tenant-a", rawImportId: "raw-import-a" });

    expect(savedInput).toMatchObject({
      tenantId: "tenant-a",
      result: {
        matched: [{ participantId: "participant-a", status: "MATCHED" }],
        unmatched: [{ reason: "STUDENT_NOT_FOUND" }],
      },
    });
    expect(result).toEqual({
      tenantId: "tenant-a",
      rawImportId: "raw-import-a",
      s3Key: "raw/import/a.dat",
      matchedRows: 1,
      unmatchedRows: 1,
      matchedSaved: 1,
      unmatchedSaved: 1,
    });
  });

  it("content reader hatasını saklamaz", async () => {
    let saveCalled = false;
    const workflow = new OpticalParseWorkflow(
      { async load() { return createBundle(); } },
      { async read() { throw new Error("RAW_IMPORT_CONTENT_NOT_FOUND"); } },
      { async save() { saveCalled = true; throw new Error("SAVE_SHOULD_NOT_RUN"); } },
    );

    await expect(workflow.process({ tenantId: "tenant-a", rawImportId: "raw-import-a" })).rejects.toThrow("RAW_IMPORT_CONTENT_NOT_FOUND");
    expect(saveCalled).toBe(false);
  });

  it("parser hata verirse save adapter çalışmaz", async () => {
    let saveCalled = false;
    const workflow = new OpticalParseWorkflow(
      { async load() { return createBundle(); } },
      { async read() { return "ogrenci_no\tkitapcik\tcevaplar"; } },
      { async save() { saveCalled = true; throw new Error("SAVE_SHOULD_NOT_RUN"); } },
    );

    await expect(workflow.process({ tenantId: "tenant-a", rawImportId: "raw-import-a" })).rejects.toThrow("OPTICAL_PARSE_DATA_LINE_MISSING");
    expect(saveCalled).toBe(false);
  });
});

function createBundle(): OpticalParseInputBundle {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    rawImportId: "raw-import-a",
    parserConfigVersion: "parser-v1",
    s3Key: "raw/import/a.dat",
    fileName: "a.dat",
    parserConfig: {
      delimiter: "TAB",
      skipHeaderLines: 1,
      fieldMapping: {
        studentNo: { kind: "delimited", column: 0 },
        bookletType: { kind: "delimited", column: 1 },
        answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
      },
    },
    participants: [{ participantId: "participant-a", studentNo: "12345", bookletType: "A" }],
  };
}
