import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { createStudySessionStore, studySessionStoreToken } from "./study-session-store.js";
import { StudySessionController } from "./study-session.controller.js";
import { StudySessionService } from "./study-session.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule, StudentModule, TeacherModule],
  controllers: [StudySessionController],
  providers: [
    {
      provide: studySessionStoreToken,
      useFactory: createStudySessionStore,
    },
    StudySessionService,
  ],
})
export class StudySessionModule {}
