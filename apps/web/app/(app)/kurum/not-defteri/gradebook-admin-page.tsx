"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  ClassRecord,
  CourseRecord,
  GradeAssessmentKind,
  GradeAssessmentRecord,
  StudentRecord,
} from "@o-okul/shared-types";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Panel,
  Select,
  StatusBadge,
  type DataTableColumn,
  useConfirmDialog,
} from "@o-okul/ui";
import { Plus } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest } from "../../../../src/api-client.js";
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

export function GradebookAdminPage() {
  const { auth } = useAuth();
  const accessToken = auth?.accessToken ?? "";
  const tenantKey = auth?.session.tenantId ?? "anonymous";
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<AssessmentForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishMessage, setPublishMessage] = useState("");
  const publishRequest = useRef<{ id: string; key: string } | null>(null);

  const assessmentsQuery = useQuery({
    queryKey: ["gradebook-assessments", tenantKey],
    queryFn: () => listGradeAssessments(accessToken),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["gradebook-references", tenantKey],
    queryFn: () => loadReferences(accessToken),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detailQuery = useQuery({
    queryKey: ["gradebook-assessment", tenantKey, selectedId],
    queryFn: () => loadGradeAssessment(accessToken, selectedId),
    enabled: Boolean(auth && selectedId),
    refetchOnWindowFocus: false,
  });
  const selectedClassId = detailQuery.data?.assessment.classId ?? "";
  const studentsQuery = useQuery({
    queryKey: ["gradebook-class-students", tenantKey, selectedClassId],
    queryFn: () => apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students?classId=${encodeURIComponent(selectedClassId)}`),
    enabled: Boolean(auth && selectedClassId),
    refetchOnWindowFocus: false,
  });

  const references = referencesQuery.data ?? { classes: [], courses: [], terms: [] };
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, formatCourseName(record.name)])), [references.courses]);
  const students = useMemo(
    () => (studentsQuery.data?.data ?? []).map((record) => ({ id: record.id, name: `${record.firstName} ${record.lastName}` })),
    [studentsQuery.data],
  );
  const selected = detailQuery.data;

  const columns: Array<DataTableColumn<GradeAssessmentRecord>> = [
    { key: "title", header: "Değerlendirme", priority: "primary", mobilePriority: "primary", render: (row) => row.title },
    { key: "class", header: "Sınıf", render: (row) => classNames.get(row.classId) ?? "-" },
    { key: "course", header: "Ders", render: (row) => courseNames.get(row.courseId) ?? "-" },
    { key: "kind", header: "Tür", mobilePriority: "secondary", render: (row) => gradeKindLabels[row.kind] },
    { key: "heldOn", header: "Tarih", mobilePriority: "secondary", render: (row) => formatDay(row.heldOn) },
    {
      key: "status",
      header: "Durum",
      render: (row) => row.publishedVersion
        ? <StatusBadge tone="success">{`Yayında v${row.publishedVersion}`}</StatusBadge>
        : <StatusBadge tone="warning">Yayınlanmadı</StatusBadge>,
    },
    {
      key: "actions",
      header: "İşlem",
      render: (row) => (
        <Button aria-label={`${row.title} notlarını aç`} onClick={() => { setSelectedId(row.id); setPublishMessage(""); }} size="sm" variant="secondary">
          Notları aç
        </Button>
      ),
    },
  ];

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
      await queryClient.invalidateQueries({ queryKey: ["gradebook-assessments", tenantKey] });
      setIsFormOpen(false);
      setForm(emptyForm);
      setSelectedId(created.id);
    } catch {
      setFormError("Değerlendirme oluşturulamadı. Seçimleri kontrol edip tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!selected) return;
    const draftCount = selected.entries.filter((entry) => !entry.publishedAt).length;
    const confirmed = await confirm({
      confirmLabel: "Yayınla",
      confirmVariant: "primary",
      description: "Yayınlanan not bir daha değiştirilemez ve silinemez. Düzeltme gerekirse yeni bir sürüm olarak yayınlanır; eski sürüm geçmişte kalır.",
      message: (
        <span>
          <strong>Değerlendirme:</strong> {selected.assessment.title}<br />
          <strong>Sınıf:</strong> {classNames.get(selected.assessment.classId) ?? "-"}<br />
          <strong>Yayınlanacak taslak:</strong> {draftCount}
        </span>
      ),
      title: "Notları yayınla",
    });
    if (!confirmed) return;
    // Same key on retry after a network error, so the server publishes at most once.
    const request = publishRequest.current?.id === selected.assessment.id ? publishRequest.current : { id: selected.assessment.id, key: crypto.randomUUID() };
    publishRequest.current = request;
    setBusy(true);
    try {
      const result = await publishGradeAssessment(accessToken, selected.assessment.id, request.key);
      publishRequest.current = null;
      setPublishMessage(`${result.publishedCount} not yayınlandı (v${result.assessment.publishedVersion}).`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["gradebook-assessments", tenantKey] }),
        queryClient.invalidateQueries({ queryKey: ["gradebook-assessment", tenantKey, selected.assessment.id] }),
      ]);
    } catch {
      setPublishMessage("Notlar yayınlanamadı. Yayınlanacak taslak olduğundan emin olup tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEntries(entries: Parameters<typeof saveGradeEntries>[2]) {
    if (!selected) return;
    setBusy(true);
    try {
      await saveGradeEntries(accessToken, selected.assessment.id, entries);
      await queryClient.invalidateQueries({ queryKey: ["gradebook-assessment", tenantKey, selected.assessment.id] });
    } finally {
      setBusy(false);
    }
  }

  const openForm = () => { setForm(emptyForm); setFormError(""); setIsFormOpen(true); };

  return (
    <>
      <CrudPage
        actions={(
          <Button onClick={openForm}>
            <Plus size={17} aria-hidden="true" />
            Değerlendirme ekle
          </Button>
        )}
        aria-label="Not defteri yönetimi"
        columns={columns}
        description="Yazılı, performans ve proje notlarını tanımla, girilen notları kontrol et ve yayınla. Deneme sonuçları bu ekranda değil, Sınavlar'dadır."
        emptyState={(
          <EmptyState
            title="Değerlendirme yok"
            description="Not girişi için önce sınıf, ders ve dönem seçerek bir değerlendirme tanımla."
            primaryAction={{ label: "Değerlendirme ekle", onClick: openForm }}
          />
        )}
        emptyText="Değerlendirme yok"
        error={assessmentsQuery.isError ? "Değerlendirmeler alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined}
        getRowKey={(row) => row.id}
        density="compact"
        loading={assessmentsQuery.isPending || referencesQuery.isPending}
        rows={assessmentsQuery.data ?? []}
        tableCaption="Not değerlendirmeleri"
        tableDescription="Sınıf, ders, tür, tarih ve yayın durumuyla değerlendirme listesi."
        title="Not defteri"
      />
      {selected ? (
        <Panel
          actions={(
            <Button disabled={busy || !selected.entries.some((entry) => !entry.publishedAt)} onClick={() => void publish()}>
              Yayınla
            </Button>
          )}
          aria-label="Değerlendirme notları"
          description={`${classNames.get(selected.assessment.classId) ?? "-"} · ${courseNames.get(selected.assessment.courseId) ?? "-"} · ${gradeKindLabels[selected.assessment.kind]} · ${formatDay(selected.assessment.heldOn)}`}
          title={selected.assessment.title}
        >
          {publishMessage ? <p className="next-field-hint" role="status">{publishMessage}</p> : null}
          <GradeEntryGrid canEdit detail={selected} onSave={saveEntries} saving={busy} students={students} />
        </Panel>
      ) : null}
      <FormModal
        onCancel={() => setIsFormOpen(false)}
        onClose={() => setIsFormOpen(false)}
        onSubmit={(event) => void submitForm(event)}
        open={isFormOpen}
        submitDisabled={busy}
        submitError={formError || undefined}
        submitLabel="Oluştur"
        submitting={busy}
        title="Değerlendirme ekle"
      >
        <Field label="Sınıf">
          <Select value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
            <option value="">Seçin</option>
            {references.classes.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
          </Select>
        </Field>
        <Field label="Ders">
          <Select value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}>
            <option value="">Seçin</option>
            {references.courses.map((record) => <option key={record.id} value={record.id}>{formatCourseName(record.name)}</option>)}
          </Select>
        </Field>
        <Field label="Dönem">
          <Select value={form.termId} onChange={(event) => setForm({ ...form, termId: event.target.value })}>
            <option value="">Seçin</option>
            {references.terms.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
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
    </>
  );
}

async function loadReferences(accessToken: string): Promise<{ classes: ClassRecord[]; courses: CourseRecord[]; terms: AcademicTermRecord[] }> {
  const [classes, courses, terms] = await Promise.all([
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { classes: classes.data, courses: courses.data, terms: terms.data };
}

function formatDay(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}
