import { Module } from "@nestjs/common";
import { createStudentEnrollmentStore, studentEnrollmentStoreToken } from "./student-enrollment-store.js";
import { createStudentStore, studentStoreToken } from "./student-store.js";

@Module({
  providers: [
    {
      provide: studentStoreToken,
      useFactory: createStudentStore,
    },
    {
      provide: studentEnrollmentStoreToken,
      useFactory: createStudentEnrollmentStore,
    },
  ],
  exports: [studentEnrollmentStoreToken, studentStoreToken],
})
export class StudentPersistenceModule {}
