"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Field, Panel, Select, type DataTableColumn } from "@o-okul/ui";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  HomeworkSubmissionRecord,
  HomeworkSubmissionStatus,
  StudentHomeworkRecord,
  StudentRecord,
} from "@o-okul/shared-types";

const submissionStatusLabels: Record<HomeworkSubmissionStatus, string> = {
  NOT_SUBMITTED: "Teslim edilmedi",
  SUBMITTED: "Teslim edildi",
  CHECKED: "Kontrol edildi",
};

/** DEC-20261004-10: the student marks a class homework as handed in; no file is attached. */
export function StudentClassHomeworkPanel({
  homework,
  onSubmit,
  readOnly = false,
}: {
  homework: StudentHomeworkRecord[];
  onSubmit?(homeworkId: string): Promise<unknown>;
  readOnly?: boolean;
}) {
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");

  async function submit(homeworkId: string) {
    if (!onSubmit) return;
    setError("");
    setPendingId(homeworkId);
    try {
      await onSubmit(homeworkId);
    } catch (caught) {
      setError(
        (caught as { status?: number }).status === 409
          ? "Ödev kontrol edildiği için teslim işareti değiştirilemez."
          : "Teslim işareti kaydedilemedi.",
      );
    } finally {
      setPendingId("");
    }
  }

  const columns: Array<DataTableColumn<StudentHomeworkRecord>> = [
    { header: "Ödev", key: "title", priority: "primary", render: (record) => record.title, sticky: "left" },
    {
      // Öğretmenin yazdığı açıklama ve materyal öğrenciye görünür; telefonda detay satırına iner.
      header: "Açıklama",
      key: "description",
      priority: "optional",
      render: (record) => [record.sourceMaterialTitle, record.description].filter(Boolean).join(" · ") || "-",
    },
    { header: "Son tarih", key: "dueAt", priority: "secondary", render: (record) => (record.dueAt ? formatDateTime(record.dueAt) : "-") },
    { header: "Durum", key: "status", priority: "primary", render: (record) => submissionStatusLabels[record.submission.status] },
    {
      header: "İşlem",
      key: "action",
      priority: "primary",
      render: (record) =>
        readOnly || !onSubmit ? (
          "Yalnızca görüntüleme"
        ) : record.submission.status === "NOT_SUBMITTED" ? (
          <Button disabled={pendingId === record.id} onClick={() => void submit(record.id)} variant="secondary">
            Teslim ettim
          </Button>
        ) : (
          "-"
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel aria-label="Sınıf ödevleri" description="Sınıfınıza verilen ödevler ve teslim durumunuz." title="Sınıf Ödevleri">
      {error ? <p className="next-form-error" role="alert">{error}</p> : null}
      <DataTable
        caption="Sınıf ödevleri ve teslim durumu"
        columns={columns}
        description="Sınıfınıza verilen ödevler ve teslim durumunuz."
        density="compact"
        emptyText="Sınıfınıza verilmiş ödev yok."
        getRowKey={(record) => record.id}
        rows={homework}
      />
    </Panel>
  );
}

/** Teacher view of one homework: each student of the class with a derived status; checking is one-way and needs a submission. */
export function TeacherHomeworkSubmissionsPanel({
  classNames,
  homework,
  loadSubmissions,
  onCheck,
  onSelectHomework,
  readOnly = false,
  selectedHomeworkId,
  students,
}: {
  classNames: ReadonlyMap<string, string>;
  homework: HomeworkRecord[];
  loadSubmissions(homeworkId: string): Promise<HomeworkSubmissionRecord[]>;
  onCheck(homeworkId: string, studentIds: string[]): Promise<unknown>;
  /** Verildiğinde seçim üst bileşendedir; Ödev Kontrolü tablosundan yapılan seçim burada açılır. */
  onSelectHomework?(homeworkId: string): void;
  readOnly?: boolean;
  selectedHomeworkId?: string;
  students: StudentRecord[];
}) {
  const [localSelectedId, setLocalSelectedId] = useState("");
  const [error, setError] = useState("");
  const homeworkId = resolveSubmissionHomeworkId(homework, selectedHomeworkId ?? localSelectedId);
  const selectHomework = onSelectHomework ?? setLocalSelectedId;
  const query = useQuery({
    queryKey: ["teacher-homework-submissions", homeworkId],
    queryFn: () => loadSubmissions(homeworkId),
    enabled: Boolean(homeworkId),
    refetchOnWindowFocus: false,
  });
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  // UAT U19: teslim listesi öğrenci adına göre Türkçe sıralanır; adı bilinmeyen satırlar sona düşer.
  const rows = sortSubmissionsByStudentName(query.data ?? [], studentNameById);
  const selectedHomework = homework.find((record) => record.id === homeworkId);
  const overdue = isHomeworkOverdue(selectedHomework);
  const submittedIds = rows.filter((row) => row.status === "SUBMITTED").map((row) => row.studentId);

  async function check(studentIds: string[]) {
    setError("");
    try {
      await onCheck(homeworkId, studentIds);
      await query.refetch();
    } catch (caught) {
      if ((caught as { code?: string }).code === "HOMEWORK_SUBMISSION_NOT_SUBMITTED") {
        setError("Teslim etmemiş öğrenci kontrol edilemez; liste yenilendi.");
        await query.refetch();
        return;
      }
      setError("Kontrol kaydedilemedi.");
    }
  }

  const columns: Array<DataTableColumn<HomeworkSubmissionRecord>> = [
    {
      header: "Öğrenci",
      key: "student",
      priority: "primary",
      render: (row) => studentNameById.get(row.studentId) ?? "Bilinmeyen öğrenci",
      sticky: "left",
    },
    { header: "Durum", key: "status", priority: "primary", render: (row) => formatSubmissionStatus(row.status, overdue) },
    { header: "Teslim", key: "submittedAt", priority: "secondary", render: (row) => (row.submittedAt ? formatDateTime(row.submittedAt) : "-") },
    {
      header: "İşlem",
      key: "action",
      priority: "primary",
      render: (row) =>
        readOnly ? (
          "Yalnızca görüntüleme"
        ) : row.status === "CHECKED" ? (
          "-"
        ) : (
          <Button
            disabled={row.status === "NOT_SUBMITTED"}
            onClick={() => void check([row.studentId])}
            title={row.status === "NOT_SUBMITTED" ? "Öğrenci teslim etmeden kontrol edilemez." : undefined}
            variant="secondary"
          >
            Kontrol et
          </Button>
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel
      aria-label="Ödev teslim durumu"
      description="Seçili ödevde öğrenci bazında teslim ve kontrol durumu."
      id="portal-teacher-homework-submissions"
      title="Teslim Durumu"
    >
      <Field label="Ödev">
        <Select value={homeworkId} onChange={(event) => selectHomework(event.target.value)}>
          {homework.map((record) => <option key={record.id} value={record.id}>{formatHomeworkOption(record, classNames)}</option>)}
        </Select>
      </Field>
      {!readOnly && submittedIds.length > 0 ? (
        <Button onClick={() => void check(submittedIds)} variant="secondary">
          Teslim edenlerin hepsini kontrol et ({submittedIds.length})
        </Button>
      ) : null}
      {error || query.isError ? <p className="next-form-error" role="alert">{error || "Teslim durumu alınamadı."}</p> : null}
      <DataTable
        caption="Öğrenci teslim durumları"
        columns={columns}
        description="Seçili ödevde öğrenci bazında teslim ve kontrol durumu."
        density="compact"
        emptyText="Bu ödev için listelenecek öğrenci yok."
        getRowKey={(row) => row.studentId}
        rows={rows}
      />
    </Panel>
  );
}

/**
 * DEC-20261103-01 veli görünümü: bağlı öğrencinin sınıf ödevleri (öğrencinin teslim durumuyla) ve materyal atamaları
 * tek salt okunur tabloda. Öğretmenin kontrol notu veya puanı API'den gelmez; burada da yazılmaz. Açık işler
 * (teslim edilmemiş sınıf ödevi + materyal ataması) teslim tarihine göre önce, teslim edilenler sonra gelir.
 */
export function GuardianHomeworkPanel({
  classHomework,
  classHomeworkFailed = false,
  courseNames,
  limit,
  materialAssignments,
  materialAssignmentsFailed = false,
  moreHref,
  now = new Date(),
  onRetry,
  termNames,
}: {
  classHomework: readonly StudentHomeworkRecord[];
  classHomeworkFailed?: boolean;
  courseNames: ReadonlyMap<string, string>;
  /** Portal özetinde yalnız ilk N kayıt; tamamı moreHref ile Ödevler sayfasında. */
  limit?: number;
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[];
  materialAssignmentsFailed?: boolean;
  moreHref?: string;
  now?: Date;
  onRetry?: () => void;
  termNames: ReadonlyMap<string, string>;
}) {
  const rows = buildGuardianHomeworkRows({ classHomework, courseNames, materialAssignments, now, termNames });
  const visibleRows = limit ? rows.slice(0, limit) : rows;
  const hiddenCount = rows.length - visibleRows.length;
  const failedSources = [classHomeworkFailed ? "sınıf ödevleri" : "", materialAssignmentsFailed ? "materyal atamaları" : ""].filter(Boolean);
  const columns: Array<DataTableColumn<GuardianHomeworkRow>> = [
    { header: "Ödev", key: "title", priority: "primary", render: (row) => row.title, sticky: "left" },
    { header: "Bağlam", key: "context", priority: "primary", render: (row) => row.context },
    { header: "Açıklama", key: "description", priority: "optional", render: (row) => row.description },
    { header: "Son tarih", key: "dueAt", priority: "secondary", render: (row) => (row.dueAt ? formatDateTime(row.dueAt) : "-") },
    { header: "Durum", key: "status", priority: "primary", render: (row) => row.statusLabel },
  ];

  return (
    <Panel
      actions={moreHref && hiddenCount > 0 ? <Link href={moreHref}>Tümünü aç ({rows.length})</Link> : undefined}
      aria-label="Ödevler"
      description={hiddenCount > 0
        ? `İlk ${visibleRows.length} kayıt; ${hiddenCount} kayıt daha Ödevler sayfasında.`
        : "Sınıf ödevleri öğrencinin teslim durumuyla, materyal atamaları ders ve dönem bağlamıyla; salt okunur."}
      title="Ödevler"
    >
      {failedSources.length > 0 ? (
        <div role="alert">
          <p className="next-form-error">{`${capitalizeTr(failedSources.join(" ve "))} şu an alınamadı; liste eksik olabilir.`}</p>
          {onRetry ? <Button onClick={onRetry} variant="secondary">Tekrar dene</Button> : null}
        </div>
      ) : null}
      <DataTable
        caption="Sınıf ödevleri ve materyal atamaları"
        columns={columns}
        description="Sınıf ödevleri öğrencinin teslim durumuyla, materyal atamaları ders ve dönem bağlamıyla."
        emptyText="Ödev veya materyal ataması yok."
        getRowKey={(row) => row.key}
        rows={visibleRows}
      />
    </Panel>
  );
}

export interface GuardianHomeworkRow {
  key: string;
  kind: "class" | "material";
  title: string;
  context: string;
  description: string;
  dueAt?: string;
  open: boolean;
  statusLabel: string;
}

/** Açık iş sayısı (portal özeti "Ödev N açık"): teslim edilmemiş sınıf ödevi + materyal ataması. */
export function countOpenGuardianHomework(
  classHomework: readonly StudentHomeworkRecord[],
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[],
) {
  return classHomework.filter((record) => record.submission.status === "NOT_SUBMITTED").length + materialAssignments.length;
}

export function buildGuardianHomeworkRows({
  classHomework,
  courseNames,
  materialAssignments,
  now = new Date(),
  termNames,
}: {
  classHomework: readonly StudentHomeworkRecord[];
  courseNames: ReadonlyMap<string, string>;
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[];
  now?: Date;
  termNames: ReadonlyMap<string, string>;
}): GuardianHomeworkRow[] {
  const rows: GuardianHomeworkRow[] = [
    ...classHomework.map((record): GuardianHomeworkRow => ({
      context: "Sınıf ödevi",
      description: [record.sourceMaterialTitle, record.description].filter(Boolean).join(" · ") || "-",
      ...(record.dueAt ? { dueAt: record.dueAt } : {}),
      key: `class-${record.id}`,
      kind: "class",
      open: record.submission.status === "NOT_SUBMITTED",
      statusLabel: formatSubmissionStatus(record.submission.status, isHomeworkOverdue(record, now)),
      title: record.title,
    })),
    ...materialAssignments.map((assignment): GuardianHomeworkRow => ({
      context: formatMaterialContext(assignment, courseNames, termNames),
      description: assignment.note ?? "-",
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
      key: `material-${assignment.id}`,
      kind: "material",
      open: true,
      statusLabel: "Atandı",
      title: assignment.materialTitle ?? "Bilinmeyen materyal",
    })),
  ];
  return rows.sort((left, right) => Number(right.open) - Number(left.open) || compareOptionalDue(left.dueAt, right.dueAt));
}

function formatMaterialContext(
  assignment: Pick<HomeworkMaterialAssignmentRecord, "courseId" | "termId">,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  const context = formatAssignmentContext(assignment, courseNames, termNames);
  return context === "-" ? "Materyal ataması" : context;
}

function compareOptionalDue(left: string | undefined, right: string | undefined) {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  return right ? 1 : 0;
}

function capitalizeTr(value: string) {
  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}

export function HomeworkAssignmentsPanel({
  assignments,
  courseNames,
  limit,
  moreHref,
  termNames,
}: {
  assignments: HomeworkMaterialAssignmentRecord[];
  courseNames: ReadonlyMap<string, string>;
  /** Portal özetinde yalnız ilk N kayıt; tamamı moreHref ile alt sayfada (UI/UX F7). */
  limit?: number;
  moreHref?: string;
  termNames: ReadonlyMap<string, string>;
}) {
  const visibleAssignments = limit ? assignments.slice(0, limit) : assignments;
  const hiddenCount = assignments.length - visibleAssignments.length;
  const columns: Array<DataTableColumn<HomeworkMaterialAssignmentRecord>> = [
    {
      header: "Materyal",
      key: "material",
      priority: "primary",
      render: (assignment) => assignment.materialTitle ?? "Bilinmeyen materyal",
      sticky: "left",
    },
    {
      header: "Bağlam",
      key: "context",
      priority: "primary",
      render: (assignment) => formatAssignmentContext(assignment, courseNames, termNames),
    },
    {
      header: "Not",
      key: "note",
      priority: "optional",
      render: (assignment) => assignment.note ?? "-",
    },
    {
      header: "Teslim",
      key: "dueAt",
      priority: "secondary",
      render: (assignment) => (assignment.dueAt ? formatDateTime(assignment.dueAt) : "-"),
    },
  ];

  return (
    <Panel
      actions={moreHref && hiddenCount > 0 ? <Link href={moreHref}>Tümünü aç ({assignments.length})</Link> : undefined}
      aria-label="Ödevler"
      description={hiddenCount > 0 ? `Son ${visibleAssignments.length} atama; ${hiddenCount} atama daha Ödevler sayfasında.` : "Öğrenciye atanmış materyal, ders ve dönem bağlamı."}
      title="Ödevler"
    >
      <DataTable
        caption="Ödev ve materyal atamaları"
        columns={columns}
        description="Öğrenciye atanmış materyal, ders ve dönem bağlamı."
        emptyText="Ödev ataması yok."
        getRowKey={(assignment) => assignment.id}
        rows={visibleAssignments}
      />
    </Panel>
  );
}

export function TeacherHomeworkPanel({
  classNames,
  homework,
  onSelect,
  onToggle,
  readOnly = false,
  selectedHomeworkId,
}: {
  classNames: ReadonlyMap<string, string>;
  homework: HomeworkRecord[];
  /** Ödev başlığına dokunulunca Teslim Durumu paneli bu ödevle açılır. */
  onSelect?(homework: HomeworkRecord): void;
  onToggle(homework: HomeworkRecord): void;
  readOnly?: boolean;
  selectedHomeworkId?: string;
}) {
  const columns: Array<DataTableColumn<HomeworkRecord>> = [
    {
      header: "Ödev",
      key: "title",
      priority: "primary",
      render: (record) =>
        onSelect ? (
          <Button
            aria-pressed={record.id === selectedHomeworkId}
            className="next-homework-select"
            onClick={() => onSelect(record)}
            variant="ghost"
          >
            {record.title}
          </Button>
        ) : (
          record.title
        ),
      sticky: "left",
    },
    {
      header: "Sınıf",
      key: "class",
      priority: "primary",
      render: (record) => classNames.get(record.classId) ?? "Sınıf bilgisi yok",
    },
    {
      header: "Materyal",
      key: "material",
      priority: "secondary",
      render: (record) => record.sourceMaterialTitle ?? "-",
    },
    {
      header: "Teslim",
      key: "dueAt",
      priority: "secondary",
      render: (record) => (record.dueAt ? formatDateTime(record.dueAt) : "-"),
    },
    {
      header: "Durum",
      key: "status",
      priority: "primary",
      // UAT U19: teslim tarihi geçmiş ve kontrol edilmemiş ödev "Bekliyor" değil "Süresi geçti" görünür.
      render: (record) => formatTeacherHomeworkStatus(record),
    },
    {
      header: "İşlem",
      key: "action",
      priority: "primary",
      render: (record) =>
        readOnly ? (
          "Yalnızca görüntüleme"
        ) : (
          <Button onClick={() => onToggle(record)} variant="secondary">
            {record.checkedAt ? "Bekliyor yap" : "Kontrol et"}
          </Button>
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel
      aria-label="Öğretmen ödev kontrolü"
      description={onSelect ? "Ödev başlığına dokunun; öğrenci teslimleri Teslim Durumu bölümünde açılır." : "Ödev kontrol durumları ve öğretmen aksiyonları."}
      title="Ödev Kontrolü"
    >
      <DataTable
        caption="Öğretmen ödev kontrol kayıtları"
        columns={columns}
        description="Ödev kontrol durumları ve öğretmen aksiyonları."
        density="compact"
        emptyText="Kontrol edilecek ödev yok."
        getRowKey={(record) => record.id}
        rowClassName={(record) => (record.id === selectedHomeworkId ? "next-homework-row--selected" : undefined)}
        rows={homework}
      />
    </Panel>
  );
}

export function TeacherMaterialAssignmentsPanel({
  assignments,
  courseNames,
  materials,
  students,
  termNames,
}: {
  assignments: HomeworkMaterialAssignmentRecord[];
  courseNames: ReadonlyMap<string, string>;
  materials: HomeworkMaterialRecord[];
  students: StudentRecord[];
  termNames: ReadonlyMap<string, string>;
}) {
  const materialTitleById = new Map(materials.map((material) => [material.id, material.title]));
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const columns: Array<DataTableColumn<HomeworkMaterialAssignmentRecord>> = [
    {
      header: "Öğrenci",
      key: "student",
      priority: "primary",
      render: (assignment) => studentNameById.get(assignment.studentId) ?? "Bilinmeyen öğrenci",
      sticky: "left",
    },
    {
      header: "Materyal",
      key: "material",
      priority: "primary",
      render: (assignment) => materialTitleById.get(assignment.materialId) ?? "Bilinmeyen materyal",
    },
    {
      header: "Branş",
      key: "course",
      priority: "secondary",
      render: (assignment) => (assignment.courseId ? courseNames.get(assignment.courseId) ?? "Ders bilgisi yok" : "-"),
    },
    {
      header: "Dönem",
      key: "term",
      priority: "secondary",
      render: (assignment) => (assignment.termId ? termNames.get(assignment.termId) ?? "Dönem bilgisi yok" : "-"),
    },
    {
      header: "Not",
      key: "note",
      priority: "optional",
      render: (assignment) => assignment.note ?? "-",
    },
    {
      header: "Teslim",
      key: "dueAt",
      priority: "secondary",
      render: (assignment) => (assignment.dueAt ? formatDateTime(assignment.dueAt) : "-"),
    },
  ];

  return (
    <Panel
      aria-label="Öğretmen materyal atamaları"
      description="Seçili öğrenci için atanmış materyal ve ders-dönem bağlamı."
      title="Materyal Atamaları"
    >
      <DataTable
        caption="Öğretmen materyal atamaları"
        columns={columns}
        description="Seçili öğrenci için atanmış materyal ve ders-dönem bağlamı."
        density="compact"
        emptyText="Materyal ataması yok."
        getRowKey={(assignment) => assignment.id}
        rows={assignments}
      />
    </Panel>
  );
}

function formatAssignmentContext(
  assignment: Pick<HomeworkMaterialAssignmentRecord, "courseId" | "termId">,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  const parts = [
    assignment.courseId ? courseNames.get(assignment.courseId) ?? "Ders bilgisi yok" : undefined,
    assignment.termId ? termNames.get(assignment.termId) ?? "Dönem bilgisi yok" : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : "-";
}

/** Seçim yoksa ya da listeden düştüyse kontrol bekleyen ilk ödev, o da yoksa ilk ödev açılır. */
export function resolveSubmissionHomeworkId(homework: HomeworkRecord[], requestedId: string) {
  if (requestedId && homework.some((record) => record.id === requestedId)) return requestedId;
  return homework.find((record) => !record.checkedAt)?.id ?? homework[0]?.id ?? "";
}

/** Teslim tarihi geçmiş mi; tarihsiz ödev hiçbir zaman süresi geçmiş sayılmaz. */
export function isHomeworkOverdue(record: Pick<HomeworkRecord, "dueAt"> | undefined, now: Date = new Date()) {
  if (!record?.dueAt) return false;
  const due = new Date(record.dueAt).getTime();
  return Number.isFinite(due) && due < now.getTime();
}

export function formatTeacherHomeworkStatus(record: Pick<HomeworkRecord, "checkedAt" | "dueAt">, now: Date = new Date()) {
  if (record.checkedAt) return "Kontrol edildi";
  return isHomeworkOverdue(record, now) ? "Süresi geçti" : "Bekliyor";
}

/** Öğrenci teslim durumu; süresi geçmiş ödevde teslim edilmeyen satır bunu açıkça söyler. */
export function formatSubmissionStatus(status: HomeworkSubmissionStatus, overdue: boolean) {
  return status === "NOT_SUBMITTED" && overdue ? "Teslim edilmedi · süresi geçti" : submissionStatusLabels[status];
}

export function sortSubmissionsByStudentName(
  rows: readonly HomeworkSubmissionRecord[],
  studentNameById: ReadonlyMap<string, string>,
): HomeworkSubmissionRecord[] {
  return [...rows].sort((left, right) => {
    const leftName = studentNameById.get(left.studentId);
    const rightName = studentNameById.get(right.studentId);
    if (leftName && rightName) return leftName.localeCompare(rightName, "tr") || left.studentId.localeCompare(right.studentId);
    if (leftName) return -1;
    if (rightName) return 1;
    return left.studentId.localeCompare(right.studentId);
  });
}

function formatHomeworkOption(record: HomeworkRecord, classNames: ReadonlyMap<string, string>) {
  return `${record.title} · ${classNames.get(record.classId) ?? "Sınıf bilgisi yok"}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
