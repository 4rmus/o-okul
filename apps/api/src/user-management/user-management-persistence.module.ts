import { Module } from "@nestjs/common";
import { createUserManagementStore, userManagementStoreToken } from "./user-management-store.js";

@Module({
  providers: [
    {
      provide: userManagementStoreToken,
      useFactory: createUserManagementStore,
    },
  ],
  exports: [userManagementStoreToken],
})
export class UserManagementPersistenceModule {}
