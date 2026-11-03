"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import type {
  AcademicTermRecord,
  AcademicYearRecord,
  ClassRecord,
  StudentBulkRenewConflictCode,
  StudentBulkRenewDryRunResult,
  TeacherAssignmentRole,
} from "@o-okul/shared-types";
import { Alert, Button, Checkbox, DataTable, Field, Input, MetricCard, MetricGrid, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import { academicTermFormSchema, academicYearFormSchema, firstFormError } from "../../../../src/form-validation.js";
import { formatDateKey } from "../../_shared/format.js";
import { createAcademicTerm, createAcademicYear, describeError, type TeacherClassAssignment } from "./term-transition-api.js";
import {
  graduateTarget,
  studentName,
  type PlannedStudent,
  type StudentAction,
  type StudentOverride,
  type TransitionPlan,
  type WizardState,
} from "./term-transition-plan.js";

const newRecord = "__yeni";

interface CalendarStepProps {
  accessToken: string;
  loading: boolean;
  onCreated(): void;
  onSelect(academicYearId: string, termId: string): void;
  state: WizardState;
  terms: AcademicTermRecord[];
  today: string;
  years: AcademicYearRecord[];
}

export function CalendarStep({ accessToken, loading, onCreated, onSelect, state, terms, today, years }: CalendarStepProps) {
  const [yearChoice, setYearChoice] = useState(state.academicYearId);
  const [termChoice, setTermChoice] = useState(state.termId);
  const [yearForm, setYearForm] = useState({ name: "", startsAt: "", endsAt: "" });
  const [termForm, setTermForm] = useState({ name: "", startsAt: "", endsAt: "" });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const effectiveYearChoice = yearChoice || (years.length === 0 && !loading ? newRecord : "");
  const creatingYear = effectiveYearChoice === newRecord;
  const yearTerms = terms.filter((term) => term.academicYearId === effectiveYearChoice);
  const creatingTerm = creatingYear || termChoice === newRecord;
  const selectedYear = years.find((year) => year.id === state.academicYearId);
  const selectedTerm = terms.find((term) => term.id === state.termId && term.academicYearId === state.academicYearId);
  const notStarted = Boolean(
    selectedYear && selectedTerm && (selectedYear.startsAt.slice(0, 10) > today || selectedTerm.startsAt.slice(0, 10) > today),
  );
  const selectedIsActive = Boolean(selectedYear?.isActive && selectedTerm?.isActive);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setError("");
    const parsedYear = creatingYear ? academicYearFormSchema.safeParse({ ...yearForm, isActive: false }) : undefined;
    if (parsedYear && !parsedYear.success) {
      setError(firstFormError(parsedYear.error));
      return;
    }
    const parsedTerm = academicTermFormSchema.safeParse({ ...termForm, academicYearId: creatingYear ? "yeni" : effectiveYearChoice, isActive: false });
    if (!parsedTerm.success) {
      setError(firstFormError(parsedTerm.error));
      return;
    }
    setIsSaving(true);
    try {
      const yearId = parsedYear?.success ? (await createAcademicYear(accessToken, parsedYear.data)).id : effectiveYearChoice;
      if (parsedYear?.success) setYearChoice(yearId);
      const term = await createAcademicTerm(accessToken, { ...parsedTerm.data, academicYearId: yearId });
      setTermChoice(term.id);
      onCreated();
      onSelect(yearId, term.id);
    } catch (caught) {
      setError(describeError(caught, "Yıl veya dönem kaydedilemedi. Bilgileri kontrol edip yeniden deneyin."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Panel
      aria-label="Yeni yıl ve dönem"
      as="form"
      description="Geçişin yapılacağı akademik yılı ve dönemi seçin ya da oluşturun. Seçtiğiniz yıl ve dönem, geçişin son adımında etkin dönem olur."
      onSubmit={(event) => void handleCreate(event)}
      title="Yeni yıl ve dönem"
    >
      <div className="next-onboarding-fields">
        <Field label="Akademik yıl">
          <Select
            disabled={loading}
            onChange={(event) => {
              const value = event.target.value;
              setYearChoice(value);
              setTermChoice("");
              setError("");
            }}
            value={effectiveYearChoice}
          >
            <option value="">Seçin</option>
            {years.map((year) => (
              <option key={year.id} value={year.id}>{`${year.name} (${formatDateKey(year.startsAt)} – ${formatDateKey(year.endsAt)})${year.isActive ? " · etkin" : ""}`}</option>
            ))}
            <option value={newRecord}>Yeni akademik yıl oluşturun</option>
          </Select>
        </Field>
        {creatingYear ? (
          <>
            <Field label="Yıl adı">
              <Input onChange={(event) => setYearForm({ ...yearForm, name: event.target.value })} placeholder="2026-2027" value={yearForm.name} />
            </Field>
            <Field label="Yıl başlangıcı">
              <Input onChange={(event) => setYearForm({ ...yearForm, startsAt: event.target.value })} type="date" value={yearForm.startsAt} />
            </Field>
            <Field label="Yıl bitişi">
              <Input onChange={(event) => setYearForm({ ...yearForm, endsAt: event.target.value })} type="date" value={yearForm.endsAt} />
            </Field>
          </>
        ) : null}
        {!creatingYear && effectiveYearChoice ? (
          <Field label="Dönem">
            <Select
              onChange={(event) => {
                const value = event.target.value;
                setTermChoice(value);
                setError("");
                if (value && value !== newRecord) onSelect(effectiveYearChoice, value);
              }}
              value={termChoice}
            >
              <option value="">Seçin</option>
              {yearTerms.map((term) => (
                <option key={term.id} value={term.id}>{`${term.name} (${formatDateKey(term.startsAt)} – ${formatDateKey(term.endsAt)})${term.isActive ? " · etkin" : ""}`}</option>
              ))}
              <option value={newRecord}>Yeni dönem oluşturun</option>
            </Select>
          </Field>
        ) : null}
        {creatingTerm ? (
          <>
            <Field label="Dönem adı">
              <Input onChange={(event) => setTermForm({ ...termForm, name: event.target.value })} placeholder="1. Dönem" value={termForm.name} />
            </Field>
            <Field label="Dönem başlangıcı">
              <Input onChange={(event) => setTermForm({ ...termForm, startsAt: event.target.value })} type="date" value={termForm.startsAt} />
            </Field>
            <Field label="Dönem bitişi">
              <Input onChange={(event) => setTermForm({ ...termForm, endsAt: event.target.value })} type="date" value={termForm.endsAt} />
            </Field>
            <div className="next-onboarding-actions">
              <Button disabled={isSaving} type="submit">{isSaving ? "Kaydediliyor…" : "Kaydedin ve seçin"}</Button>
            </div>
          </>
        ) : null}
        {error ? <p className="next-form-error" role="alert">{error}</p> : null}
        {selectedYear && selectedTerm ? (
          <Alert tone={notStarted ? "warning" : "info"} title={`Seçilen dönem: ${selectedYear.name} ${selectedTerm.name}`}>
            {notStarted
              ? `Bu dönem ${formatDateKey(selectedTerm.startsAt)} tarihinde başlıyor. Hazırlık adımlarını şimdi yapabilirsiniz; geçiş dönem başladıktan sonra uygulanır.`
              : selectedIsActive
                ? "Bu dönem şu anda etkin dönem. Geçiş, bu döneme kaydı olmayan öğrencilerin kaydını bu döneme taşır. Sonraki adımda sınıfları eşleştirin."
                : "Sonraki adımda sınıfları yeni döneme eşleştirin."}
          </Alert>
        ) : null}
      </div>
    </Panel>
  );
}

interface ClassMappingStepProps {
  classes: ClassRecord[];
  loading: boolean;
  onChange(classTargets: Record<string, string>): void;
  plan?: TransitionPlan;
  state: WizardState;
  /** The target year and term are the active ones: listed students simply have no enrollment in this term yet. */
  targetIsActive: boolean;
  targetName: string;
}

interface SourceClassRow {
  classId: string;
  name: string;
  studentCount: number;
}

export function ClassMappingStep({ classes, loading, onChange, plan, state, targetIsActive, targetName }: ClassMappingStepProps) {
  const classNames = classNameMap(classes);
  const sortedClasses = [...classes].sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  const rows: SourceClassRow[] = (plan?.sourceClassIds ?? [])
    .map((classId) => ({
      classId,
      name: classNames.get(classId) ?? "Sınıf bilgisi alınamadı",
      studentCount: plan?.candidates.filter((item) => item.student.classId === classId).length ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr-TR"));
  const columns: Array<DataTableColumn<SourceClassRow>> = [
    // U10: the source is the student's current class; it is last year's class only when the target is a new term.
    { header: "Mevcut sınıf", key: "source", mobilePriority: "primary", priority: "primary", render: (row) => row.name },
    { align: "right", header: "Öğrenci", key: "count", render: (row) => row.studentCount },
    {
      header: "Yeni dönemde",
      key: "target",
      render: (row) => (
        <Select
          aria-label={`${row.name} sınıfının yeni dönemdeki yeri`}
          onChange={(event) => onChange({ ...state.classTargets, [row.classId]: event.target.value })}
          value={state.classTargets[row.classId] ?? ""}
        >
          <option value="">Geçişe dahil değil</option>
          <option value={graduateTarget}>Mezun olacak</option>
          {sortedClasses.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <Panel
      aria-label="Sınıf eşleştirme"
      description="Her sınıfın öğrencilerinin yeni dönemde hangi sınıfa geçeceğini ya da mezun olacağını seçin. Geçişe dahil edilmeyen sınıfların öğrencileri değişmez."
      title="Sınıf eşleştirme"
    >
      {targetIsActive ? (
        <Alert tone="info" title={`Hedef dönem etkin dönem: ${targetName}`}>
          Listede bu döneme kaydı olmayan öğrencilerin mevcut sınıfları yer alır. Eşleştirdiğiniz sınıfların öğrencileri bu döneme kaydedilir.
        </Alert>
      ) : null}
      <DataTable
        caption="Sınıf eşleştirme listesi"
        columns={columns}
        density="compact"
        emptyText="Geçiş bekleyen aktif öğrenci bulunamadı."
        getRowKey={(row) => row.classId}
        loading={loading}
        rows={rows}
      />
      {plan && plan.alreadyInTerm.length > 0 ? (
        <Alert tone="info">{`${plan.alreadyInTerm.length} öğrencinin kaydı zaten bu dönemde; bu öğrenciler listede yer almaz.`}</Alert>
      ) : null}
      {plan && plan.classless.length > 0 ? (
        <Alert tone="warning">
          {`${plan.classless.length} aktif öğrencinin sınıfı yok; bu öğrenciler geçişe alınmaz. `}
          <Link href="/kurum/ogrenciler">Öğrenciler sayfasından sınıf atayabilirsiniz.</Link>
        </Alert>
      ) : null}
    </Panel>
  );
}

interface ExitReviewStepProps {
  classes: ClassRecord[];
  /** True while the confirmation in the address matches the current set of graduating and leaving students. */
  confirmed: boolean;
  loading: boolean;
  onConfirm(confirmed: boolean): void;
  onOverrides(overrides: Record<string, StudentOverride>): void;
  plan?: TransitionPlan;
  state: WizardState;
}

const actionLabels: Record<StudentAction, string> = {
  graduate: "Mezun olacak",
  leave: "Okuldan ayrılacak",
  renew: "Kaydı yenilenecek",
  skip: "Geçişe dahil değil",
};

export function ExitReviewStep({ classes, confirmed, loading, onConfirm, onOverrides, plan, state }: ExitReviewStepProps) {
  const [leaverChoice, setLeaverChoice] = useState("");
  // The address is the source of truth; the local copy keeps the box responsive until the address catches up.
  const [confirmedDraft, setConfirmedDraft] = useState(confirmed);
  const [syncedConfirmed, setSyncedConfirmed] = useState(confirmed);
  if (syncedConfirmed !== confirmed) {
    setSyncedConfirmed(confirmed);
    setConfirmedDraft(confirmed);
  }
  const classNames = classNameMap(classes);
  const rows = (plan?.candidates ?? []).filter((item) => item.action === "graduate" || item.action === "leave" || state.overrides[item.student.id]);
  const renewing = plan?.renew ?? [];
  const exitCount = (plan?.graduate.length ?? 0) + (plan?.leave.length ?? 0);

  function setAction(item: PlannedStudent, action: StudentAction) {
    const next = { ...state.overrides };
    const defaultAction = classDefaultAction(item, state);
    if (action === defaultAction) delete next[item.student.id];
    else if (action === "leave") next[item.student.id] = "A";
    else if (action === "skip") next[item.student.id] = "H";
    onOverrides(next);
  }

  const columns: Array<DataTableColumn<PlannedStudent>> = [
    { header: "Öğrenci", key: "student", mobilePriority: "primary", priority: "primary", render: (item) => studentName(item.student) },
    { header: "Öğrenci no", key: "studentNo", render: (item) => item.student.studentNo ?? "—" },
    { header: "Sınıf", key: "class", render: (item) => classNames.get(item.student.classId ?? "") ?? "—" },
    {
      header: "İşlem",
      key: "action",
      render: (item) => {
        const defaultAction = classDefaultAction(item, state);
        const options = [...new Set<StudentAction>([defaultAction, "leave", "skip"])];
        return (
          <Select aria-label={`${studentName(item.student)} için işlem`} onChange={(event) => setAction(item, event.target.value as StudentAction)} value={item.action}>
            {options.map((action) => <option key={action} value={action}>{actionLabels[action]}</option>)}
          </Select>
        );
      },
    },
  ];

  return (
    <Panel
      aria-label="Mezun ve ayrılanlar"
      description="Mezun olacak sınıfların öğrencileri ve okuldan ayrılacak öğrenciler burada listelenir. Kaydı yenilenecek bir öğrenciyi ayrılan olarak ekleyebilirsiniz."
      title="Mezun ve ayrılanlar"
    >
      <DataTable
        caption="Mezun ve ayrılan öğrenciler"
        columns={columns}
        density="compact"
        emptyText="Mezun veya ayrılan olarak işaretlenen öğrenci yok."
        getRowKey={(item) => item.student.id}
        loading={loading}
        rows={rows}
      />
      {renewing.length > 0 ? (
        <div className="next-onboarding-fields">
          <Field label="Ayrılacak öğrenci">
            <Select onChange={(event) => setLeaverChoice(event.target.value)} value={leaverChoice}>
              <option value="">Seçin</option>
              {[...renewing].sort(compareByName).map((item) => (
                <option key={item.student.id} value={item.student.id}>
                  {`${studentName(item.student)}${item.student.studentNo ? ` (${item.student.studentNo})` : ""}`}
                </option>
              ))}
            </Select>
          </Field>
          <div className="next-onboarding-actions">
            <Button
              disabled={!leaverChoice}
              onClick={() => {
                onOverrides({ ...state.overrides, [leaverChoice]: "A" });
                setLeaverChoice("");
              }}
              type="button"
              variant="secondary"
            >
              Ayrılan olarak ekleyin
            </Button>
          </div>
        </div>
      ) : null}
      {exitCount > 0 ? (
        <Checkbox
          checked={confirmedDraft}
          description="Öğrenci kayıtları ve geçmiş sonuçları silinmez; durum değişikliği sihirbazla geri alınamaz."
          label={`${plan?.graduate.length ?? 0} öğrencinin mezun, ${plan?.leave.length ?? 0} öğrencinin ayrılan olarak işaretleneceğini ve öğrenci portal erişimlerinin askıya alınacağını onaylıyorum.`}
          onChange={(event) => {
            setConfirmedDraft(event.target.checked);
            onConfirm(event.target.checked);
          }}
        />
      ) : null}
      {exitCount > 0 && state.confirmation && !confirmed ? (
        <Alert tone="warning">Mezun veya ayrılan öğrenci listesi onayınızdan sonra değişti. Listeyi kontrol edip yeniden onaylayın.</Alert>
      ) : null}
    </Panel>
  );
}

interface AssignmentStepProps {
  classes: ClassRecord[];
  error: boolean;
  loading: boolean;
  rows: TeacherClassAssignment[];
  targetTermId: string;
  terms: AcademicTermRecord[];
}

const assignmentRoleLabels: Record<TeacherAssignmentRole, string> = {
  BRANCH_TEACHER: "Branş öğretmeni",
  CLASS_TEACHER: "Sınıf öğretmeni",
  GUIDANCE_COUNSELOR: "Rehber öğretmen",
  RESPONSIBLE_TEACHER: "Sorumlu öğretmen",
};

export function AssignmentStep({ classes, error, loading, rows, targetTermId, terms }: AssignmentStepProps) {
  const classNames = classNameMap(classes);
  const termNames = new Map(terms.map((term) => [term.id, term.name]));
  const visible = rows.filter((row) => row.assignment.termId !== targetTermId);
  const columns: Array<DataTableColumn<TeacherClassAssignment>> = [
    { header: "Öğretmen", key: "teacher", mobilePriority: "primary", priority: "primary", render: (row) => `${row.teacher.firstName} ${row.teacher.lastName}` },
    { header: "Sınıf", key: "class", render: (row) => classNames.get(row.assignment.classId ?? "") ?? "—" },
    { header: "Görev", key: "role", render: (row) => assignmentRoleLabels[row.assignment.role] ?? row.assignment.role },
    { header: "Dönem", key: "term", render: (row) => (row.assignment.termId ? termNames.get(row.assignment.termId) ?? "—" : "Dönem belirtilmemiş") },
    {
      header: "Düzenleme",
      key: "edit",
      render: (row) => <Link href={`/kurum/ogretmenler/${encodeURIComponent(row.teacher.id)}`}>{`${row.teacher.firstName} ${row.teacher.lastName} atamalarını açın`}</Link>,
    },
  ];
  return (
    <Panel
      aria-label="Öğretmen atamaları"
      description="Sınıfa bağlı atamalar yeni dönemde de geçerli kalır. Sürdürülmeyecek atamalar için öğretmen sayfasından bitiş tarihi girmenizi öneririz; sihirbaz atamaları değiştirmez."
      title="Geçen yılın öğretmen atamaları"
    >
      <DataTable
        caption="Süren sınıf atamaları"
        columns={columns}
        density="compact"
        emptyText="Sonlandırılması gereken sınıf ataması yok."
        error={error ? "Öğretmen atamaları yüklenemedi." : undefined}
        getRowKey={(row) => row.assignment.id}
        loading={loading}
        rows={visible}
      />
    </Panel>
  );
}

interface PreviewStepProps {
  classes: ClassRecord[];
  error: string;
  loading: boolean;
  plan?: TransitionPlan;
  preview?: StudentBulkRenewDryRunResult;
  termStarted: boolean;
}

const conflictLabels: Record<StudentBulkRenewConflictCode, string> = {
  CLASS_NOT_FOUND: "Hedef sınıf bulunamadı",
  FORBIDDEN_TENANT: "Kuruma ait değil",
  GRADE_LEVEL_NOT_FOUND: "Seviye bulunamadı",
  STUDENT_CAMPUS_SCOPE_FORBIDDEN: "Yetkiniz dışındaki kampüs",
  STUDENT_CLASS_GRADE_LEVEL_MISMATCH: "Sınıf ile seviye uyuşmuyor",
  STUDENT_GRADE_LEVEL_REQUIRED: "Seviye bilgisi eksik",
  STUDENT_NOT_ACTIVE: "Öğrenci aktif değil",
};

interface PreviewRow {
  conflict?: StudentBulkRenewConflictCode;
  name: string;
  sourceClass: string;
  studentId: string;
  targetClass: string;
}

export function PreviewStep({ classes, error, loading, plan, preview, termStarted }: PreviewStepProps) {
  const classNames = classNameMap(classes);
  const students = new Map((plan?.renew ?? []).map((item) => [item.student.id, item.student]));
  // U11: the server answers in request (id) order; the list reads by name with Turkish collation.
  const rows: PreviewRow[] = (preview?.items ?? [])
    .map((item) => ({
      conflict: item.conflict,
      name: students.has(item.studentId) ? studentName(students.get(item.studentId)!) : "—",
      sourceClass: classNames.get(item.sourceClassId ?? "") ?? "—",
      studentId: item.studentId,
      targetClass: classNames.get(item.targetClassId ?? "") ?? "—",
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr-TR") || left.studentId.localeCompare(right.studentId));
  const conflictCount = preview?.conflictStudentIds.length ?? 0;
  const columns: Array<DataTableColumn<PreviewRow>> = [
    { header: "Öğrenci", key: "student", mobilePriority: "primary", priority: "primary", render: (row) => row.name },
    { header: "Mevcut sınıf", key: "source", render: (row) => row.sourceClass },
    { header: "Yeni dönem", key: "target", render: (row) => row.targetClass },
    {
      header: "Durum",
      key: "conflict",
      render: (row) => row.conflict
        ? <StatusBadge tone="danger">{conflictLabels[row.conflict] ?? "Çakışma"}</StatusBadge>
        : <StatusBadge tone="success">Hazır</StatusBadge>,
    },
  ];

  return (
    <Panel
      aria-label="Ön izleme"
      description="Uygulamadan önce yapılacak değişiklikleri kontrol edin. Bu adım hiçbir kaydı değiştirmez."
      title="Ön izleme"
    >
      <MetricGrid>
        <MetricCard label="Kaydı yenilenecek" value={plan?.renew.length ?? "—"} />
        <MetricCard label="Mezun olacak" value={plan?.graduate.length ?? "—"} />
        <MetricCard label="Ayrılacak" value={plan?.leave.length ?? "—"} />
        <MetricCard
          description={preview ? `Sınır ${preview.quota.limit}` : undefined}
          label="Lisanslı aktif öğrenci"
          tone={preview?.quota.wouldExceed ? "danger" : "default"}
          value={preview ? `${preview.quota.current + preview.quota.incoming}` : "—"}
        />
      </MetricGrid>
      {!termStarted ? <Alert tone="warning">Dönemin başlangıç tarihi gelmeden geçiş uygulanamaz.</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {preview?.quota.wouldExceed ? (
        <Alert tone="danger">{`Yenileme ${preview.quota.incoming} öğrenciyi lisans sayımına ekliyor ve ${preview.quota.limit} öğrenci sınırı aşılıyor.`}</Alert>
      ) : null}
      {conflictCount > 0 ? (
        <Alert tone="danger">{`${conflictCount} öğrenci için çakışma var. Sınıf eşleştirmesini düzeltin ya da bu öğrencileri geçişe dahil etmeyin.`}</Alert>
      ) : null}
      <DataTable
        caption="Kaydı yenilenecek öğrenciler"
        columns={columns}
        density="compact"
        emptyText="Kaydı yenilenecek öğrenci yok."
        getRowKey={(row) => row.studentId}
        loading={loading}
        rows={rows}
      />
    </Panel>
  );
}

function classDefaultAction(item: PlannedStudent, state: WizardState): StudentAction {
  const target = state.classTargets[item.student.classId ?? ""];
  if (!target) return "skip";
  return target === graduateTarget ? "graduate" : "renew";
}

/** U11: student lists of the wizard read by name with Turkish collation, the same order as the plan. */
function compareByName(left: PlannedStudent, right: PlannedStudent) {
  return studentName(left.student).localeCompare(studentName(right.student), "tr-TR") || left.student.id.localeCompare(right.student.id);
}

function classNameMap(classes: ClassRecord[]) {
  return new Map(classes.map((record) => [record.id, record.name]));
}
