import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { testLoginBody } from "../test-auth.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OpticalFormTemplateRecord } from "@o-okul/shared-types";
import { AppModule } from "../app.module.js";
import {
  parserConfigRepositoryToken,
  type ParserConfigRepository,
  type SavedParserConfig,
} from "./parser-config-approval.service.js";
import {
  opticalFormTemplateStoreToken,
  type OpticalFormTemplateStore,
  type SaveOpticalFormTemplateInput,
} from "./optical-form-template-store.js";

describe("OpticalFormTemplateController", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let templates: FakeTemplateStore;
  let parserConfigs: FakeParserConfigRepository;

  beforeAll(async () => {
    templates = new FakeTemplateStore();
    parserConfigs = new FakeParserConfigRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(opticalFormTemplateStoreToken)
      .useValue(templates)
      .overrideProvider(parserConfigRepositoryToken)
      .useValue(parserConfigs)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  beforeEach(() => {
    templates.creates = [];
    parserConfigs.saves = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("TENANT_ADMIN optik form şablonu oluşturur ve sınava uygular", async () => {
    const issued = await login("admin-a@example.test");

    const createResponse = await request(server)
      .post("/optical-form-templates")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        name: "Muba LGS",
        version: "template-v1",
        suggestion: createSuggestion(),
      })
      .expect(201);

    expect(templates.creates).toEqual([{
      tenantId: "tenant-a",
      name: "Muba LGS",
      version: "template-v1",
      suggestion: createSuggestion(),
    }]);
    expect(createResponse.body).toMatchObject({
      id: "template-a",
      tenantId: "tenant-a",
      name: "Muba LGS",
      status: "APPROVED",
    });

    const applyResponse = await request(server)
      .post("/optical-form-templates/template-a/apply")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({ examId: "exam-a", version: "parser-v1" })
      .expect(201);

    expect(parserConfigs.saves).toEqual([{
      tenantId: "tenant-a",
      examId: "exam-a",
      templateId: "template-a",
      version: "parser-v1",
      suggestion: createSuggestion(),
    }]);
    expect(applyResponse.body).toMatchObject({
      tenantId: "tenant-a",
      examId: "exam-a",
      templateId: "template-a",
      version: "parser-v1",
      status: "APPROVED",
    });
  });

  it("TENANT_ADMIN optik form şablonu oluşturmayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "optical-form-template-create-idempotency-a";
    const body = {
      name: "Muba Idempotent",
      version: "template-v1",
      suggestion: createSuggestion(),
    };

    const first = await request(server)
      .post("/optical-form-templates")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/optical-form-templates")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/optical-form-templates")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, name: "Muba Farkli" })
      .expect(409);

    expect(templates.creates).toHaveLength(1);
  });

  it("TENANT_ADMIN optik form şablonunu sınava uygulamayı Idempotency-Key ile tekilleştirir", async () => {
    const issued = await login("admin-a@example.test");
    const key = "optical-form-template-apply-idempotency-a";
    const body = { examId: "exam-a", version: "parser-v1" };

    const first = await request(server)
      .post("/optical-form-templates/template-a/apply")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/optical-form-templates/template-a/apply")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/optical-form-templates/template-a/apply")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, version: "parser-v2" })
      .expect(409);

    expect(parserConfigs.saves).toHaveLength(1);
  });

  it("geçersiz optik form suggestion gövdesini 422 ile reddeder", async () => {
    const issued = await login("admin-a@example.test");

    const response = await request(server)
      .post("/optical-form-templates")
      .set("Authorization", `Bearer ${issued.accessToken}`)
      .send({
        name: "Muba LGS",
        version: "template-v1",
        suggestion: {
          ...createSuggestion(),
          fieldMapping: { studentNo: { kind: "delimited", column: 0 } },
        },
      })
      .expect(422);

    expect(response.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ path: "suggestion.fieldMapping.bookletType" }),
            expect.objectContaining({ path: "suggestion.fieldMapping.answers" }),
          ]),
        },
      },
    });
    expect(templates.creates).toHaveLength(0);
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }
});

function createSuggestion() {
  return {
    confidence: "high" as const,
    delimiter: "TAB" as const,
    encoding: "UTF-8" as const,
    fieldMapping: {
      answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 90 },
      bookletType: { kind: "delimited" as const, column: 1 },
      studentNo: { kind: "delimited" as const, column: 0 },
    },
    skipHeaderLines: 1,
    version: 1 as const,
    warnings: [],
  };
}

class FakeTemplateStore implements OpticalFormTemplateStore {
  creates: SaveOpticalFormTemplateInput[] = [];
  private readonly record: OpticalFormTemplateRecord = {
    id: "template-a",
    tenantId: "tenant-a",
    name: "Muba LGS",
    version: "template-v1",
    encoding: "UTF-8",
    delimiter: "TAB",
    skipHeaderLines: 1,
    fieldMapping: createSuggestion().fieldMapping,
    status: "APPROVED",
    createdAt: "2026-06-05T08:00:00.000Z",
    updatedAt: "2026-06-05T08:00:00.000Z",
  };

  async create(input: SaveOpticalFormTemplateInput): Promise<OpticalFormTemplateRecord> {
    this.creates.push(input);
    return { ...this.record, name: input.name, version: input.version };
  }

  async findById(tenantId: string, templateId: string): Promise<OpticalFormTemplateRecord | undefined> {
    return tenantId === "tenant-a" && templateId === "template-a" ? this.record : undefined;
  }

  async list(tenantId: string): Promise<OpticalFormTemplateRecord[]> {
    return tenantId === "tenant-a" ? [this.record] : [];
  }
}

class FakeParserConfigRepository implements ParserConfigRepository {
  saves: Parameters<ParserConfigRepository["saveApproved"]>[0][] = [];

  async saveApproved(input: Parameters<ParserConfigRepository["saveApproved"]>[0]): Promise<SavedParserConfig> {
    this.saves.push(input);
    return {
      tenantId: input.tenantId,
      examId: input.examId,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      version: input.version,
      encoding: input.suggestion.encoding,
      delimiter: input.suggestion.delimiter,
      skipHeaderLines: input.suggestion.skipHeaderLines,
      fieldMapping: input.suggestion.fieldMapping,
      status: "APPROVED",
    };
  }
}
