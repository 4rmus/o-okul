import { describe, expect, it, vi } from "vitest";
import { createPasswordResetDelivery } from "./password-reset-delivery.js";

describe("password reset delivery", () => {
  it("gerçek sağlayıcı yoksa fail-closed davranır", async () => {
    const delivery = createPasswordResetDelivery({
      NOTIFICATION_PROVIDER: "noop",
      SMS_ENABLED: "false",
    });

    await expect(delivery.send({
      email: "user@example.test",
      phone: "5551234567",
      resetUrl: "https://o-okul.com/parola-sifirla?token=secret",
    })).resolves.toBe(false);
  });

  it("http bildirim sağlayıcısıyla e-posta gönderir", async () => {
    const sendBatch = vi.fn(async () => [{
      channel: "EMAIL" as const,
      to: "user@example.test",
      status: "sent" as const,
    }]);
    const delivery = createPasswordResetDelivery(
      { NOTIFICATION_PROVIDER: "http" },
      { sendBatch },
    );

    await expect(delivery.send({
      email: "user@example.test",
      resetUrl: "https://o-okul.com/parola-sifirla?token=secret",
    })).resolves.toBe(true);
    expect(sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ channel: "EMAIL", to: "user@example.test" }),
    ]);
  });

  it("Netgsm aktifse telefon kanalını kullanır", async () => {
    const sendBatch = vi.fn(async () => [{
      to: "5551234567",
      status: "sent" as const,
    }]);
    const delivery = createPasswordResetDelivery(
      { SMS_ENABLED: "true", SMS_PROVIDER: "netgsm" },
      undefined,
      { sendBatch },
    );

    await expect(delivery.send({
      phone: "5551234567",
      resetUrl: "https://o-okul.com/parola-sifirla?token=secret",
    })).resolves.toBe(true);
    expect(sendBatch).toHaveBeenCalledWith([
      expect.objectContaining({ to: "5551234567" }),
    ]);
  });
});
