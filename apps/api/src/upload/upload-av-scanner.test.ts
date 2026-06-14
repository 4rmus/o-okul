import { describe, expect, it } from "vitest";
import {
  ClamAvUploadAvScanner,
  NoopUploadAvScanner,
  createUploadAvScannerFromEnv,
} from "./upload-av-scanner.js";

describe("Upload AV scanner", () => {
  it("local ve test ortamlarında disabled scanner'a izin verir", async () => {
    const scanner = createUploadAvScannerFromEnv({ NODE_ENV: "test", UPLOAD_AV_SCANNER: "disabled" });

    expect(scanner).toBeInstanceOf(NoopUploadAvScanner);
    await expect(scanner.scan({
      surface: "support_ticket_attachment",
      tenantId: "tenant-a",
      fileName: "ekran.txt",
      contentType: "text/plain",
      body: Buffer.from("hello world"),
      sha256: "sha-a",
    })).resolves.toBeUndefined();
  });

  it("production ortamında scanner'ın kapatılmasını reddeder", () => {
    expect(() => createUploadAvScannerFromEnv({ NODE_ENV: "production", UPLOAD_AV_SCANNER: "disabled" })).toThrow(
      'UPLOAD_AV_SCANNER must be "clamav" in production.',
    );
  });

  it("clamav scanner seçimini üretir", () => {
    expect(createUploadAvScannerFromEnv({
      UPLOAD_AV_SCANNER: "clamav",
      CLAMAV_HOST: "clamav",
      CLAMAV_PORT: "3310",
      CLAMAV_TIMEOUT_MS: "5000",
    })).toBeInstanceOf(ClamAvUploadAvScanner);
  });
});
