export const ISEM_OPTICAL_PIPELINE_FIXTURE = Object.freeze({
  answerKeyQuestionCount: 90,
  bookletVariantCount: 1,
  studentCount: 21,
  participantCount: 21,
  matchedCount: 21,
  quarantineCount: 0,
  examResultCount: 21,
  reportResultCount: 21,
});

export function createLiveUiWorkerEvidence({
  examId,
  firstStudentId,
  guardianPortal,
  loginName,
  password,
  studentPortal,
  tenantSlug,
  generatedAt = new Date().toISOString(),
}) {
  return {
    examId,
    firstStudentId,
    generatedAt,
    ...(guardianPortal ? { guardianPortal } : {}),
    loginName,
    password,
    ...(studentPortal ? { studentPortal } : {}),
    tenantSlug,
  };
}
