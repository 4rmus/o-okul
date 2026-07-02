import { Module } from "@nestjs/common";
import { GuardianModule } from "../guardian/guardian.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [GuardianModule, SchoolModule, StudentModule, TeacherModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
