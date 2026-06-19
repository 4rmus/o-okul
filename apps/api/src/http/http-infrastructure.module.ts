import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { RlsBypassGuard } from "../context/rls-bypass.guard.js";
import { CapabilityGuard } from "../rbac/capability.guard.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ApiErrorFilter } from "./api-error.filter.js";
import { createIdempotencyStore, IdempotencyService, idempotencyStoreToken } from "./idempotency.js";

@Global()
@Module({
  imports: [AuditLogModule],
  providers: [
    IdempotencyService,
    {
      provide: idempotencyStoreToken,
      useFactory: createIdempotencyStore,
    },
    {
      provide: APP_FILTER,
      useClass: ApiErrorFilter,
    },
    {
      provide: APP_GUARD,
      useClass: RlsBypassGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CapabilityGuard,
    },
    RolesGuard,
    CapabilityGuard,
    RlsBypassGuard,
  ],
  exports: [IdempotencyService, RolesGuard, CapabilityGuard, RlsBypassGuard],
})
export class HttpInfrastructureModule {}
