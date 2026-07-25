import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import {
  parserConfigRepositoryToken,
  type ApprovedParserConfigInput,
  type ParserConfigRepository,
} from "./parser-config-approval.service.js";

describe("ParserConfigController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeParserConfigRepository;
  let snapshots: FakeReportSnapshotStore;

  beforeAll(async () => {
    repository = new FakeParserConfigRepository();
    snapshots = new FakeReportSnapshotStore();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(parserConfigRepositoryToken)
      .useValue(repository)
      .overrideProvider(reportSnapshotStoreToken)
      .useValue(snapshots)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.inputs = [];
    repository.conflict = false;
    snapshots.markStaleInputs = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN örnek metinden parser config önerisi alır ve DB'ye yazmaz", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        sampleText: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE",
      })
      .expect(201);

    expect(repository.inputs).toHaveLength(0);
    expect(snapshots.markStaleInputs).toEqual([]);
    expect(response.body).toMatchObject({
      examId: "exam-a",
      status: "suggested",
      suggestion: {
        delimiter: "TAB",
        skipHeaderLines: 1,
        confidence: "high",
        fieldMapping: {
          studentNo: { kind: "delimited", column: 0 },
          bookletType: { kind: "delimited", column: 1 },
          answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
        },
      },
    });
  });

  it("öneri endpointi base64 içeriği kabul eder", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        fileBase64: Buffer.from("12345|A|ABCDE\n67890|B|BBCDE").toString("base64"),
      })
      .expect(201);

    expect(response.body.suggestion.delimiter).toBe("PIPE");
    expect(repository.inputs).toHaveLength(0);
  });

  it("öneri endpointi OPTİK-7108 presetini örnek dosya istemeden kabul eder", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ preset: "OPTIK_7108_LGS" })
      .expect(201);

    expect(response.body).toMatchObject({
      examId: "exam-a",
      status: "suggested",
      suggestion: {
        delimiter: "FIXED",
        skipHeaderLines: 0,
        confidence: "high",
        fieldMapping: {
          nationalId: { kind: "fixed", start: 37, length: 11 },
          studentNo: { kind: "fixed", start: 11, length: 4 },
          bookletType: { kind: "fixed", start: 50, length: 1 },
          answers: { kind: "fixed", estimatedQuestionCount: 90 },
        },
      },
    });
    expect(repository.inputs).toHaveLength(0);
  });

  it.each([
    ["OPTIK_129_TYT", 120],
    ["OPTIK_129_AYT", 160],
    ["YANIT_TYT", 120],
    ["YANIT_AYT", 160],
    ["OPTIK_840_LGS", 90],
  ] as const)("öneri endpointi %s presetini örnek dosya istemeden kabul eder", async (preset, questionCount) => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ preset })
      .expect(201);

    expect(response.body.suggestion).toMatchObject({
      delimiter: "FIXED",
      confidence: "medium",
      warnings: ["REAL_TXT_DAT_FIXTURE_NOT_VERIFIED"],
      fieldMapping: {
        answers: { kind: "fixed", estimatedQuestionCount: questionCount },
      },
    });
    expect(repository.inputs).toHaveLength(0);
  });

  it("TEACHER öneri üretemez", async () => {
    const issued = await login("teacher-a@example.test");

    await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ sampleText: "12345|A|ABCDE" })
      .expect(403);

    expect(repository.inputs).toHaveLength(0);
  });

  it("auth yoksa öneri endpointini reddeder", async () => {
    await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .send({ sampleText: "12345|A|ABCDE" })
      .expect(401);

    expect(repository.inputs).toHaveLength(0);
  });

  it("örnek içerik olmadan öneri endpointi 400 döner", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/parser-configs/suggestions")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({})
      .expect(400);

    expect(repository.inputs).toHaveLength(0);
  });

  it("TENANT_ADMIN format önerisini onaylanmış ParserConfig kaydına bağlar", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        version: "parser-v1",
        suggestion: createSuggestion(),
      })
      .expect(201);

    expect(repository.inputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    }]);
    expect(snapshots.markStaleInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      reason: "parser_config.approved",
    }]);
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      encoding: "UTF-8",
      delimiter: "TAB",
      status: "APPROVED",
    });
  });

  it("TENANT_ADMIN parser config onayını Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "parser-config-approval-idempotency-a";
    const body = {
      version: "parser-v1",
      suggestion: createSuggestion(),
    };

    const first = await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, version: "parser-v2" })
      .expect(409);

    expect(repository.inputs).toHaveLength(1);
    expect(snapshots.markStaleInputs).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      reason: "parser_config.approved",
    }]);
  });

  it("TEACHER onay yazamaz", async () => {
    const issued = await login("teacher-a@example.test");

    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "parser-v1", suggestion: createSuggestion() })
      .expect(403);

    expect(repository.inputs).toHaveLength(0);
    expect(snapshots.markStaleInputs).toEqual([]);
  });

  it("auth yoksa onay endpointini reddeder", async () => {
    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .send({ version: "parser-v1", suggestion: createSuggestion() })
      .expect(401);

    expect(repository.inputs).toHaveLength(0);
  });

  it("eksik suggestion DB'ye gitmeden 422 alan hatası döner", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "parser-v1" })
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: {
          fields: [expect.objectContaining({ path: "suggestion" })],
        },
      },
    });
    expect(repository.inputs).toHaveLength(0);
  });

  it("version çakışmasını 409 döndürür", async () => {
    const issued = await login("admin-a@example.test");
    repository.conflict = true;

    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "parser-v1", suggestion: createSuggestion() })
      .expect(409);

    expect(repository.inputs).toHaveLength(1);
    expect(snapshots.markStaleInputs).toEqual([]);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }
});

function createSuggestion() {
  return {
    encoding: "UTF-8" as const,
    delimiter: "TAB" as const,
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited" as const, column: 0 },
      bookletType: { kind: "delimited" as const, column: 1 },
      answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 5 },
    },
    version: 1 as const,
    confidence: "high" as const,
    warnings: [],
  };
}

class FakeParserConfigRepository implements ParserConfigRepository {
  inputs: ApprovedParserConfigInput[] = [];
  conflict = false;

  async saveApproved(input: ApprovedParserConfigInput) {
    this.inputs.push(input);
    if (this.conflict) {
      throw new Error("PARSER_CONFIG_VERSION_CONFLICT");
    }
    return {
      tenantId: input.tenantId,
      examId: input.examId,
      version: input.version,
      encoding: input.suggestion.encoding,
      delimiter: input.suggestion.delimiter,
      skipHeaderLines: input.suggestion.skipHeaderLines,
      fieldMapping: input.suggestion.fieldMapping,
      status: "APPROVED" as const,
    };
  }
}

class FakeReportSnapshotStore implements ReportSnapshotStore {
  markStaleInputs: Array<{ tenantId: string; examId: string; reason: string }> = [];

  async listByExam() {
    return [];
  }

  async listByTenant() {
    return [];
  }

  async findById() {
    return undefined;
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string) {
    this.markStaleInputs.push({ tenantId, examId, reason });
    return 1;
  }
}
