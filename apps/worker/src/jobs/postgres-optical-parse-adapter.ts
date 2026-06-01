import { type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
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
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'MATCHED', now())
           ON CONFLICT ("tenantId", "rawImportId", "participantId", "parserConfigVersion")
           DO UPDATE SET
             "rowNumber" = EXCLUDED."rowNumber",
             "answers" = EXCLUDED."answers",
             "status" = 'MATCHED',
             "deletedAt" = NULL,
             "updatedAt" = now()
           RETURNING "id"`,
          [
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
      }

      for (const item of input.result.unmatched) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO "ImportQuarantine" (
             "tenantId",
             "examId",
             "rawImportId",
             "rowNumber",
             "rawRow",
             "reason",
             "status",
             "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'OPEN', now())
           ON CONFLICT ("tenantId", "rawImportId", "rowNumber")
           DO UPDATE SET
             "rawRow" = EXCLUDED."rawRow",
             "reason" = EXCLUDED."reason",
             "updatedAt" = now()
           WHERE "ImportQuarantine"."status" = 'OPEN'
           RETURNING "id"`,
          [
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
