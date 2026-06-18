"use client";

import { DataTable, Panel, type DataTableColumn } from "@uzman-hocam/ui";
import type { AttendanceRecord, StudentRecord, TeacherNoteRecord } from "@uzman-hocam/shared-types";

export function AttendancePanel({ records }: { records: AttendanceRecord[] }) {
  const columns: Array<DataTableColumn<AttendanceRecord>> = [
    {
      header: "Tarih",
      key: "date",
      priority: "primary",
      render: (record) => record.date,
      sticky: "left",
    },
    {
      header: "Durum",
      key: "status",
      priority: "primary",
      render: (record) => formatAttendanceStatus(record.status),
    },
  ];

  return (
    <Panel
      aria-label="Devamsızlık"
      description="Öğrencinin portaldan görebildiği yoklama kayıtları."
      title="Devamsızlık"
    >
      <DataTable
        caption="Devamsızlık kayıtları"
        columns={columns}
        description="Öğrencinin portaldan görebildiği yoklama kayıtları."
        emptyText="Devamsızlık kaydı yok."
        getRowKey={(record) => record.id}
        rows={records}
      />
    </Panel>
  );
}

export function TeacherAttendancePanel({
  courseNames,
  records,
  students,
  termNames,
}: {
  courseNames: ReadonlyMap<string, string>;
  records: AttendanceRecord[];
  students: StudentRecord[];
  termNames: ReadonlyMap<string, string>;
}) {
  const studentNameById = new Map(students.map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const columns: Array<DataTableColumn<AttendanceRecord>> = [
    {
      header: "Öğrenci",
      key: "student",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => studentNameById.get(record.studentId) ?? "Bilinmeyen öğrenci",
      sticky: "left",
    },
    {
      header: "Branş",
      key: "course",
      mobilePriority: "secondary",
      priority: "primary",
      render: (record) => formatCourseLabel(record.courseId, courseNames),
    },
    {
      header: "Dönem",
      key: "term",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (record) => formatTermLabel(record.termId, termNames),
    },
    {
      header: "Tarih",
      key: "date",
      mobilePriority: "secondary",
      priority: "primary",
      render: (record) => record.date,
    },
    {
      header: "Durum",
      key: "status",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatAttendanceStatus(record.status),
    },
  ];

  return (
    <Panel
      aria-label="Öğretmen yoklama kayıtları"
      description="Öğretmenin kapsamındaki öğrenci, branş ve dönem yoklama kayıtları."
      title="Yoklama Kayıtları"
    >
      <DataTable
        caption="Öğretmen yoklama kayıtları"
        columns={columns}
        description="Öğretmenin kapsamındaki öğrenci, branş ve dönem yoklama kayıtları."
        density="compact"
        emptyText="Yoklama kaydı yok."
        getRowKey={(record) => record.id}
        rows={records}
      />
    </Panel>
  );
}

export function TeacherNotesPanel({
  courseNames,
  notes,
  students,
  termNames,
}: {
  courseNames?: ReadonlyMap<string, string>;
  notes: TeacherNoteRecord[];
  students?: StudentRecord[];
  termNames?: ReadonlyMap<string, string>;
}) {
  const studentNameById = new Map((students ?? []).map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const columns: Array<DataTableColumn<TeacherNoteRecord>> = [
    {
      header: students ? "Öğrenci" : "Bağlam",
      key: "student",
      mobilePriority: "primary",
      priority: "primary",
      render: (note) => formatTeacherNoteSubject(note, studentNameById, Boolean(students)),
      sticky: "left",
    },
    {
      header: "Branş",
      key: "course",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (note) => formatCourseLabel(note.courseId, courseNames),
    },
    {
      header: "Dönem",
      key: "term",
      mobilePriority: "hidden",
      priority: "optional",
      render: (note) => formatTermLabel(note.termId, termNames),
    },
    {
      header: "Not",
      key: "body",
      mobilePriority: "primary",
      priority: "primary",
      render: (note) => note.body,
    },
  ];

  return (
    <Panel
      aria-label="Öğretmen notları"
      description="Veli, öğrenci ve öğretmen portalında görünür gelişim notları."
      title="Öğretmen Notları"
    >
      <DataTable
        caption="Öğretmen notları"
        columns={columns}
        density="compact"
        description="Görünür gelişim notları, ders ve dönem bağlamıyla listelenir."
        emptyText="Görünür öğretmen notu yok."
        getRowKey={(note) => note.id}
        rows={notes}
      />
    </Panel>
  );
}

function formatAttendanceStatus(status: AttendanceRecord["status"]) {
  const labels: Record<AttendanceRecord["status"], string> = {
    ABSENT: "Yok",
    EXCUSED: "İzinli",
    LATE: "Geç",
    PRESENT: "Var",
  };
  return labels[status];
}

function formatTeacherNoteSubject(note: TeacherNoteRecord, studentNameById: ReadonlyMap<string, string>, hasStudentScope: boolean) {
  if (hasStudentScope && note.studentId) return studentNameById.get(note.studentId) ?? "Bilinmeyen öğrenci";
  return note.developmentStatus || "Not";
}

function formatCourseLabel(courseId: string | undefined, courseNames: ReadonlyMap<string, string> | undefined) {
  if (!courseId) return "Ders bilgisi yok";
  return courseNames?.get(courseId) ?? "Ders bilgisi yok";
}

function formatTermLabel(termId: string | undefined, termNames: ReadonlyMap<string, string> | undefined) {
  if (!termId) return "Dönem bilgisi yok";
  return termNames?.get(termId) ?? "Dönem bilgisi yok";
}
