"use client";

import { useState } from "react";
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
    <Panel aria-label="Sınıf ödevleri" description="Sınıfına verilen ödevler ve teslim durumun." title="Sınıf Ödevleri">
      {error ? <p className="next-form-error" role="alert">{error}</p> : null}
      <DataTable
        caption="Sınıf ödevleri ve teslim durumu"
        columns={columns}
        description="Sınıfına verilen ödevler ve teslim durumun."
        density="compact"
        emptyText="Sınıfına verilmiş ödev yok."
        getRowKey={(record) => record.id}
        rows={homework}
      />
    </Panel>
  );
}

/** Teacher view of one homework: each student of the class with a derived status; checking is one-way. */
export function TeacherHomeworkSubmissionsPanel({
  homework,
  loadSubmissions,
  onCheck,
  readOnly = false,
  students,
}: {
  homework: HomeworkRecord[];
  loadSubmissions(homeworkId: string): Promise<HomeworkSubmissionRecord[]>;
  onCheck(homeworkId: string, studentIds: string[]): Promise<unknown>;
  readOnly?: boolean;
  students: StudentRecord[];
}) {
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const homeworkId = selectedId || homework[0]?.id || "";
  const query = useQuery({
    queryKey: ["teacher-homework-submissions", homeworkId],
    queryFn: () => loadSubmissions(homeworkId),
    enabled: Boolean(homeworkId),
    refetchOnWindowFocus: false,
  });
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const rows = query.data ?? [];
  const submittedIds = rows.filter((row) => row.status === "SUBMITTED").map((row) => row.studentId);

  async function check(studentIds: string[]) {
    setError("");
    try {
      await onCheck(homeworkId, studentIds);
      await query.refetch();
    } catch {
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
    { header: "Durum", key: "status", priority: "primary", render: (row) => submissionStatusLabels[row.status] },
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
          <Button onClick={() => void check([row.studentId])} variant="secondary">
            Kontrol et
          </Button>
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel aria-label="Ödev teslim durumu" description="Seçili ödevde öğrenci bazında teslim ve kontrol durumu." title="Teslim Durumu">
      <Field label="Ödev">
        <Select value={homeworkId} onChange={(event) => setSelectedId(event.target.value)}>
          {homework.map((record) => <option key={record.id} value={record.id}>{record.title}</option>)}
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

export function HomeworkAssignmentsPanel({
  assignments,
  courseNames,
  termNames,
}: {
  assignments: HomeworkMaterialAssignmentRecord[];
  courseNames: ReadonlyMap<string, string>;
  termNames: ReadonlyMap<string, string>;
}) {
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
      aria-label="Ödevler"
      description="Öğrenciye atanmış materyal, ders ve dönem bağlamı."
      title="Ödevler"
    >
      <DataTable
        caption="Ödev ve materyal atamaları"
        columns={columns}
        description="Öğrenciye atanmış materyal, ders ve dönem bağlamı."
        emptyText="Ödev ataması yok."
        getRowKey={(assignment) => assignment.id}
        rows={assignments}
      />
    </Panel>
  );
}

export function TeacherHomeworkPanel({
  homework,
  onToggle,
  readOnly = false,
}: {
  homework: HomeworkRecord[];
  onToggle(homework: HomeworkRecord): void;
  readOnly?: boolean;
}) {
  const columns: Array<DataTableColumn<HomeworkRecord>> = [
    {
      header: "Ödev",
      key: "title",
      priority: "primary",
      render: (record) => record.title,
      sticky: "left",
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
      render: (record) => (record.checkedAt ? "Kontrol edildi" : "Bekliyor"),
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
      description="Ödev kontrol durumları ve öğretmen aksiyonları."
      title="Ödev Kontrolü"
    >
      <DataTable
        caption="Öğretmen ödev kontrol kayıtları"
        columns={columns}
        description="Ödev kontrol durumları ve öğretmen aksiyonları."
        density="compact"
        emptyText="Kontrol edilecek ödev yok."
        getRowKey={(record) => record.id}
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
