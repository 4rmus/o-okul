import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import type {
  StudentContactCreateRequest,
  StudentContactGuardianLinkRequest,
  StudentContactGuardianLinkResult,
  StudentContactRecord,
  StudentContactUpdateRequest,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { StudentContactGuardianLinkService } from "./student-contact-guardian-link.service.js";
import { StudentContactService } from "./student-contact.service.js";

const relationTypeSchema = z.enum(["MOTHER", "FATHER", "LEGAL_GUARDIAN", "OTHER"]);
const studentContactCreateSchema = z.object({
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  relationType: relationTypeSchema,
  phone: optionalTrimmedString,
  email: optionalTrimmedString,
  canReceiveSms: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveFinance: z.boolean().optional(),
  consentSource: optionalTrimmedString,
  consentRecordedAt: optionalTrimmedString,
}).strict();
const studentContactUpdateSchema = studentContactCreateSchema.partial().refine((input) => Object.keys(input).length > 0, {
  message: "STUDENT_CONTACT_UPDATE_REQUIRED",
});
const studentContactGuardianLinkSchema = z.object({
  guardianId: requiredTrimmedString,
}).strict() satisfies z.ZodType<StudentContactGuardianLinkRequest>;

@Controller("students/:studentId/contacts")
@UseGuards(RolesGuard)
export class StudentContactController {
  constructor(
    private readonly contacts: StudentContactService,
    private readonly guardianLinks: StudentContactGuardianLinkService,
  ) {}

  @Get()
  @RequireCapability("student:read")
  list(@Param("studentId") studentId: string): Promise<StudentContactRecord[]> {
    return this.contacts.list(getRequestContext(), studentId);
  }

  @Post()
  @RequireCapability("student:manage")
  create(
    @Param("studentId") studentId: string,
    @Body(zodBody(studentContactCreateSchema)) body: StudentContactCreateRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentContactRecord> {
    return this.contacts.create(getRequestContext(), studentId, body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("student:manage")
  update(
    @Param("studentId") studentId: string,
    @Param("id") id: string,
    @Body(zodBody(studentContactUpdateSchema)) body: StudentContactUpdateRequest,
  ): Promise<StudentContactRecord> {
    return this.contacts.update(getRequestContext(), studentId, id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("student:manage")
  delete(@Param("studentId") studentId: string, @Param("id") id: string): Promise<void> {
    return this.contacts.delete(getRequestContext(), studentId, id);
  }

  @Put(":id/guardian")
  @RequireCapability("student:manage", "user:manage")
  linkGuardian(
    @Param("studentId") studentId: string,
    @Param("id") id: string,
    @Body(zodBody(studentContactGuardianLinkSchema)) body: StudentContactGuardianLinkRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentContactGuardianLinkResult> {
    return this.guardianLinks.link(getRequestContext(), studentId, id, body.guardianId, idempotencyKey);
  }

  @Delete(":id/guardian")
  @RequireCapability("student:manage", "user:manage")
  unlinkGuardian(
    @Param("studentId") studentId: string,
    @Param("id") id: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentContactGuardianLinkResult> {
    return this.guardianLinks.unlink(getRequestContext(), studentId, id, idempotencyKey);
  }
}
