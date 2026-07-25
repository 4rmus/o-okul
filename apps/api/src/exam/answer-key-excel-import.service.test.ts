import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { AnswerKeyRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import type { LearningOutcomeRecord, LearningOutcomeStore } from "../school/learning-outcome-store.js";
import { AnswerKeyExcelImportService } from "./answer-key-excel-import.service.js";
import { AnswerKeyService, type AnswerKeyRepository, type SaveAnswerKeyInput } from "./answer-key.service.js";

const isemAnswerKeyPath = "../../ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx";
// ponytail: ornek-veriler is local-only; keep real fixture tests active only when present.
const itWithIsemAnswerKey = existsSync(isemAnswerKeyPath) ? it : it.skip;

describe("AnswerKeyExcelImportService", () => {
  itWithIsemAnswerKey("gerçek iSEM cevap anahtarı Excel dosyasından 90 soru ve B permütasyonu çıkarır", async () => {
    const repository = new FakeAnswerKeyRepository();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository));

    const result = await service.dryRun(createContext(), {
      examId: "exam-a",
      version: "v1",
      fileBase64: readFileSync(isemAnswerKeyPath).toString("base64"),
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
      { branch: "Din Kültürü", questionCount: 10 },
      { branch: "Fen Bilimleri", questionCount: 20 },
      { branch: "İngilizce", questionCount: 10 },
      { branch: "Matematik", questionCount: 20 },
      { branch: "Sosyal Bilgiler", questionCount: 10 },
      { branch: "Türkçe", questionCount: 20 },
    ]);
  });

  itWithIsemAnswerKey("gerçek Excel importunda AnswerKey ve B variant kaydı üretir", async () => {
    const repository = new FakeAnswerKeyRepository();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository));

    const result = await service.import(createContext(), {
      examId: "exam-a",
      version: "v1",
      fileBase64: readFileSync(isemAnswerKeyPath).toString("base64"),
      scoringConfig: { wrongPenalty: 0.333333 },
    });

    expect(result.imported).toBe(true);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]?.questions[0]).toEqual({
      questionNo: 1,
      correctAnswer: "D",
      branch: "Türkçe",
      outcomeCode: "SÖZCÜKTE ANLAM",
      topic: "SÖZCÜKTE ANLAM",
    });
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation.slice(0, 5)).toEqual([20, 19, 18, 17, 16]);
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation).toHaveLength(90);
  });

  it("Ders ve yeni başlık adlarıyla cevap anahtarı import eder", async () => {
    const repository = new FakeAnswerKeyRepository();
    const learningOutcomes = new FakeLearningOutcomeStore();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository), learningOutcomes);

    const result = await service.import(createContext(), {
      examId: "exam-a",
      version: "v2",
      fileBase64: await createWorkbookWithLessonHeader(),
    });

    expect(result.imported).toBe(true);
    expect(repository.records[0]?.questions[0]).toEqual({
      questionNo: 1,
      correctAnswer: "A",
      branch: "Türkçe",
      outcomeCode: "K1",
      topic: "Sözcük",
    });
    expect(repository.records[0]?.questions[30]).toEqual({
      questionNo: 31,
      correctAnswer: "B",
      branch: "Matematik",
      outcomeCode: "K31",
      topic: "Sayılar",
    });
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation.slice(0, 3)).toEqual([1, 2, 3]);
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation.slice(30, 33)).toEqual([31, 32, 33]);
    expect(learningOutcomes.records).toHaveLength(90);
    expect(learningOutcomes.records[0]).toMatchObject({
      tenantId: "tenant-a",
      code: "K1",
      branch: "Türkçe",
      title: "Sözcük",
    });
    expect(learningOutcomes.records[30]).toMatchObject({
      tenantId: "tenant-a",
      code: "K31",
      branch: "Matematik",
      title: "Sayılar",
    });
    expect(learningOutcomes.records[60]).toMatchObject({
      tenantId: "tenant-a",
      code: "K61",
      branch: "Fen Bilimleri",
      title: "Madde",
    });
  });

  it("dry-run cevap anahtarı importunda kazanım tablosuna yazmaz", async () => {
    const repository = new FakeAnswerKeyRepository();
    const learningOutcomes = new FakeLearningOutcomeStore();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository), learningOutcomes);

    await service.dryRun(createContext(), {
      examId: "exam-a",
      version: "v2",
      fileBase64: await createWorkbookWithLessonHeader(),
    });

    expect(repository.records).toHaveLength(0);
    expect(learningOutcomes.records).toEqual([]);
  });

  it.each([
    {
      examType: "TYT",
      questionCount: 120,
      sections: [
        { branch: "Türkçe", count: 40 },
        { branch: "Sosyal Bilimler", count: 20 },
        { branch: "Temel Matematik", count: 40 },
        { branch: "Fen Bilimleri", count: 20 },
      ],
    },
    {
      examType: "AYT",
      questionCount: 160,
      sections: [
        { branch: "TDE-Sosyal-1", count: 40 },
        { branch: "Sosyal-2", count: 40 },
        { branch: "Matematik", count: 40 },
        { branch: "Fen Bilimleri", count: 40 },
      ],
    },
  ])("$examType sentetik workbook için $questionCount soru dry-run ve import eder", async ({
    examType,
    questionCount,
    sections,
  }) => {
    const repository = new FakeAnswerKeyRepository();
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(repository));
    const fileBase64 = await createPlaceholderWorkbook(sections);
    const input = {
      examId: `exam-${examType.toLowerCase()}`,
      version: "placeholder-v1",
      fileBase64,
    };

    const dryRun = await service.dryRun(createContext(), input);
    const imported = await service.import(createContext(), input);

    expect(dryRun).toMatchObject({
      questionCount,
      bookletVariants: [{ code: "B", questionCount }],
      wouldImport: true,
    });
    expect(dryRun.branches).toEqual(
      [...sections]
        .sort((left, right) => left.branch.localeCompare(right.branch))
        .map(({ branch, count }) => ({ branch, questionCount: count })),
    );
    expect(imported.answerKey.questionCount).toBe(questionCount);
    expect(repository.records[0]?.questions).toHaveLength(questionCount);
    expect(repository.records[0]?.bookletVariants?.[0]?.permutation).toEqual(
      sections.flatMap(({ count }, sectionIndex) => {
        const offset = sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.count, 0);
        return Array.from({ length: count }, (_unused, index) => offset + count - index);
      }),
    );
  });

  it.each([0, 100])("%i soru içeren workbook'u reddeder", async (questionCount) => {
    const service = new AnswerKeyExcelImportService(new AnswerKeyService(new FakeAnswerKeyRepository()));

    await expect(service.dryRun(createContext(), {
      examId: "exam-unsupported",
      version: "v1",
      fileBase64: await createPlaceholderWorkbook(questionCount ? [{ branch: "Lorem", count: questionCount }] : []),
    })).rejects.toThrow("ANSWER_KEY_IMPORT_QUESTION_COUNT_INVALID");
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

class FakeLearningOutcomeStore implements LearningOutcomeStore {
  records: LearningOutcomeRecord[] = [];

  async list(): Promise<LearningOutcomeRecord[]> {
    return this.records;
  }

  async findById(id: string): Promise<LearningOutcomeRecord | undefined> {
    return this.records.find((record) => record.id === id);
  }

  async create(input: Omit<LearningOutcomeRecord, "id">): Promise<LearningOutcomeRecord> {
    const record = { id: `learning-outcome-${this.records.length + 1}`, ...input };
    this.records.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<LearningOutcomeRecord, "code" | "branch" | "title" | "level">>,
  ): Promise<LearningOutcomeRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;
    Object.assign(record, input);
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<LearningOutcomeRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;
    record.deletedAt = deletedAt;
    return record;
  }
}

async function createWorkbookWithLessonHeader(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Cevap Anahtarı");
  worksheet.addRow(["Ders", "Branş", "Kazanım", "Konu", "Soru Numarası", "B Kitapçığı Karşılığı", "Cevap"]);
  const lessons = [
    { lesson: "Sözel", branch: "Türkçe", topic: "Sözcük", count: 30, answer: "A" },
    { lesson: "Sayısal", branch: "Matematik", topic: "Sayılar", count: 30, answer: "B" },
    { lesson: "Fen", branch: "Fen Bilimleri", topic: "Madde", count: 30, answer: "C" },
  ];
  let globalQuestionNo = 1;
  for (const lesson of lessons) {
    for (let localQuestionNo = 1; localQuestionNo <= lesson.count; localQuestionNo += 1) {
      worksheet.addRow([
        lesson.lesson,
        lesson.branch,
        `K${globalQuestionNo}`,
        lesson.topic,
        localQuestionNo,
        localQuestionNo,
        lesson.answer,
      ]);
      globalQuestionNo += 1;
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function createPlaceholderWorkbook(sections: Array<{ branch: string; count: number }>): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Lorem Ipsum");
  worksheet.addRow(["Bölüm", "Branş", "Kazanım", "Konu", "Soru Numarası", "B Kitapçığı Karşılığı", "Cevap"]);
  let globalQuestionNo = 1;
  for (const section of sections) {
    for (let localQuestionNo = 1; localQuestionNo <= section.count; localQuestionNo += 1) {
      worksheet.addRow([
        section.branch,
        section.branch,
        `LOREM-${globalQuestionNo}`,
        "Lorem ipsum",
        localQuestionNo,
        section.count - localQuestionNo + 1,
        ["A", "B", "C", "D", "E"][(globalQuestionNo - 1) % 5],
      ]);
      globalQuestionNo += 1;
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}
