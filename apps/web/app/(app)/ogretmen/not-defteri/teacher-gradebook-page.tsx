"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GradeAssessmentKind,
  GradeEntryDraftInput,
  StudentRecord,
  TeacherAuthoringScope,
  TeacherPortalLookupsResponse,
} from "@o-okul/shared-types";
import { Button, EmptyState, Field, FormModal, Input, Panel, Select, useConfirmDialog } from "@o-okul/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  createGradeAssessment,
  gradeKindLabels,
  listGradeAssessments,
  loadGradeAssessment,
  publishGradeAssessment,
  saveGradeEntries,
} from "../../_shared/gradebook/gradebook-api.js";
import { GradeEntryGrid } from "../../_shared/gradebook/grade-entry-grid.js";
import { AccessPanel, PortalFrame } from "../../portals/_shared/portal-shell.js";

interface AssessmentForm {
  classId: string;
  courseId: string;
  termId: string;
  kind: GradeAssessmentKind;
  title: string;
  heldOn: string;
  maxScore: string;
}

const emptyForm: AssessmentForm = { classId: "", courseId: "", termId: "", kind: "WRITTEN", title: "", heldOn: "", maxScore: "100" };

// ponytail: no role-preview mode; the gradebook API reads the teacher's own assignments only.
// DEC-20261012-01: the teacher creates and publishes for assigned class/course; the API enforces the scope.
export function TeacherGradebookPage() {
  const { auth } = useAuth();
  const isTeacher = auth?.session.subjectType === "TEACHER";
  const accessToken = auth?.accessToken ?? "";
  const sessionKey = auth?.session.userId ?? "anonymous";
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AssessmentForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [publishMessage, setPublishMessage] = useState("");
  const publishRequest = useRef<{ id: string; key: string } | null>(null);

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
  const scopesQuery = useQuery({
    queryKey: ["teacher-gradebook-scopes", sessionKey],
    queryFn: () => apiRequest<TeacherAuthoringScope[]>(accessToken, `${apiBaseUrl}/grade-assessments/teacher-scopes`),
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

  const lookups = lookupsQuery.data;
  const scopes = scopesQuery.data ?? [];
  const classNames = useMemo(() => new Map((lookups?.classes ?? []).map((record) => [record.id, record.name])), [lookups]);
  const courseNames = useMemo(
    () => new Map((lookups?.courses ?? []).map((record) => [record.id, formatCourseName(record.name)])),
    [lookups],
  );
  const options = authoringOptions(scopes, lookups, form);
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
    setBusy(true);
    try {
      await saveGradeEntries(accessToken, detail.assessment.id, entries);
      await queryClient.invalidateQueries({ queryKey: ["teacher-gradebook-assessment", sessionKey, detail.assessment.id] });
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const maxScore = Number(form.maxScore.replace(",", "."));
    if (!form.classId || !form.courseId || !form.termId || !form.title.trim() || !form.heldOn) {
      setFormError("Sınıf, ders, dönem, başlık ve tarih zorunludur.");
      return;
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore >= 1000) {
      setFormError("Tam puan 0'dan büyük ve 1000'den küçük olmalı.");
      return;
    }
    setBusy(true);
    try {
      const created = await createGradeAssessment(accessToken, {
        classId: form.classId,
        courseId: form.courseId,
        termId: form.termId,
        kind: form.kind,
        title: form.title.trim(),
        heldOn: form.heldOn,
        maxScore,
      });
      await queryClient.invalidateQueries({ queryKey: ["teacher-gradebook", sessionKey] });
      setIsFormOpen(false);
      setSelectedId(created.id);
      setPublishMessage("");
    } catch {
      setFormError("Değerlendirme oluşturulamadı. Atandığın sınıf ve dersi seçip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!detail) return;
    const isCorrection = Boolean(detail.assessment.publishedVersion);
    const confirmed = await confirm({
      confirmLabel: isCorrection ? "Düzeltmeyi yayınla" : "Yayınla",
      confirmVariant: "primary",
      description: "Yayınlanan not veliye görünür; sonradan düzeltme yeni sürüm olarak kaydedilir.",
      message: (
        <span>
          <strong>Değerlendirme:</strong> {detail.assessment.title}<br />
          <strong>Sınıf:</strong> {classNames.get(detail.assessment.classId) ?? "-"}<br />
          <strong>Yayınlanacak taslak:</strong> {detail.entries.filter((entry) => !entry.publishedAt).length}
        </span>
      ),
      title: isCorrection ? "Düzeltmeyi yayınla" : "Notları yayınla",
    });
    if (!confirmed) return;
    // Same key on retry after a network error, so the server publishes at most once.
    const request = publishRequest.current?.id === detail.assessment.id ? publishRequest.current : { id: detail.assessment.id, key: crypto.randomUUID() };
    publishRequest.current = request;
    setBusy(true);
    try {
      const result = await publishGradeAssessment(accessToken, detail.assessment.id, request.key);
      publishRequest.current = null;
      setPublishMessage(`${result.publishedCount} not yayınlandı (v${result.assessment.publishedVersion}).`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teacher-gradebook", sessionKey] }),
        queryClient.invalidateQueries({ queryKey: ["teacher-gradebook-assessment", sessionKey, detail.assessment.id] }),
      ]);
    } catch {
      setPublishMessage("Notlar yayınlanamadı. Yayınlanacak taslak olduğundan emin olup tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  const openForm = () => { setForm(emptyForm); setFormError(""); setIsFormOpen(true); };
  const hasDrafts = Boolean(detail?.entries.some((entry) => !entry.publishedAt));

  return (
    <PortalFrame title="Öğretmen Portalı" subtitle="Atandığın sınıf ve derslerin yazılı, performans ve proje notları">
      <Panel
        actions={scopes.length > 0 ? (
          <Button onClick={openForm}>
            <Plus size={17} aria-hidden="true" />
            Değerlendirme oluştur
          </Button>
        ) : undefined}
        aria-label="Öğretmen not girişi"
        description="Atandığın sınıf ve ders için değerlendirme oluştur, notları gir ve yayınla. Yayınlanan not değişmez, düzeltme yeni sürüm olur."
        title="Not defteri"
      >
        {assessmentsQuery.isError ? <p className="next-field-hint" role="alert">Değerlendirmeler alınamadı.</p> : null}
        {!assessmentsQuery.isPending && assessments.length === 0 ? (
          <EmptyState
            title="Henüz değerlendirme yok"
            description={scopes.length > 0
              ? "Atandığın sınıf ve ders için “Değerlendirme oluştur” ile ilk yazılı, performans ya da projeyi tanımla."
              : "Sınıf veya branş öğretmeni olarak atandığın bir sınıf bulunmuyor."}
          />
        ) : (
          <Field label="Değerlendirme">
            <Select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setPublishMessage(""); }}>
              <option value="">Seçin</option>
              {assessments.map((record) => (
                <option key={record.id} value={record.id}>
                  {`${record.title} · ${classNames.get(record.classId) ?? "-"} · ${courseNames.get(record.courseId) ?? "-"} · ${gradeKindLabels[record.kind]}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {detail ? (
          <>
            <div className="next-form-actions">
              <Button disabled={busy || !hasDrafts} onClick={() => void publish()}>
                {detail.assessment.publishedVersion ? "Düzeltmeyi yayınla" : "Yayınla"}
              </Button>
            </div>
            {publishMessage ? <p className="next-field-hint" role="status">{publishMessage}</p> : null}
            <GradeEntryGrid canEdit detail={detail} onSave={save} saving={busy} students={students} />
          </>
        ) : null}
      </Panel>
      <FormModal
        onCancel={() => setIsFormOpen(false)}
        onClose={() => setIsFormOpen(false)}
        onSubmit={(event) => void submitForm(event)}
        open={isFormOpen}
        submitDisabled={busy}
        submitError={formError || undefined}
        submitLabel="Oluştur"
        submitting={busy}
        title="Değerlendirme oluştur"
      >
        <Field label="Sınıf">
          <Select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value, courseId: "", termId: "" })}>
            <option value="">Seçin</option>
            {options.classes.map((id) => <option key={id} value={id}>{classNames.get(id) ?? id}</option>)}
          </Select>
        </Field>
        <Field label="Ders">
          <Select disabled={!form.classId} value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value, termId: "" })}>
            <option value="">Seçin</option>
            {options.courses.map((record) => <option key={record.id} value={record.id}>{formatCourseName(record.name)}</option>)}
          </Select>
        </Field>
        <Field label="Dönem">
          <Select disabled={!form.courseId} value={form.termId} onChange={(event) => setForm({ ...form, termId: event.target.value })}>
            <option value="">Seçin</option>
            {options.terms.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
          </Select>
        </Field>
        <Field label="Tür">
          <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as GradeAssessmentKind })}>
            {Object.entries(gradeKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Başlık">
          <Input maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Tarih">
          <Input type="date" value={form.heldOn} onChange={(event) => setForm({ ...form, heldOn: event.target.value })} />
        </Field>
        <Field label="Tam puan">
          <Input inputMode="decimal" value={form.maxScore} onChange={(event) => setForm({ ...form, maxScore: event.target.value })} />
        </Field>
      </FormModal>
      {confirmationDialog}
    </PortalFrame>
  );
}

/** Class → course → term options from the teacher's authoring scopes; a scope without course/term covers all of them. */
function authoringOptions(scopes: readonly TeacherAuthoringScope[], lookups: TeacherPortalLookupsResponse | undefined, form: AssessmentForm) {
  const forClass = scopes.filter((scope) => scope.classId === form.classId);
  const forCourse = forClass.filter((scope) => !scope.courseId || scope.courseId === form.courseId);
  const courses = lookups?.courses ?? [];
  const terms = lookups?.terms ?? [];
  return {
    classes: [...new Set(scopes.map((scope) => scope.classId))],
    courses: forClass.some((scope) => !scope.courseId) ? courses : courses.filter((course) => forClass.some((scope) => scope.courseId === course.id)),
    terms: forCourse.some((scope) => !scope.termId) ? terms : terms.filter((term) => forCourse.some((scope) => scope.termId === term.id)),
  };
}
