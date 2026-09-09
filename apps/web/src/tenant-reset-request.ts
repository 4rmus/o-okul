import { z } from "zod";
export const institutionResetRequestSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), tenantId: z.string().min(1), requestedBy: z.string().min(1), requestedAt: z.string().datetime(), lifecycleVersion: z.number().int().nonnegative(),
  status: z.enum(["PENDING", "REVOKED", "ACCEPTED", "COMPLETED"]), operationId: z.string().regex(/^[a-f0-9]{32}$/).nullable(),
}).strict().refine((r) => ["ACCEPTED", "COMPLETED"].includes(r.status) ? r.operationId !== null : r.operationId === null);
export const institutionResetRequestStateSchema = z.object({ request: institutionResetRequestSchema.nullable() }).strict();
