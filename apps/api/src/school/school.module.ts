import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { StudentPersistenceModule } from "../student/student-persistence.module.js";
import { AcademicCalendarController } from "./academic-calendar.controller.js";
import { academicCalendarStoreToken, createAcademicCalendarStore } from "./academic-calendar-store.js";
import { alanStoreToken, createAlanStore } from "./alan-store.js";
import { AlanlarController } from "./alanlar.controller.js";
import { campusStoreToken, createCampusStore } from "./campus-store.js";
import { CampusesController } from "./campuses.controller.js";
import { classStoreToken, createClassStore } from "./class-store.js";
import { ClassesController } from "./classes.controller.js";
import { courseStoreToken, createCourseStore } from "./course-store.js";
import { CoursesController } from "./courses.controller.js";
import { createGuardianStudentStore, guardianStudentStoreToken } from "./guardian-student-store.js";
import { createGuardianStore, guardianStoreToken } from "./guardian-store.js";
import { GuardiansController } from "./guardians.controller.js";
import { createGradeLevelCourseStore, gradeLevelCourseStoreToken } from "./grade-level-course-store.js";
import { createGradeLevelStore, gradeLevelStoreToken } from "./grade-level-store.js";
import { GradeLevelsController } from "./grade-levels.controller.js";
import { createLearningOutcomeStore, learningOutcomeStoreToken } from "./learning-outcome-store.js";
import { LearningOutcomesController } from "./learning-outcomes.controller.js";
import { SchoolService } from "./school.service.js";
import { createTeacherAssignmentStore, teacherAssignmentStoreToken } from "./teacher-assignment-store.js";
import { TeacherImportService } from "./teacher-import.service.js";
import { createTeacherStore, teacherStoreToken } from "./teacher-store.js";
import { TeachersController } from "./teachers.controller.js";

const schoolStoreProviders = [
  {
    provide: academicCalendarStoreToken,
    useFactory: createAcademicCalendarStore,
  },
  {
    provide: alanStoreToken,
    useFactory: createAlanStore,
  },
  {
    provide: campusStoreToken,
    useFactory: createCampusStore,
  },
  {
    provide: classStoreToken,
    useFactory: createClassStore,
  },
  {
    provide: courseStoreToken,
    useFactory: createCourseStore,
  },
  {
    provide: guardianStoreToken,
    useFactory: createGuardianStore,
  },
  {
    provide: guardianStudentStoreToken,
    useFactory: createGuardianStudentStore,
  },
  {
    provide: gradeLevelStoreToken,
    useFactory: createGradeLevelStore,
  },
  {
    provide: gradeLevelCourseStoreToken,
    useFactory: createGradeLevelCourseStore,
  },
  {
    provide: learningOutcomeStoreToken,
    useFactory: createLearningOutcomeStore,
  },
  {
    provide: teacherStoreToken,
    useFactory: createTeacherStore,
  },
  {
    provide: teacherAssignmentStoreToken,
    useFactory: createTeacherAssignmentStore,
  },
] as const;

@Module({
  imports: [AuditLogModule, IdentityProvisioningModule, StudentPersistenceModule],
  controllers: [
    AcademicCalendarController,
    AlanlarController,
    CampusesController,
    ClassesController,
    CoursesController,
    GradeLevelsController,
    GuardiansController,
    LearningOutcomesController,
    TeachersController,
  ],
  providers: [...schoolStoreProviders, SchoolService, TeacherImportService],
  exports: [
    StudentPersistenceModule,
    academicCalendarStoreToken,
    alanStoreToken,
    campusStoreToken,
    classStoreToken,
    courseStoreToken,
    guardianStoreToken,
    guardianStudentStoreToken,
    gradeLevelCourseStoreToken,
    gradeLevelStoreToken,
    learningOutcomeStoreToken,
    teacherStoreToken,
    teacherAssignmentStoreToken,
    SchoolService,
    TeacherImportService,
  ],
})
export class SchoolModule {}
