import { Module } from "@nestjs/common";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { authSessionStoreToken } from "../auth/session-store.js";
import { IdentityInvitationModule } from "../identity-invitation/identity-invitation.module.js";
import { identityInvitationStoreToken } from "../identity-invitation/identity-invitation-store.js";
import { SchoolModule } from "../school/school.module.js";
import { guardianStoreToken } from "../school/guardian-store.js";
import { teacherStoreToken } from "../school/teacher-store.js";
import { StudentPersistenceModule } from "../student/student-persistence.module.js";
import { studentStoreToken } from "../student/student-store.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { userManagementStoreToken } from "../user-management/user-management-store.js";
import { IdentityProvisioningService } from "./identity-provisioning.service.js";
import { createProfileLifecycleStore, profileLifecycleStoreToken } from "./profile-lifecycle-store.js";

@Module({
  imports: [
    AuthPersistenceModule,
    IdentityInvitationModule,
    SchoolModule,
    StudentPersistenceModule,
    UserManagementPersistenceModule,
  ],
  providers: [
    {
      provide: profileLifecycleStoreToken,
      useFactory: createProfileLifecycleStore,
      inject: [
        studentStoreToken,
        teacherStoreToken,
        guardianStoreToken,
        userManagementStoreToken,
        authSessionStoreToken,
        identityInvitationStoreToken,
      ],
    },
    IdentityProvisioningService,
  ],
  exports: [IdentityProvisioningService],
})
export class IdentityProvisioningModule {}
