import type { IdentityInvitationRecord, TeacherRecord } from "@o-okul/shared-types";
import type { StatusBadgeProps } from "@o-okul/ui";
import { ApiRequestError, apiBaseUrl, apiCursorListAll, apiRequest } from "../../../../src/api-client.js";

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

// The list page needs every teacher's pending invitation; the detail page passes teacherId so only that teacher's
// invitations leave the API (same pattern as the guardian detail page). The cursor list is followed to its end.
export async function loadPendingTeacherInvitations(accessToken: string, teacherId?: string): Promise<Map<string, IdentityInvitationRecord>> {
  const query = new URLSearchParams({ limit: "100", status: "PENDING", subjectType: "TEACHER" });
  if (teacherId) query.set("subjectId", teacherId);
  const invitations = await apiCursorListAll<IdentityInvitationRecord>(accessToken, `${apiBaseUrl}/identity-invitations?${query.toString()}`);
  return new Map(
    invitations
      .filter((invitation) => invitation.subjectType === "TEACHER" && (teacherId === undefined || invitation.subjectId === teacherId) && invitation.status === "PENDING" && Date.parse(invitation.expiresAt) > Date.now())
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
