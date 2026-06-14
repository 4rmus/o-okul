import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

export const notificationDeviceRegisterBodySchema = z.object({
  platform: optionalTrimmedString,
  provider: requiredTrimmedString,
  token: requiredTrimmedString,
}).strict();

export type NotificationDeviceRegisterBody = z.infer<typeof notificationDeviceRegisterBodySchema>;
