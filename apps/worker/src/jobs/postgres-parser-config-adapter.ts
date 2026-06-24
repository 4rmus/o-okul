import { type TenantQueryable, withTenantDb } from "@o-okul/db";
import { randomUUID } from "node:crypto";
import { type ParserConfigSuggestion } from "./format-analyzer-service.js";

export interface ApprovedParserConfigInput {
  tenantId: string;
  examId: string;
  version: string;
  suggestion: ParserConfigSuggestion;
}

export interface SavedParserConfig {
  tenantId: string;
  examId: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: ParserConfigSuggestion["fieldMapping"];
  status: "APPROVED";
}

export class PostgresParserConfigAdapter {
  constructor(private readonly pool: TenantQueryable) {}

  async saveApproved(input: ApprovedParserConfigInput): Promise<SavedParserConfig> {
    validateApprovedParserConfigInput(input);

    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const inserted = await client.query<ParserConfigRow>(
        `INSERT INTO "ParserConfig" (
           "id",
           "tenantId",
           "examId",
           "version",
           "encoding",
           "delimiter",
           "skipHeaderLines",
           "fieldMapping",
           "status",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'APPROVED', now())
         ON CONFLICT ("tenantId", "examId", "version") DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.examId,
          input.version,
          input.suggestion.encoding,
          input.suggestion.delimiter,
          input.suggestion.skipHeaderLines,
          JSON.stringify(input.suggestion.fieldMapping),
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error("PARSER_CONFIG_VERSION_CONFLICT");
      }

      return toSavedParserConfig(row);
    });
  }
}

interface ParserConfigRow {
  tenantId: string;
  examId: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: unknown;
  status: string;
}

function validateApprovedParserConfigInput(input: ApprovedParserConfigInput): void {
  if (!input.tenantId || !input.examId || !input.version) {
    throw new Error("PARSER_CONFIG_APPROVAL_INPUT_INVALID");
  }
  if (
    !input.suggestion ||
    !input.suggestion.fieldMapping?.studentNo ||
    !input.suggestion.fieldMapping.bookletType ||
    !input.suggestion.fieldMapping.answers
  ) {
    throw new Error("PARSER_CONFIG_APPROVAL_INPUT_INVALID");
  }
}

function toSavedParserConfig(row: ParserConfigRow): SavedParserConfig {
  if (row.status !== "APPROVED") {
    throw new Error("PARSER_CONFIG_SAVE_INVALID");
  }

  return {
    tenantId: row.tenantId,
    examId: row.examId,
    version: row.version,
    encoding: row.encoding,
    delimiter: row.delimiter,
    skipHeaderLines: row.skipHeaderLines,
    fieldMapping: parseFieldMapping(row.fieldMapping),
    status: "APPROVED",
  };
}

function parseFieldMapping(value: unknown): ParserConfigSuggestion["fieldMapping"] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PARSER_CONFIG_FIELD_MAPPING_INVALID");
  }

  return parsed as ParserConfigSuggestion["fieldMapping"];
}
