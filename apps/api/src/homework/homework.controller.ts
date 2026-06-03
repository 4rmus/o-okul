import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
} from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  HomeworkService,
  type CreateHomeworkMaterialAssignmentInput,
  type CreateHomeworkMaterialFileInput,
} from "./homework.service.js";

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

  @Post("materials/:id/files")
  @Roles("TENANT_ADMIN")
  addMaterialFile(
    @Param("id") id: string,
    @Body() body: CreateHomeworkMaterialFileInput,
  ): Promise<HomeworkMaterialFileRecord> {
    return this.homework.addMaterialFile(getRequestContext(), id, body);
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
    @Body() body: CreateHomeworkMaterialAssignmentInput,
  ): Promise<HomeworkMaterialAssignmentRecord> {
    return this.homework.assignMaterial(getRequestContext(), id, body);
  }

  @Post("materials")
  @Roles("TENANT_ADMIN")
  createMaterial(@Body() body: Partial<HomeworkMaterialRecord>): Promise<HomeworkMaterialRecord> {
    return this.homework.createMaterial(getRequestContext(), body);
  }

  @Patch("materials/:id")
  @Roles("TENANT_ADMIN")
  updateMaterial(
    @Param("id") id: string,
    @Body() body: Partial<HomeworkMaterialRecord>,
  ): Promise<HomeworkMaterialRecord> {
    return this.homework.updateMaterial(getRequestContext(), id, body);
  }

  @Delete("materials/:id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  deleteMaterial(@Param("id") id: string): Promise<void> {
    return this.homework.deleteMaterial(getRequestContext(), id);
  }

  @Get(":id")
  @Roles("TEACHER")
  findOne(@Param("id") id: string): Promise<HomeworkRecord> {
    return this.homework.findOne(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<HomeworkRecord>): Promise<HomeworkRecord> {
    return this.homework.create(getRequestContext(), body);
  }

  @Post("from-material")
  @Roles("TENANT_ADMIN")
  createFromMaterial(@Body() body: { tenantId?: string; classId?: string; materialId?: string; dueAt?: string }): Promise<HomeworkRecord> {
    return this.homework.createFromMaterial(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<HomeworkRecord>): Promise<HomeworkRecord> {
    return this.homework.update(getRequestContext(), id, body);
  }

  @Patch(":id/check-status")
  @Roles("TEACHER")
  updateCheckStatus(@Param("id") id: string, @Body() body: { checked?: boolean }): Promise<HomeworkRecord> {
    return this.homework.updateCheckStatus(getRequestContext(), id, body.checked);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
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
