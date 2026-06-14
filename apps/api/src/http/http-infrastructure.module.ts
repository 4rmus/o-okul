import { Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { CapabilityGuard } from "../rbac/capability.guard.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ApiErrorFilter } from "./api-error.filter.js";
import { createIdempotencyStore, IdempotencyService, idempotencyStoreToken } from "./idempotency.js";

@Global()
@Module({
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
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CapabilityGuard,
    },
    RolesGuard,
    CapabilityGuard,
  ],
  exports: [IdempotencyService, RolesGuard, CapabilityGuard],
})
export class HttpInfrastructureModule {}
