import { Module } from "@nestjs/common";
import { createLicenseTermStore, licenseTermStoreToken } from "./license-term-store.js";

@Module({
  providers: [{ provide: licenseTermStoreToken, useFactory: createLicenseTermStore }],
  exports: [licenseTermStoreToken],
})
export class LicensePersistenceModule {}
