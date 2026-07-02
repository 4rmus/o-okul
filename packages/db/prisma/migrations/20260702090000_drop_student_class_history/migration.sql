-- StudentEnrollment, StudentClassHistory'nin katı üst kümesidir (ek: status).
-- Yazma yolları başından beri iki tabloya birden yazdığı için StudentClassHistory
-- kaldırılmadan önce karşılığı olmayan satırlar StudentEnrollment'a taşınır.
INSERT INTO "StudentEnrollment" (
  "id",
  "tenantId",
  "studentId",
  "academicYearId",
  "termId",
  "classId",
  "status",
  "startsAt",
  "endsAt",
  "reason",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  history."tenantId",
  history."studentId",
  history."academicYearId",
  history."termId",
  history."classId",
  CASE WHEN history."endsAt" IS NULL THEN 'ACTIVE' ELSE 'CLOSED' END,
  history."startsAt",
  history."endsAt",
  history."reason",
  history."createdAt",
  history."updatedAt"
FROM "StudentClassHistory" history
WHERE NOT EXISTS (
  SELECT 1
  FROM "StudentEnrollment" enrollment
  WHERE enrollment."tenantId" = history."tenantId"
    AND enrollment."studentId" = history."studentId"
    AND enrollment."startsAt" = history."startsAt"
    AND enrollment."classId" IS NOT DISTINCT FROM history."classId"
);

DROP TABLE "StudentClassHistory";
