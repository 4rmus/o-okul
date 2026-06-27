import { Injectable, Inject } from "@nestjs/common";
import {
  type AuthUserStore,
  authUserStoreToken,
  hashPassword,
} from "../auth/auth-user-store.js";
import { optionalTurkishMobilePhone } from "../auth/phone-normalize.js";
import { encryptTcIdentity, hashTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";

export interface ProvisionTenantSubjectInput {
  tenantId: string;
  subjectType: "STUDENT" | "TEACHER" | "GUARDIAN";
  subjectId: string;
  displayName: string;
  nationalId?: string;
  phone?: string;
  email?: string;
}

export interface ProvisionTenantSubjectResult {
  userId: string;
  initialPassword: string;
}

@Injectable()
export class IdentityProvisioningService {
  constructor(@Inject(authUserStoreToken) private readonly users: AuthUserStore) {}

  async provisionTenantSubject(input: ProvisionTenantSubjectInput): Promise<ProvisionTenantSubjectResult | undefined> {
    if (!input.nationalId || !input.phone) return undefined;

    const nationalId = normalizeTcIdentity(input.nationalId, `${input.subjectType}_NATIONAL_ID_INVALID`);
    const phone = optionalTurkishMobilePhone(input.phone, `${input.subjectType}_PHONE_INVALID`);
    if (!phone) return undefined;

    const user = await this.users.createOrAttachTenantIdentity({
      tenantId: input.tenantId,
      email: input.email,
      nationalIdEncrypted: encryptTcIdentity(nationalId),
      nationalIdHash: hashTcIdentity(nationalId),
      name: input.displayName,
      passwordHash: hashPassword(phone, `initial-${input.tenantId}-${input.subjectType}-${input.subjectId}`),
      roles: [input.subjectType],
      mustChangePassword: true,
    });

    return {
      userId: user.id,
      initialPassword: phone,
    };
  }
}
