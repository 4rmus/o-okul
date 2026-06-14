import { Module } from "@nestjs/common";
import { examParticipantRepositoryToken, examRepositoryToken } from "./exam.service.js";
import { PostgresExamParticipantRepository } from "./postgres-exam-participant-repository.js";
import { PostgresExamRepository } from "./postgres-exam-repository.js";

@Module({
  providers: [
    {
      provide: examRepositoryToken,
      useFactory: () => new PostgresExamRepository(),
    },
    {
      provide: examParticipantRepositoryToken,
      useFactory: () => new PostgresExamParticipantRepository(),
    },
  ],
  exports: [examRepositoryToken, examParticipantRepositoryToken],
})
export class ExamPersistenceModule {}
