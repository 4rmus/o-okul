import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const announcementAudienceSchema = z.enum(["SCHOOL", "TEACHERS", "STUDENTS", "GUARDIANS"]);
const announcementDeliveryChannelSchema = z.enum(["EMAIL", "PUSH"]);
const announcementDeliveryStatusSchema = z.enum(["completed", "failed"]);
const deliveryCountSchema = z.number().int().nonnegative();

export const announcementCreateBodySchema = z.object({
  audience: announcementAudienceSchema.optional(),
  body: requiredTrimmedString,
  campusId: optionalTrimmedString,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  tenantId: optionalTrimmedString,
  termId: optionalTrimmedString,
  title: requiredTrimmedString,
}).strict();

export const announcementDeliveryResultBodySchema = z.object({
  channel: announcementDeliveryChannelSchema,
  deliveredCount: deliveryCountSchema,
  failedCount: deliveryCountSchema,
  providerErrorCode: optionalTrimmedString,
  recipientCount: deliveryCountSchema,
  status: announcementDeliveryStatusSchema,
}).strict();

export const announcementDeliverySendBodySchema = z.object({
  channel: announcementDeliveryChannelSchema,
}).strict();

export type AnnouncementCreateBody = z.infer<typeof announcementCreateBodySchema>;
export type AnnouncementDeliveryResultBody = z.infer<typeof announcementDeliveryResultBodySchema>;
export type AnnouncementDeliverySendBody = z.infer<typeof announcementDeliverySendBodySchema>;
