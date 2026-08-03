import { Inject, Injectable, Optional } from "@nestjs/common";
import type { RequestContext } from "../context/request-context.js";
import { IdentityInvitationService } from "../identity-invitation/identity-invitation.service.js";
import {
  type DeactivateProfileInput,
  type DeactivateProfileResult,
  type ProfileLifecycleStore,
  profileLifecycleStoreToken,
} from "./profile-lifecycle-store.js";

export interface ProvisionTenantSubjectInput {
  tenantId: string;
  subjectType: "STUDENT" | "TEACHER" | "GUARDIAN";
  subjectId: string;
  displayName: string;
  nationalId?: string;
  phone?: string;
  email?: string;
}

export type ProvisionOrInviteStatus = "INVITED" | "SKIPPED";

export interface ProvisionOrInviteResult {
  status: ProvisionOrInviteStatus;
  invitationId?: string;
}

@Injectable()
export class IdentityProvisioningService {
  constructor(
    @Optional() private readonly identityInvitations?: IdentityInvitationService,
    @Inject(profileLifecycleStoreToken) @Optional() private readonly profileLifecycle?: ProfileLifecycleStore,
  ) {}

  async provisionOrInvite(context: RequestContext, input: ProvisionTenantSubjectInput): Promise<ProvisionOrInviteResult> {
    const email = input.email?.trim().toLowerCase();
    if (email && this.identityInvitations) {
      const issued = await this.identityInvitations.create(context, {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        email,
        name: input.displayName,
      });
      return { status: "INVITED", invitationId: issued.invitation.id };
    }

    return { status: "SKIPPED" };
  }

  async deactivateProfile(input: DeactivateProfileInput): Promise<DeactivateProfileResult | undefined> {
    if (!this.profileLifecycle) {
      throw new Error("PROFILE_LIFECYCLE_STORE_UNAVAILABLE");
    }
    return this.profileLifecycle.deactivate(input);
  }
}
