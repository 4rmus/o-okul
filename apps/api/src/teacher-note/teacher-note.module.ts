import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeacherNoteController } from "./teacher-note.controller.js";
import { createTeacherNoteStore, teacherNoteStoreToken } from "./teacher-note-store.js";
import { TeacherNoteService } from "./teacher-note.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule],
  controllers: [TeacherNoteController],
  providers: [
    TeacherNoteService,
    {
      provide: teacherNoteStoreToken,
      useFactory: createTeacherNoteStore,
    },
  ],
  exports: [TeacherNoteService],
})
export class TeacherNoteModule {}
