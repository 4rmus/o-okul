import { BadRequestException } from "@nestjs/common";

export type ValidatedUploadContentType = "application/pdf" | "image/jpeg" | "image/png" | "text/plain";

export function assertUploadContentMatchesContentType(
  body: Buffer,
  contentType: ValidatedUploadContentType,
  errorCode: string,
): void {
  if (contentType === "application/pdf" && !body.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new BadRequestException(errorCode);
  }
  if (contentType === "image/jpeg" && !(body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)) {
    throw new BadRequestException(errorCode);
  }
  if (contentType === "image/png" && !body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new BadRequestException(errorCode);
  }
  if (contentType === "text/plain" && body.includes(0)) {
    throw new BadRequestException(errorCode);
  }
}
