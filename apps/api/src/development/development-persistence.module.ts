import { Global, Module } from "@nestjs/common";
import { createDevelopmentStore, developmentStoreToken } from "./development-store.js";

// Global so StudentService.purgePii can clear DevelopmentAssessment.mentorNote (DEC-20261102-05 KVKK purge)
// without the student module importing the development module; there is still exactly one store instance.
@Global()
@Module({
  providers: [
    {
      provide: developmentStoreToken,
      useFactory: createDevelopmentStore,
    },
  ],
  exports: [developmentStoreToken],
})
export class DevelopmentPersistenceModule {}
