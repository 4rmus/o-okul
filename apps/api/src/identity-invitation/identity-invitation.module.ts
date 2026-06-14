import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { IdentityInvitationController } from "./identity-invitation.controller.js";
import {
  createIdentityInvitationStore,
  identityInvitationStoreToken,
} from "./identity-invitation-store.js";
import { IdentityInvitationService } from "./identity-invitation.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule, TenantPersistenceModule, UserManagementPersistenceModule],
  controllers: [IdentityInvitationController],
  providers: [
    IdentityInvitationService,
    {
      provide: identityInvitationStoreToken,
      useFactory: createIdentityInvitationStore,
    },
  ],
  exports: [IdentityInvitationService],
})
export class IdentityInvitationModule {}
