import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { ExamRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ExamService } from "./exam.service.js";

@Controller("exams")
@UseGuards(RolesGuard)
export class ExamController {
  constructor(private readonly exams: ExamService) {}

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: { title?: string; startsAt?: string }): Promise<ExamRecord> {
    return this.exams.create(getRequestContext(), { title: body.title, startsAt: body.startsAt });
  }

  @Get()
  @Roles("TEACHER")
  list(): Promise<ExamRecord[]> {
    return this.exams.list(getRequestContext());
  }

  @Get(":examId")
  @Roles("TEACHER")
  get(@Param("examId") examId: string): Promise<ExamRecord> {
    return this.exams.get(getRequestContext(), examId);
  }

  @Post(":examId/publish")
  @Roles("TENANT_ADMIN")
  publish(@Param("examId") examId: string): Promise<ExamRecord> {
    return this.exams.publish(getRequestContext(), examId);
  }
}
