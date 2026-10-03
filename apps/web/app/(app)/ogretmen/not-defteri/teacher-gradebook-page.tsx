"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GradeEntryDraftInput, StudentRecord, TeacherPortalLookupsResponse } from "@o-okul/shared-types";
import { EmptyState, Field, Panel, Select } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { gradeKindLabels, listGradeAssessments, loadGradeAssessment, saveGradeEntries } from "../../_shared/gradebook/gradebook-api.js";
import { GradeEntryGrid } from "../../_shared/gradebook/grade-entry-grid.js";
import { AccessPanel, PortalFrame } from "../../portals/_shared/portal-shell.js";

// ponytail: no role-preview mode; the gradebook API reads the teacher's own assignments only.
export function TeacherGradebookPage() {
  const { auth } = useAuth();
  const isTeacher = auth?.session.subjectType === "TEACHER";
  const accessToken = auth?.accessToken ?? "";
  const sessionKey = auth?.session.userId ?? "anonymous";
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);

  const assessmentsQuery = useQuery({
    queryKey: ["teacher-gradebook", sessionKey],
    queryFn: () => listGradeAssessments(accessToken),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const lookupsQuery = useQuery({
    queryKey: ["teacher-gradebook-lookups", sessionKey],
    queryFn: () => apiRequest<TeacherPortalLookupsResponse>(accessToken, `${apiBaseUrl}/me/teacher/lookups`),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const studentsQuery = useQuery({
    queryKey: ["teacher-gradebook-students", sessionKey],
    queryFn: () => apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/me/teacher/students`),
    enabled: isTeacher,
    refetchOnWindowFocus: false,
  });
  const detailQuery = useQuery({
    queryKey: ["teacher-gradebook-assessment", sessionKey, selectedId],
    queryFn: () => loadGradeAssessment(accessToken, selectedId),
    enabled: Boolean(isTeacher && selectedId),
    refetchOnWindowFocus: false,
  });

  const classNames = useMemo(() => new Map((lookupsQuery.data?.classes ?? []).map((record) => [record.id, record.name])), [lookupsQuery.data]);
  const courseNames = useMemo(
    () => new Map((lookupsQuery.data?.courses ?? []).map((record) => [record.id, formatCourseName(record.name)])),
    [lookupsQuery.data],
  );
  const detail = detailQuery.data;
  const students = useMemo(
    () => (studentsQuery.data ?? [])
      .filter((record) => detail && record.classId === detail.assessment.classId)
      .map((record) => ({ id: record.id, name: `${record.firstName} ${record.lastName}` })),
    [studentsQuery.data, detail],
  );
  const assessments = assessmentsQuery.data ?? [];

  if (!isTeacher) return <AccessPanel title="Öğretmen Portalı" />;

  async function save(entries: GradeEntryDraftInput[]) {
    if (!detail) return;
    setSaving(true);
    try {
      await saveGradeEntries(accessToken, detail.assessment.id, entries);
      await queryClient.invalidateQueries({ queryKey: ["teacher-gradebook-assessment", sessionKey, detail.assessment.id] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PortalFrame title="Öğretmen Portalı" subtitle="Atandığın sınıf ve derslerin yazılı, performans ve proje notları">
      <Panel
        aria-label="Öğretmen not girişi"
        description="Notları taslak olarak kaydet; yayını kurum yönetimi yapar. Yayınlanan not değişmez, düzeltme yeni sürüm olur."
        title="Not defteri"
      >
        {assessmentsQuery.isError ? <p className="next-field-hint" role="alert">Değerlendirmeler alınamadı.</p> : null}
        {!assessmentsQuery.isPending && assessments.length === 0 ? (
          <EmptyState
            title="Not girilecek değerlendirme yok"
            description="Kurum yönetimi atandığın sınıf ve ders için değerlendirme tanımladığında burada görünür."
          />
        ) : (
          <Field label="Değerlendirme">
            <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Seçin</option>
              {assessments.map((record) => (
                <option key={record.id} value={record.id}>
                  {`${record.title} · ${classNames.get(record.classId) ?? "-"} · ${courseNames.get(record.courseId) ?? "-"} · ${gradeKindLabels[record.kind]}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {detail ? <GradeEntryGrid canEdit detail={detail} onSave={save} saving={saving} students={students} /> : null}
      </Panel>
    </PortalFrame>
  );
}
