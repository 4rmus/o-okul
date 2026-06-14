import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

export const backupRestoreJobCreateBodySchema = z.object({
  confirmationText: requiredTrimmedString,
  operationType: z.enum(["BACKUP", "RESTORE_DRILL"]),
  reason: optionalTrimmedString,
  targetReference: requiredTrimmedString,
}).strict();

export type BackupRestoreJobCreateBody = z.infer<typeof backupRestoreJobCreateBodySchema>;
