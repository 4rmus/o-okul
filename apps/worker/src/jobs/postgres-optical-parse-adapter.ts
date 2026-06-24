import { randomUUID } from "node:crypto";
import { type TenantQueryable, withTenantDb } from "@o-okul/db";
import { type OpticalAnswerParseResult } from "./optical-answer-parser.js";

export interface SaveOpticalParseResultInput {
  tenantId: string;
  result: OpticalAnswerParseResult;
}

export interface SavedOpticalParseResult {
  matchedSaved: number;
  unmatchedSaved: number;
}

export class PostgresOpticalParseAdapter {
  constructor(private readonly pool: TenantQueryable) {}

  async save(input: SaveOpticalParseResultInput): Promise<SavedOpticalParseResult> {
    validateInput(input);

    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      let matchedSaved = 0;
      let unmatchedSaved = 0;

      for (const item of input.result.matched) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO "ParsedAnswer" (
             "id",
             "tenantId",
             "examId",
             "rawImportId",
             "participantId",
             "parserConfigVersion",
             "rowNumber",
             "answers",
             "status",
             "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'MATCHED', now())
           ON CONFLICT ("tenantId", "rawImportId", "participantId", "parserConfigVersion")
           DO UPDATE SET
             "rowNumber" = EXCLUDED."rowNumber",
             "answers" = EXCLUDED."answers",
             "status" = 'MATCHED',
             "deletedAt" = NULL,
             "updatedAt" = now()
           RETURNING "id"`,
          [
            randomUUID(),
            item.tenantId,
            item.examId,
            item.rawImportId,
            item.participantId,
            item.parserConfigVersion,
            item.rowNumber,
            JSON.stringify(item.answers),
          ],
        );
        matchedSaved += inserted.rows.length;
        if (item.bookletType) {
          await client.query(
            `UPDATE "ExamParticipant"
             SET "bookletType" = $3,
                 "updatedAt" = now()
             WHERE "tenantId" = $1
               AND "id" = $2
               AND ("bookletType" IS NULL OR btrim("bookletType") = '')
               AND "deletedAt" IS NULL`,
            [item.tenantId, item.participantId, item.bookletType],
          );
        }
        await client.query(
          `UPDATE "ImportQuarantine"
           SET "deletedAt" = now(),
               "updatedAt" = now()
           WHERE "tenantId" = $1
             AND "rawImportId" = $2
             AND "rowNumber" = $3
             AND "status" = 'OPEN'
             AND "deletedAt" IS NULL`,
          [item.tenantId, item.rawImportId, item.rowNumber],
        );
      }

      for (const item of input.result.unmatched) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO "ImportQuarantine" (
             "id",
             "tenantId",
             "examId",
             "rawImportId",
             "rowNumber",
             "rawRow",
             "reason",
             "status",
             "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'OPEN', now())
           ON CONFLICT ("tenantId", "rawImportId", "rowNumber")
           DO UPDATE SET
             "rawRow" = EXCLUDED."rawRow",
             "reason" = EXCLUDED."reason",
             "updatedAt" = now()
           WHERE "ImportQuarantine"."status" = 'OPEN'
           RETURNING "id"`,
          [
            randomUUID(),
            item.tenantId,
            item.examId,
            item.rawImportId,
            item.rowNumber,
            JSON.stringify(item.rawRow),
            item.reason,
          ],
        );
        unmatchedSaved += inserted.rows.length;
      }

      return { matchedSaved, unmatchedSaved };
    });
  }
}

function validateInput(input: SaveOpticalParseResultInput): void {
  if (!input.tenantId) {
    throw new Error("OPTICAL_PARSE_SAVE_INPUT_INVALID");
  }

  for (const item of [...input.result.matched, ...input.result.unmatched]) {
    if (item.tenantId !== input.tenantId) {
      throw new Error("OPTICAL_PARSE_SAVE_TENANT_MISMATCH");
    }
  }
}
