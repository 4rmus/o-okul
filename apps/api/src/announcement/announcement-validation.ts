import { z } from "zod";
import type {
  AnnouncementCreateRequest,
  AnnouncementDeliveryResultRequest,
  AnnouncementDeliverySendRequest,
  AnnouncementRecipientPreviewRequest,
} from "@o-okul/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const announcementAudienceSchema = z.enum(["SCHOOL", "TEACHERS", "STUDENTS", "GUARDIANS"]);
const announcementPublishChannelSchema = z.literal("IN_APP");
const announcementDeliveryChannelSchema = z.enum(["EMAIL", "PUSH"]);
const announcementDeliveryStatusSchema = z.enum(["completed", "failed"]);
const deliveryCountSchema = z.number().int().nonnegative();

export const announcementCreateBodySchema = z.object({
  audience: announcementAudienceSchema.optional(),
  body: requiredTrimmedString,
  campusId: optionalTrimmedString,
  channel: announcementPublishChannelSchema,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  recipientPreviewToken: z.string().trim().min(1).max(4096),
  tenantId: optionalTrimmedString,
  termId: optionalTrimmedString,
  title: requiredTrimmedString,
}).strict();

export const announcementRecipientPreviewBodySchema = z.object({
  audience: announcementAudienceSchema.optional(),
  campusId: optionalTrimmedString,
  channel: announcementPublishChannelSchema,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  termId: optionalTrimmedString,
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

export type AnnouncementCreateBody = AnnouncementCreateRequest;
export type AnnouncementRecipientPreviewBody = AnnouncementRecipientPreviewRequest;
export type AnnouncementDeliveryResultBody = AnnouncementDeliveryResultRequest;
export type AnnouncementDeliverySendBody = AnnouncementDeliverySendRequest;
