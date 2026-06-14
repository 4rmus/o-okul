import { Module } from "@nestjs/common";
import { createTenantStore, tenantStoreToken } from "./tenant-store.js";

@Module({
  providers: [
    {
      provide: tenantStoreToken,
      useFactory: createTenantStore,
    },
  ],
  exports: [tenantStoreToken],
})
export class TenantPersistenceModule {}
