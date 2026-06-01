import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ParserConfigSuggestion } from "@uzman-hocam/shared-types";
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
