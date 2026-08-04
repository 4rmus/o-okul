import { Body, Controller, HttpCode, HttpException, Post, Req } from "@nestjs/common";
import type { StudentPortalActivationRequest, StudentPortalActivationResponse } from "@o-okul/shared-types";
import type { Request } from "express";
import { z } from "zod";
import { passwordMaxLength, passwordMinLength, passwordPolicyViolation } from "../auth/password-policy.js";
import { requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { resolveTenantSlugFromRequest, TenantHostError } from "../http/tenant-host.js";
import { StudentPortalActivationService } from "./student-portal-activation.service.js";

const studentPortalActivationBodySchema = z.object({
  tenantSlug: z.string().trim().min(1).optional(),
  studentNo: requiredTrimmedString,
  code: requiredTrimmedString.regex(/^[A-HJ-NP-Z2-9]{12}$/, "STUDENT_PORTAL_ACTIVATION_CODE_INVALID"),
  password: z.string().min(passwordMinLength).max(passwordMaxLength).refine((value) => !passwordPolicyViolation(value), {
    message: "PASSWORD_COMMON_REJECTED",
  }),
}).strict() satisfies z.ZodType<StudentPortalActivationRequest>;

@Controller("auth")
export class StudentPortalActivationController {
  constructor(private readonly activations: StudentPortalActivationService) {}

  @Post("activate")
  @HttpCode(200)
  activate(
    @Body(zodBody(studentPortalActivationBodySchema)) body: StudentPortalActivationRequest,
    @Req() request: Request,
  ): Promise<StudentPortalActivationResponse> {
    try {
      return this.activations.accept({
        ...body,
        tenantSlug: resolveTenantSlugFromRequest(request, body.tenantSlug),
      });
    } catch (error) {
      if (error instanceof TenantHostError) throw new HttpException(error.message, error.status);
      throw error;
    }
  }
}
