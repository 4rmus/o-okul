import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { createConnection } from "node:net";

export type UploadAvSurface = "homework_material_file" | "support_ticket_attachment";

export interface UploadAvScanInput {
  surface: UploadAvSurface;
  tenantId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  sha256: string;
}

export interface UploadAvScanner {
  scan(input: UploadAvScanInput): Promise<void>;
}

export const uploadAvScannerToken = Symbol("UploadAvScanner");

const defaultClamAvHost = "127.0.0.1";
const defaultClamAvPort = 3310;
const defaultTimeoutMs = 5000;
const clamAvChunkSize = 64 * 1024;

export class NoopUploadAvScanner implements UploadAvScanner {
  async scan(): Promise<void> {}
}

export interface ClamAvUploadAvScannerOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

export class ClamAvUploadAvScanner implements UploadAvScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(options: ClamAvUploadAvScannerOptions) {
    this.host = options.host.trim() || defaultClamAvHost;
    this.port = options.port;
    this.timeoutMs = options.timeoutMs;
  }

  async scan(input: UploadAvScanInput): Promise<void> {
    await scanWithClamAv({
      body: input.body,
      host: this.host,
      port: this.port,
      timeoutMs: this.timeoutMs,
    });
  }
}

export function createUploadAvScannerFromEnv(env: Record<string, string | undefined> = process.env): UploadAvScanner {
  const mode = env.UPLOAD_AV_SCANNER?.trim() || (env.NODE_ENV === "production" ? "clamav" : "disabled");
  if (mode === "disabled") {
    if (env.NODE_ENV === "production") {
      throw new Error('UPLOAD_AV_SCANNER must be "clamav" in production.');
    }
    return new NoopUploadAvScanner();
  }
  if (mode === "clamav") {
    return new ClamAvUploadAvScanner({
      host: env.CLAMAV_HOST?.trim() || defaultClamAvHost,
      port: readPositiveInteger(env.CLAMAV_PORT, defaultClamAvPort, "CLAMAV_PORT"),
      timeoutMs: readPositiveInteger(env.CLAMAV_TIMEOUT_MS, defaultTimeoutMs, "CLAMAV_TIMEOUT_MS"),
    });
  }

  throw new Error("UPLOAD_AV_SCANNER_INVALID");
}

function scanWithClamAv(input: { body: Buffer; host: string; port: number; timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: input.host, port: input.port });
    let settled = false;
    let response = "";

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.setTimeout(input.timeoutMs);
    socket.once("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < input.body.length; offset += clamAvChunkSize) {
        const chunk = input.body.subarray(offset, offset + clamAvChunkSize);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("timeout", () => {
      settle(new ServiceUnavailableException("UPLOAD_AV_SCANNER_UNAVAILABLE"));
    });
    socket.once("error", () => {
      settle(new ServiceUnavailableException("UPLOAD_AV_SCANNER_UNAVAILABLE"));
    });
    socket.once("end", () => {
      if (response.includes("FOUND")) {
        settle(new BadRequestException("UPLOAD_AV_MALWARE_DETECTED"));
        return;
      }
      if (/\bOK\b/.test(response)) {
        settle();
        return;
      }
      settle(new ServiceUnavailableException("UPLOAD_AV_SCANNER_UNAVAILABLE"));
    });
  });
}

function readPositiveInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key}_INVALID`);
  }
  return parsed;
}
