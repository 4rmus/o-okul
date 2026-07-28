import {
  createNotificationAdapterFromEnv,
  type NotificationAdapter,
} from "@o-okul/notification-adapter";
import { createSmsAdapterFromEnv, type SmsAdapter } from "@o-okul/sms-adapter";

export interface PasswordResetDelivery {
  send(input: { email?: string; phone?: string; resetUrl: string }): Promise<boolean>;
}

export const passwordResetDeliveryToken = Symbol("PasswordResetDelivery");

export function createPasswordResetDelivery(
  env = process.env,
  notificationAdapter?: NotificationAdapter,
  smsAdapter?: SmsAdapter,
): PasswordResetDelivery {
  const email = env.NOTIFICATION_PROVIDER === "http"
    ? (notificationAdapter ?? createNotificationAdapterFromEnv(env))
    : undefined;
  const sms = env.SMS_ENABLED === "true" && env.SMS_PROVIDER === "netgsm"
    ? (smsAdapter ?? createSmsAdapterFromEnv(env))
    : undefined;

  return {
    async send(input) {
      if (input.email && email) {
        const [result] = await email.sendBatch([{
          channel: "EMAIL",
          to: input.email,
          subject: "O-Okul parola sıfırlama",
          body: `Parolanızı bir saat içinde yenilemek için bağlantıyı açın: ${input.resetUrl}`,
        }]);
        return result?.status === "sent";
      }
      if (input.phone && sms) {
        const [result] = await sms.sendBatch([{
          to: input.phone,
          body: `O-Okul parola sıfırlama bağlantınız (1 saat geçerli): ${input.resetUrl}`,
        }]);
        return result?.status === "sent";
      }
      return false;
    },
  };
}
