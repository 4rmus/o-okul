import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const messageTemplateChannelSchema = z.enum(["SMS"]);

export const messageTemplateCreateBodySchema = z.object({
  body: requiredTrimmedString,
  channel: messageTemplateChannelSchema.optional(),
  name: requiredTrimmedString,
  tenantId: optionalTrimmedString,
}).strict();

export const messageTemplateUpdateBodySchema = z.object({
  body: requiredTrimmedString.optional(),
  channel: messageTemplateChannelSchema.optional(),
  name: requiredTrimmedString.optional(),
}).strict();

export type MessageTemplateCreateBody = z.infer<typeof messageTemplateCreateBodySchema>;
export type MessageTemplateUpdateBody = z.infer<typeof messageTemplateUpdateBodySchema>;
