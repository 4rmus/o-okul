import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [SchoolModule, StudentModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
