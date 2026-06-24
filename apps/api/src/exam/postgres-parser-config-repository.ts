import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import pg from "pg";
import type { ParserConfigSuggestion, ParserDelimiter, ParserEncoding } from "@o-okul/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type {
  ApprovedParserConfigInput,
  ParserConfigRepository,
  SavedParserConfig,
} from "./parser-config-approval.service.js";

export class PostgresParserConfigRepository implements ParserConfigRepository {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async saveApproved(input: ApprovedParserConfigInput): Promise<SavedParserConfig> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<ParserConfigRow>(
        `INSERT INTO "ParserConfig" (
           "id",
           "tenantId",
           "examId",
           "templateId",
           "version",
           "encoding",
           "delimiter",
           "skipHeaderLines",
           "fieldMapping",
           "status",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'APPROVED', now())
         ON CONFLICT ("tenantId", "examId", "version") DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.examId,
          input.templateId ?? null,
          input.version,
          input.suggestion.encoding,
          input.suggestion.delimiter,
          input.suggestion.skipHeaderLines,
          JSON.stringify(input.suggestion.fieldMapping),
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        const existing = await client.query<ParserConfigRow>(
          `SELECT
             "tenantId",
             "examId",
             "templateId",
             "version",
             "encoding",
             "delimiter",
             "skipHeaderLines",
             "fieldMapping",
             "status"
           FROM "ParserConfig"
           WHERE "tenantId" = $1
             AND "examId" = $2
             AND "version" = $3
             AND "deletedAt" IS NULL
           LIMIT 1`,
          [input.tenantId, input.examId, input.version],
        );
        const existingRow = existing.rows[0];
        if (existingRow && matchesApprovedConfig(existingRow, input)) {
          return toSavedParserConfig(existingRow);
        }
        throw new Error("PARSER_CONFIG_VERSION_CONFLICT");
      }
      return toSavedParserConfig(row);
    });
  }
}

interface ParserConfigRow {
  tenantId: string;
  examId: string;
  templateId: string | null;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: unknown;
  status: string;
}

function toSavedParserConfig(row: ParserConfigRow): SavedParserConfig {
  if (row.status !== "APPROVED") {
    throw new Error("PARSER_CONFIG_SAVE_INVALID");
  }

  return {
    tenantId: row.tenantId,
    examId: row.examId,
    ...(row.templateId ? { templateId: row.templateId } : {}),
    version: row.version,
    encoding: parseEncoding(row.encoding),
    delimiter: parseDelimiter(row.delimiter),
    skipHeaderLines: row.skipHeaderLines,
    fieldMapping: parseFieldMapping(row.fieldMapping),
    status: "APPROVED",
  };
}

function parseEncoding(value: string): ParserEncoding {
  if (value === "UTF-8" || value === "ISO-8859-9" || value === "CP1254") {
    return value;
  }
  throw new Error("PARSER_CONFIG_ENCODING_INVALID");
}

function parseDelimiter(value: string): ParserDelimiter {
  if (value === "TAB" || value === "COMMA" || value === "PIPE" || value === "FIXED") {
    return value;
  }
  throw new Error("PARSER_CONFIG_DELIMITER_INVALID");
}

function matchesApprovedConfig(row: ParserConfigRow, input: ApprovedParserConfigInput): boolean {
  try {
    return (
      row.status === "APPROVED" &&
      row.templateId === (input.templateId ?? null) &&
      row.encoding === input.suggestion.encoding &&
      row.delimiter === input.suggestion.delimiter &&
      row.skipHeaderLines === input.suggestion.skipHeaderLines &&
      isDeepStrictEqual(parseFieldMapping(row.fieldMapping), input.suggestion.fieldMapping)
    );
  } catch {
    return false;
  }
}

function parseFieldMapping(value: unknown): ParserConfigSuggestion["fieldMapping"] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PARSER_CONFIG_FIELD_MAPPING_INVALID");
  }

  return parsed as ParserConfigSuggestion["fieldMapping"];
}
