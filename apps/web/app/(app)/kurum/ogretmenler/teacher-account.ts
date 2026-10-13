import type { IdentityInvitationRecord, TeacherRecord } from "@o-okul/shared-types";
import type { StatusBadgeProps } from "@o-okul/ui";
import { ApiRequestError, apiBaseUrl, apiRequest } from "../../../../src/api-client.js";

// Öğretmen portalı yalnız TEACHER kimlik daveti kabul edilince açılır (Teacher.userId bağı; API yalnız `hasAccount` döner, UAT F-09).
export type TeacherAccountState = "linked" | "pending" | "none";

export const teacherAccountLabels: Record<TeacherAccountState, string> = {
  linked: "Portal bağlı",
  none: "Hesap yok",
  pending: "Davet bekliyor",
};

export const teacherAccountTones: Record<TeacherAccountState, StatusBadgeProps["tone"]> = {
  linked: "success",
  none: "warning",
  pending: "info",
};

export function teacherAccountState(teacher: Pick<TeacherRecord, "id" | "hasAccount">, pendingBySubject: ReadonlyMap<string, IdentityInvitationRecord>): TeacherAccountState {
  if (teacher.hasAccount) return "linked";
  return pendingBySubject.has(teacher.id) ? "pending" : "none";
}

export async function loadPendingTeacherInvitations(accessToken: string): Promise<Map<string, IdentityInvitationRecord>> {
  // ponytail: q=TEACHER narrows the tenant-wide list server-side; add a subjectId filter to the API if teacher invitations grow large.
  const invitations = await apiRequest<IdentityInvitationRecord[]>(accessToken, `${apiBaseUrl}/identity-invitations?q=TEACHER`);
  return new Map(
    invitations
      .filter((invitation) => invitation.subjectType === "TEACHER" && invitation.status === "PENDING" && Date.parse(invitation.expiresAt) > Date.now())
      .map((invitation) => [invitation.subjectId, invitation]),
  );
}

export function createTeacherInvitation(accessToken: string, teacherId: string, email: string) {
  return apiRequest<IdentityInvitationRecord>(accessToken, `${apiBaseUrl}/identity-invitations`, {
    body: JSON.stringify({ email: email.trim(), subjectId: teacherId, subjectType: "TEACHER" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function resendTeacherInvitation(accessToken: string, invitationId: string) {
  return apiRequest<IdentityInvitationRecord>(accessToken, `${apiBaseUrl}/identity-invitations/${encodeURIComponent(invitationId)}/resend`, {
    method: "POST",
  });
}

// UAT F-03: a sent invitation can be withdrawn; the teacher drops back to "Hesap yok" and can be invited again.
export function revokeTeacherInvitation(accessToken: string, invitationId: string) {
  return apiRequest<IdentityInvitationRecord>(accessToken, `${apiBaseUrl}/identity-invitations/${encodeURIComponent(invitationId)}/revoke`, {
    method: "POST",
  });
}

export function teacherInvitationErrorMessage(error: unknown) {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  if (code === "SUBJECT_ALREADY_LINKED") return "Bu öğretmenin portal hesabı zaten bağlı.";
  if (code === "SUBJECT_NOT_FOUND") return "Öğretmen kaydı bulunamadı. Sayfayı yenileyin.";
  if (code === "EMAIL_REQUIRED") return "Geçerli bir e-posta adresi yazın.";
  if (code === "IDENTITY_INVITATION_NOT_PENDING" || code === "IDENTITY_INVITATION_NOT_FOUND") return "Davet artık beklemede değil. Sayfayı yenileyin.";
  if (error instanceof ApiRequestError && error.status === 403) return "Hesap daveti göndermek için kullanıcı yönetimi yetkisi gerekir.";
  return "Davet gönderilemedi. Bilgileri kontrol edip tekrar deneyin.";
}
