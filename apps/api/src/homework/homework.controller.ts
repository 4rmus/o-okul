import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileDownloadResult,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { HomeworkService } from "./homework.service.js";
import {
  homeworkCheckStatusBodySchema,
  homeworkCreateBodySchema,
  homeworkFromMaterialCreateBodySchema,
  homeworkMaterialAssignmentCreateBodySchema,
  homeworkMaterialCreateBodySchema,
  homeworkMaterialFileCreateBodySchema,
  homeworkMaterialUpdateBodySchema,
  homeworkUpdateBodySchema,
  type HomeworkCheckStatusBody,
  type HomeworkCreateBody,
  type HomeworkFromMaterialCreateBody,
  type HomeworkMaterialAssignmentCreateBody,
  type HomeworkMaterialCreateBody,
  type HomeworkMaterialFileCreateBody,
  type HomeworkMaterialUpdateBody,
  type HomeworkUpdateBody,
} from "./homework-validation.js";

@Controller("homework")
@UseGuards(RolesGuard)
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: ListQuery): Promise<HomeworkRecord[]> {
    return applyListQuery(await this.homework.list(getRequestContext()), query, homeworkListFields);
  }

  @Get("materials")
  @Roles("TEACHER")
  async listMaterials(@Query() query: ListQuery): Promise<HomeworkMaterialRecord[]> {
    return applyListQuery(await this.homework.listMaterials(getRequestContext()), query, homeworkMaterialListFields);
  }

  @Get("materials/:id")
  @Roles("TEACHER")
  findMaterial(@Param("id") id: string): Promise<HomeworkMaterialRecord> {
    return this.homework.findMaterial(getRequestContext(), id);
  }

  @Get("materials/:id/files")
  @Roles("TEACHER")
  listMaterialFiles(@Param("id") id: string): Promise<HomeworkMaterialFileRecord[]> {
    return this.homework.listMaterialFiles(getRequestContext(), id);
  }

  @Get("materials/:id/files/:fileId/download")
  @Roles("TEACHER")
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
  @Roles("TEACHER")
  listMaterialAssignments(@Param("id") id: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listMaterialAssignments(getRequestContext(), id);
  }

  @Post("materials/:id/assignments")
  @Roles("TEACHER")
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
  ): Promise<HomeworkMaterialRecord> {
    return this.homework.createMaterial(getRequestContext(), body);
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
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<HomeworkRecord> {
    return this.homework.findOne(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("academic:manage")
  create(@Body(zodBody(homeworkCreateBodySchema)) body: HomeworkCreateBody): Promise<HomeworkRecord> {
    return this.homework.create(getRequestContext(), body);
  }

  @Post("from-material")
  @RequireCapability("academic:manage")
  createFromMaterial(
    @Body(zodBody(homeworkFromMaterialCreateBodySchema)) body: HomeworkFromMaterialCreateBody,
  ): Promise<HomeworkRecord> {
    return this.homework.createFromMaterial(getRequestContext(), body);
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
  @Roles("TEACHER")
  updateCheckStatus(
    @Param("id") id: string,
    @Body(zodBody(homeworkCheckStatusBodySchema)) body: HomeworkCheckStatusBody,
  ): Promise<HomeworkRecord> {
    return this.homework.updateCheckStatus(getRequestContext(), id, body.checked);
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
