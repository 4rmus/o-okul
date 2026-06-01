import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import {
  parserConfigRepositoryToken,
  type ApprovedParserConfigInput,
  type ParserConfigRepository,
} from "./parser-config-approval.service.js";

describe("ParserConfigController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let repository: FakeParserConfigRepository;

  beforeAll(async () => {
    repository = new FakeParserConfigRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(parserConfigRepositoryToken)
      .useValue(repository)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    repository.inputs = [];
    repository.conflict = false;
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
        tenantId: "tenant-b",
        status: "DRAFT",
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
    expect(response.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      version: "parser-v1",
      encoding: "UTF-8",
      delimiter: "TAB",
      status: "APPROVED",
    });
  });

  it("TEACHER onay yazamaz", async () => {
    const issued = await login("teacher-a@example.test");

    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "parser-v1", suggestion: createSuggestion() })
      .expect(403);

    expect(repository.inputs).toHaveLength(0);
  });

  it("auth yoksa onay endpointini reddeder", async () => {
    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .send({ version: "parser-v1", suggestion: createSuggestion() })
      .expect(401);

    expect(repository.inputs).toHaveLength(0);
  });

  it("eksik suggestion DB'ye gitmeden 400 döner", async () => {
    const issued = await login("admin-a@example.test");

    await request(server)
      .post("/exams/exam-a/parser-configs/approvals")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ version: "parser-v1" })
      .expect(400);

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
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send({ email, password: "password" }).expect(200);
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
