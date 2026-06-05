import { describe, expect, it } from "vitest";
import type { OpticalFormTemplateRecord } from "@uzman-hocam/shared-types";
import type { RequestContext } from "../context/request-context.js";
import type { ParserConfigRepository, SavedParserConfig } from "./parser-config-approval.service.js";
import type { OpticalFormTemplateStore, SaveOpticalFormTemplateInput } from "./optical-form-template-store.js";
import { OpticalFormTemplateService } from "./optical-form-template.service.js";

describe("OpticalFormTemplateService", () => {
  it("kurum optik form şablonunu kaydeder", async () => {
    const store = new FakeTemplateStore();
    const service = new OpticalFormTemplateService(store, new FakeParserConfigRepository());

    const result = await service.create(createContext(), {
      name: "Muba LGS",
      version: "template-v1",
      suggestion: createSuggestion(),
    });

    expect(store.creates).toEqual([
      {
        tenantId: "tenant-a",
        name: "Muba LGS",
        version: "template-v1",
        suggestion: createSuggestion(),
      },
    ]);
    expect(result).toMatchObject({
      id: "template-a",
      tenantId: "tenant-a",
      name: "Muba LGS",
      version: "template-v1",
      status: "APPROVED",
    });
  });

  it("şablonu seçili sınava ParserConfig olarak uygular", async () => {
    const store = new FakeTemplateStore();
    const parserConfigs = new FakeParserConfigRepository();
    const service = new OpticalFormTemplateService(store, parserConfigs);

    const result = await service.applyToExam(createContext(), {
      templateId: "template-a",
      examId: "exam-a",
      version: "parser-v2",
    });

    expect(parserConfigs.saves).toEqual([
      {
        tenantId: "tenant-a",
        examId: "exam-a",
        templateId: "template-a",
        version: "parser-v2",
        suggestion: createSuggestion(),
      },
    ]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      templateId: "template-a",
      version: "parser-v2",
      encoding: "UTF-8",
      delimiter: "TAB",
      skipHeaderLines: 1,
      fieldMapping: createSuggestion().fieldMapping,
      status: "APPROVED",
    });
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

function createSuggestion() {
  return {
    encoding: "UTF-8" as const,
    delimiter: "TAB" as const,
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited" as const, column: 0 },
      bookletType: { kind: "delimited" as const, column: 1 },
      answers: { kind: "delimited" as const, column: 2, estimatedQuestionCount: 90 },
    },
    version: 1 as const,
    confidence: "high" as const,
    warnings: [],
  };
}

class FakeTemplateStore implements OpticalFormTemplateStore {
  creates: SaveOpticalFormTemplateInput[] = [];
  record: OpticalFormTemplateRecord = {
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

  async findById(): Promise<OpticalFormTemplateRecord | undefined> {
    return this.record;
  }

  async list(): Promise<OpticalFormTemplateRecord[]> {
    return [this.record];
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
