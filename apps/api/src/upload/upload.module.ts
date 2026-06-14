import { Module } from "@nestjs/common";
import { createUploadAvScannerFromEnv, uploadAvScannerToken } from "./upload-av-scanner.js";

@Module({
  providers: [
    {
      provide: uploadAvScannerToken,
      useFactory: createUploadAvScannerFromEnv,
    },
  ],
  exports: [uploadAvScannerToken],
})
export class UploadModule {}
