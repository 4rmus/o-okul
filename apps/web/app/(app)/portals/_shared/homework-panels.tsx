"use client";

import { Button, DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  StudentRecord,
} from "@o-okul/shared-types";

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
