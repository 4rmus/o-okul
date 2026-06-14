import { Module } from "@nestjs/common";
import { createStudentStore, studentStoreToken } from "./student-store.js";

@Module({
  providers: [
    {
      provide: studentStoreToken,
      useFactory: createStudentStore,
    },
  ],
  exports: [studentStoreToken],
})
export class StudentPersistenceModule {}
