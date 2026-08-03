import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import type { StudentPortalActivationRequest, StudentPortalActivationResponse } from "@o-okul/shared-types";
import { z } from "zod";
import { passwordMaxLength, passwordMinLength, passwordPolicyViolation } from "../auth/password-policy.js";
import { requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { StudentPortalActivationService } from "./student-portal-activation.service.js";

const studentPortalActivationBodySchema = z.object({
  tenantSlug: requiredTrimmedString,
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
  ): Promise<StudentPortalActivationResponse> {
    return this.activations.accept(body);
  }
}
