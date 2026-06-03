import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnswerKeyRecord } from "@uzman-hocam/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { AnswerKeyExcelImportService } from "./answer-key-excel-import.service.js";
import { AnswerKeyService, type AnswerKeyRepository, type SaveAnswerKeyInput } from "./answer-key.service.js";

describe("AnswerKeyExcelImportService", () => {
  it("gerçek iSEM cevap anahtarı Excel dosyasından 90 soru ve B permütasyonu çıkarır", async () => {
    const repository = new FakeAnswerKeyRepository();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository));

    const result = await service.dryRun(createContext(), {
      examId: "exam-a",
      version: "v1",
      fileBase64: readFileSync("../../ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx").toString("base64"),
      scoringConfig: { wrongPenalty: 0.333333 },
    });

    expect(repository.records).toHaveLength(0);
    expect(result).toMatchObject({
      dryRun: true,
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "v1",
      questionCount: 90,
      bookletVariants: [{ code: "B", questionCount: 90 }],
      wouldImport: true,
    });
    expect(result.branches).toEqual([
      { branch: "LGS DİN KÜLTÜRÜ VE AHLAK BİLGİSİ", questionCount: 10 },
      { branch: "LGS FEN BİLİMLERİ", questionCount: 20 },
      { branch: "LGS İNGİLİZCE", questionCount: 10 },
      { branch: "LGS MATEMATİK", questionCount: 20 },
      { branch: "LGS T.C. İNKILAP TARİHİ VE ATATÜRKÇÜLÜK", questionCount: 10 },
      { branch: "LGS TÜRKÇE", questionCount: 20 },
    ]);
  });

  it("gerçek Excel importunda AnswerKey ve B variant kaydı üretir", async () => {
    const repository = new FakeAnswerKeyRepository();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository));

    const result = await service.import(createContext(), {
      examId: "exam-a",
      version: "v1",
      fileBase64: readFileSync("../../ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx").toString("base64"),
      scoringConfig: { wrongPenalty: 0.333333 },
    });

    expect(result.imported).toBe(true);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.questions[0]).toEqual({
      questionNo: 1,
      correctAnswer: "D",
      branch: "LGS TÜRKÇE",
      outcomeCode: "SÖZCÜKTE ANLAM",
      topic: "SÖZCÜKTE ANLAM",
    });
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation.slice(0, 5)).toEqual([20, 19, 18, 17, 16]);
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation).toHaveLength(90);
  });
});

function createContext(): RequestContext {
  return {
    userId: "user-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

class FakeAnswerKeyRepository implements AnswerKeyRepository {
  records: SaveAnswerKeyInput[] = [];

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    this.records.push(input);
    return {
      id: "answer-key-a",
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      questionCount: input.questions.length,
      branches: [{ branch: input.questions[0]?.branch ?? "Genel", questionCount: input.questions.length }],
      scoringConfig: input.scoringConfig,
      status: "DRAFT",
      createdAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    };
  }

  async list(): Promise<AnswerKeyRecord[]> {
    return [];
  }

  async publish(): Promise<AnswerKeyRecord | undefined> {
    return undefined;
  }
}
