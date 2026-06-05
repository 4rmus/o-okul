import { randomUUID } from "node:crypto";
import pg from "pg";
import type { OpticalFormTemplateRecord, ParserConfigSuggestion } from "@uzman-hocam/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export const opticalFormTemplateStoreToken = Symbol("OpticalFormTemplateStore");

export interface SaveOpticalFormTemplateInput {
  tenantId: string;
  name: string;
  version: string;
  suggestion: ParserConfigSuggestion;
}

export interface OpticalFormTemplateStore {
  create(input: SaveOpticalFormTemplateInput): Promise<OpticalFormTemplateRecord>;
  findById(tenantId: string, templateId: string): Promise<OpticalFormTemplateRecord | undefined>;
  list(tenantId: string): Promise<OpticalFormTemplateRecord[]>;
}

export class PostgresOpticalFormTemplateStore implements OpticalFormTemplateStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async create(input: SaveOpticalFormTemplateInput): Promise<OpticalFormTemplateRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<OpticalFormTemplateRow>(
        `INSERT INTO "OpticalFormTemplate" (
           "id",
           "tenantId",
           "name",
           "version",
           "encoding",
           "delimiter",
           "skipHeaderLines",
           "fieldMapping",
           "status",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'APPROVED', now())
         ON CONFLICT ("tenantId", "name") DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.name,
          input.version,
          input.suggestion.encoding,
          input.suggestion.delimiter,
          input.suggestion.skipHeaderLines,
          JSON.stringify(input.suggestion.fieldMapping),
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("OPTICAL_FORM_TEMPLATE_NAME_CONFLICT");
      }
      return toRecord(row);
    });
  }

  async findById(tenantId: string, templateId: string): Promise<OpticalFormTemplateRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<OpticalFormTemplateRow>(
        `SELECT *
         FROM "OpticalFormTemplate"
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, templateId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }

  async list(tenantId: string): Promise<OpticalFormTemplateRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<OpticalFormTemplateRow>(
        `SELECT *
         FROM "OpticalFormTemplate"
         WHERE "tenantId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "updatedAt" DESC, "name" ASC`,
        [tenantId],
      );
      return result.rows.map(toRecord);
    });
  }
}

export function createOpticalFormTemplateStore(): OpticalFormTemplateStore {
  return new PostgresOpticalFormTemplateStore();
}

interface OpticalFormTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  encoding: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: unknown;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toRecord(row: OpticalFormTemplateRow): OpticalFormTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    version: row.version,
    encoding: parseEncoding(row.encoding),
    delimiter: parseDelimiter(row.delimiter),
    skipHeaderLines: row.skipHeaderLines,
    fieldMapping: parseFieldMapping(row.fieldMapping),
    status: parseStatus(row.status),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function parseEncoding(value: string): "UTF-8" {
  if (value !== "UTF-8") {
    throw new Error("OPTICAL_FORM_TEMPLATE_ENCODING_INVALID");
  }
  return value;
}

function parseDelimiter(value: string): OpticalFormTemplateRecord["delimiter"] {
  if (value === "TAB" || value === "COMMA" || value === "PIPE" || value === "FIXED") {
    return value;
  }
  throw new Error("OPTICAL_FORM_TEMPLATE_DELIMITER_INVALID");
}

function parseStatus(value: string): OpticalFormTemplateRecord["status"] {
  if (value === "APPROVED" || value === "DRAFT") {
    return value;
  }
  throw new Error("OPTICAL_FORM_TEMPLATE_STATUS_INVALID");
}

function parseFieldMapping(value: unknown): ParserConfigSuggestion["fieldMapping"] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPTICAL_FORM_TEMPLATE_FIELD_MAPPING_INVALID");
  }
  return parsed as ParserConfigSuggestion["fieldMapping"];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
