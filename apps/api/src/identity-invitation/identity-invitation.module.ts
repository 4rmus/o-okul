import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { FeatureRolloutModule } from "../feature-rollout/feature-rollout.module.js";
import { LicensePersistenceModule } from "../license/license-persistence.module.js";
import { SchoolModule } from "../school/school.module.js";
import { studentStoreToken } from "../student/student-store.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { tenantStoreToken } from "../tenant/tenant-store.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { IdentityInvitationController } from "./identity-invitation.controller.js";
import {
  createIdentityInvitationStore,
  identityInvitationStoreToken,
} from "./identity-invitation-store.js";
import { IdentityInvitationService } from "./identity-invitation.service.js";
import { StudentPortalActivationController } from "./student-portal-activation.controller.js";
import { StudentPortalActivationService } from "./student-portal-activation.service.js";
import { createStudentPortalActivationStore, studentPortalActivationStoreToken } from "./student-portal-activation-store.js";
import {
  createEmployeeAccountActivationStore,
  employeeAccountActivationStoreToken,
} from "./employee-account-activation-store.js";
import { userManagementStoreToken } from "../user-management/user-management-store.js";

@Module({
  imports: [AuditLogModule, FeatureRolloutModule, LicensePersistenceModule, SchoolModule, TenantPersistenceModule, UserManagementPersistenceModule],
  controllers: [IdentityInvitationController, StudentPortalActivationController],
  providers: [
    IdentityInvitationService,
    {
      provide: identityInvitationStoreToken,
      useFactory: createIdentityInvitationStore,
    },
    {
      provide: studentPortalActivationStoreToken,
      useFactory: createStudentPortalActivationStore,
      inject: [studentStoreToken, tenantStoreToken, identityInvitationStoreToken],
    },
    {
      provide: employeeAccountActivationStoreToken,
      useFactory: createEmployeeAccountActivationStore,
      inject: [userManagementStoreToken, tenantStoreToken, identityInvitationStoreToken],
    },
    StudentPortalActivationService,
  ],
  exports: [IdentityInvitationService, identityInvitationStoreToken, StudentPortalActivationService],
})
export class IdentityInvitationModule {}
