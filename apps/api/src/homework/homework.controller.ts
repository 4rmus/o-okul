import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileDownloadResult,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  HomeworkSubmissionRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { HomeworkService } from "./homework.service.js";
import {
  homeworkCheckStatusBodySchema,
  homeworkCreateBodySchema,
  homeworkFromMaterialCreateBodySchema,
  homeworkMaterialAssignmentCreateBodySchema,
  homeworkMaterialCreateBodySchema,
  homeworkMaterialFileCreateBodySchema,
  homeworkMaterialUpdateBodySchema,
  homeworkSubmissionCheckBodySchema,
  homeworkUpdateBodySchema,
  type HomeworkCheckStatusBody,
  type HomeworkCreateBody,
  type HomeworkFromMaterialCreateBody,
  type HomeworkMaterialAssignmentCreateBody,
  type HomeworkMaterialCreateBody,
  type HomeworkMaterialFileCreateBody,
  type HomeworkMaterialUpdateBody,
  type HomeworkSubmissionCheckBody,
  type HomeworkUpdateBody,
} from "./homework-validation.js";

@Controller("homework")
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  @RequireCapability("homework:read-assigned")
  async list(@Query() query: ListQuery): Promise<HomeworkRecord[]> {
    return applyListQuery(await this.homework.list(getRequestContext()), query, homeworkListFields);
  }

  @Get("materials")
  @RequireCapability("homework:read-assigned")
  async listMaterials(@Query() query: ListQuery): Promise<HomeworkMaterialRecord[]> {
    return applyListQuery(await this.homework.listMaterials(getRequestContext()), query, homeworkMaterialListFields);
  }

  @Get("material-assignments")
  @RequireCapability("homework:read-assigned")
  listMaterialAssignmentsByStudent(
    @Query("studentId") studentId: string,
  ): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listMaterialAssignmentsByStudent(getRequestContext(), studentId);
  }

  @Get("materials/:id")
  @RequireCapability("homework:read-assigned")
  findMaterial(@Param("id") id: string): Promise<HomeworkMaterialRecord> {
    return this.homework.findMaterial(getRequestContext(), id);
  }

  @Get("materials/:id/files")
  @RequireCapability("homework:read-assigned")
  listMaterialFiles(@Param("id") id: string): Promise<HomeworkMaterialFileRecord[]> {
    return this.homework.listMaterialFiles(getRequestContext(), id);
  }

  @Get("materials/:id/files/:fileId/download")
  @RequireCapability("homework:read-assigned")
  downloadMaterialFile(
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ): Promise<HomeworkMaterialFileDownloadResult> {
    return this.homework.downloadMaterialFile(getRequestContext(), id, fileId);
  }

  @Post("materials/:id/files")
  @RequireCapability("academic:manage")
  addMaterialFile(
    @Param("id") id: string,
    @Body(zodBody(homeworkMaterialFileCreateBodySchema)) body: HomeworkMaterialFileCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkMaterialFileRecord> {
    return this.homework.addMaterialFile(getRequestContext(), id, body, idempotencyKey);
  }

  @Get("materials/:id/assignments")
  @RequireCapability("homework:read-assigned")
  listMaterialAssignments(@Param("id") id: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listMaterialAssignments(getRequestContext(), id);
  }

  @Post("materials/:id/assignments")
  @RequireCapability("homework:write-assigned")
  assignMaterial(
    @Param("id") id: string,
    @Body(zodBody(homeworkMaterialAssignmentCreateBodySchema)) body: HomeworkMaterialAssignmentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkMaterialAssignmentRecord> {
    return this.homework.assignMaterial(getRequestContext(), id, body, idempotencyKey);
  }

  @Post("materials")
  @RequireCapability("academic:manage")
  createMaterial(
    @Body(zodBody(homeworkMaterialCreateBodySchema)) body: HomeworkMaterialCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkMaterialRecord> {
    return this.homework.createMaterial(getRequestContext(), body, idempotencyKey);
  }

  @Patch("materials/:id")
  @RequireCapability("academic:manage")
  updateMaterial(
    @Param("id") id: string,
    @Body(zodBody(homeworkMaterialUpdateBodySchema)) body: HomeworkMaterialUpdateBody,
  ): Promise<HomeworkMaterialRecord> {
    return this.homework.updateMaterial(getRequestContext(), id, body);
  }

  @Delete("materials/:id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  deleteMaterial(@Param("id") id: string): Promise<void> {
    return this.homework.deleteMaterial(getRequestContext(), id);
  }

  @Get(":id")
  @RequireCapability("homework:read-assigned")
  findOne(@Param("id") id: string): Promise<HomeworkRecord> {
    return this.homework.findOne(getRequestContext(), id);
  }

  /** Management, or a class/branch teacher of the class (DEC-20261012-01); the service enforces the assignment. */
  @Post()
  @RequireCapability("homework:write-assigned")
  create(@Body(zodBody(homeworkCreateBodySchema)) body: HomeworkCreateBody, @Headers("idempotency-key") idempotencyKey?: string): Promise<HomeworkRecord> {
    return this.homework.create(getRequestContext(), body, idempotencyKey);
  }

  @Post("from-material")
  @RequireCapability("academic:manage")
  createFromMaterial(
    @Body(zodBody(homeworkFromMaterialCreateBodySchema)) body: HomeworkFromMaterialCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkRecord> {
    return this.homework.createFromMaterial(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("academic:manage")
  update(
    @Param("id") id: string,
    @Body(zodBody(homeworkUpdateBodySchema)) body: HomeworkUpdateBody,
  ): Promise<HomeworkRecord> {
    return this.homework.update(getRequestContext(), id, body);
  }

  @Patch(":id/check-status")
  @RequireCapability("homework:write-assigned")
  updateCheckStatus(
    @Param("id") id: string,
    @Body(zodBody(homeworkCheckStatusBodySchema)) body: HomeworkCheckStatusBody,
  ): Promise<HomeworkRecord> {
    return this.homework.updateCheckStatus(getRequestContext(), id, body.checked);
  }

  @Get(":id/submissions")
  @RequireCapability("homework:read-assigned")
  listSubmissions(@Param("id") id: string): Promise<HomeworkSubmissionRecord[]> {
    return this.homework.listSubmissions(getRequestContext(), id);
  }

  @Post(":id/submissions/check")
  @RequireCapability("homework:write-assigned")
  checkSubmissions(
    @Param("id") id: string,
    @Body(zodBody(homeworkSubmissionCheckBodySchema)) body: HomeworkSubmissionCheckBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkSubmissionRecord[]> {
    return this.homework.checkSubmissions(getRequestContext(), id, body.studentIds, idempotencyKey);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  delete(@Param("id") id: string): Promise<void> {
    return this.homework.delete(getRequestContext(), id);
  }
}

const homeworkListFields = [
  { name: "title", read: (record: HomeworkRecord) => record.title },
  { name: "description", read: (record: HomeworkRecord) => record.description },
  { name: "sourceMaterialTitle", read: (record: HomeworkRecord) => record.sourceMaterialTitle },
  { name: "dueAt", read: (record: HomeworkRecord) => record.dueAt },
  { name: "checkedAt", read: (record: HomeworkRecord) => record.checkedAt },
];

const homeworkMaterialListFields = [
  { name: "title", read: (record: HomeworkMaterialRecord) => record.title },
  { name: "description", read: (record: HomeworkMaterialRecord) => record.description },
];
