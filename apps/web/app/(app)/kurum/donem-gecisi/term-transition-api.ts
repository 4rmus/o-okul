import type {
  AcademicCalendarActivateRequest,
  AcademicCalendarActivateResult,
  AcademicTermRecord,
  AcademicYearRecord,
  ClassRecord,
  StudentBulkEnrollmentRequest,
  StudentBulkEnrollmentResult,
  StudentBulkRenewDryRunResult,
  StudentBulkStatusRequest,
  StudentBulkStatusResult,
  StudentRecord,
  TeacherAssignmentRecord,
  TeacherRecord,
} from "@o-okul/shared-types";
import { ApiRequestError, apiBaseUrl, apiCursorListAll, apiRequest } from "../../../../src/api-client.js";
import type { AcademicTermFormPayload, AcademicYearFormPayload } from "../../../../src/form-validation.js";

export interface TeacherClassAssignment {
  assignment: TeacherAssignmentRecord;
  teacher: TeacherRecord;
}

export function loadAcademicYears(accessToken: string) {
  return apiRequest<AcademicYearRecord[]>(accessToken, `${apiBaseUrl}/academic-years`);
}

export function loadAcademicTerms(accessToken: string) {
  return apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`);
}

export function loadClasses(accessToken: string) {
  return apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`);
}

export function loadActiveStudents(accessToken: string) {
  return apiCursorListAll<StudentRecord>(accessToken, `${apiBaseUrl}/students?status=ACTIVE&limit=100`);
}

export function createAcademicYear(accessToken: string, input: AcademicYearFormPayload) {
  return postJson<AcademicYearRecord>(accessToken, "/academic-years", input);
}

export function createAcademicTerm(accessToken: string, input: AcademicTermFormPayload) {
  return postJson<AcademicTermRecord>(accessToken, "/academic-terms", input);
}

export function dryRunBulkRenew(accessToken: string, input: StudentBulkEnrollmentRequest) {
  return postJson<StudentBulkRenewDryRunResult>(accessToken, "/students/enrollments/bulk-renew/dry-run", input);
}

export function bulkRenew(accessToken: string, input: StudentBulkEnrollmentRequest, idempotencyKey: string) {
  return postJson<StudentBulkEnrollmentResult>(accessToken, "/students/enrollments/bulk-renew", input, idempotencyKey);
}

export function bulkUpdateStatus(accessToken: string, input: StudentBulkStatusRequest, idempotencyKey: string) {
  return postJson<StudentBulkStatusResult>(accessToken, "/students/bulk-status", input, idempotencyKey);
}

export function activateAcademicCalendar(accessToken: string, input: AcademicCalendarActivateRequest, idempotencyKey: string) {
  return postJson<AcademicCalendarActivateResult>(accessToken, "/academic-calendar/activate", input, idempotencyKey);
}

/** Class-bound assignments that have not ended; the wizard lists them and never changes them. */
export async function loadOpenClassAssignments(accessToken: string, today: string): Promise<TeacherClassAssignment[]> {
  const teachers = await apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`);
  const rows: TeacherClassAssignment[] = [];
  for (let index = 0; index < teachers.length; index += 8) {
    const batch = teachers.slice(index, index + 8);
    const assignments = await Promise.all(batch.map((teacher) =>
      apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/teachers/${encodeURIComponent(teacher.id)}/assignments`),
    ));
    batch.forEach((teacher, position) => {
      for (const assignment of assignments[position] ?? []) {
        if (!assignment.classId) continue;
        if (assignment.endsAt && assignment.endsAt.slice(0, 10) < today) continue;
        rows.push({ assignment, teacher });
      }
    });
  }
  return rows;
}

const errorMessages: Record<string, string> = {
  ACADEMIC_CALENDAR_NOT_STARTED: "Başlangıç tarihi gelmemiş yıl veya dönem etkinleştirilemez.",
  ACADEMIC_TERM_NOT_STARTED: "Başlangıç tarihi gelmemiş döneme kayıt yenilenemez. Dönem başladığında yeniden deneyin.",
  ACADEMIC_TERM_YEAR_MISMATCH: "Seçilen dönem bu akademik yıla ait değil.",
  ACTIVE_STUDENT_LIMIT_REACHED: "Lisanstaki aktif öğrenci sınırı aşılıyor. Lisans dönemini güncelledikten sonra yeniden deneyin.",
  IDEMPOTENCY_KEY_IN_PROGRESS: "Bu adım hâlâ işleniyor. Biraz sonra yeniden deneyin.",
  SCHOOL_CAMPUS_SCOPE_FORBIDDEN: "Kampüs yetkisiyle sınırlı hesaplar kurum takvimini değiştiremez.",
  STUDENT_BULK_RENEW_NOT_ACTIVE: "Aktif olmayan öğrenci yenilemeye alınamaz. Ön izlemeyi yenileyip tekrar deneyin.",
  STUDENT_CAMPUS_SCOPE_FORBIDDEN: "Yetkinizin dışındaki bir kampüsün öğrencisi seçildi.",
  STUDENT_STATUS_CHANGED: "Bir öğrencinin durumu bu sırada değişti. Yeniden deneyin.",
};

export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    if (error.code && errorMessages[error.code]) return errorMessages[error.code]!;
    if (error.status === 403) return "Bu işlem için yetkiniz yok.";
  }
  return fallback;
}

function postJson<T>(accessToken: string, path: string, body: unknown, idempotencyKey?: string) {
  return apiRequest<T>(accessToken, `${apiBaseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    method: "POST",
  });
}
