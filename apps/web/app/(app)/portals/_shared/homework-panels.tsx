"use client";

import { Button } from "@uzman-hocam/ui";
import type {
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  StudentRecord,
} from "@uzman-hocam/shared-types";

export function HomeworkAssignmentsPanel({
  assignments,
  courseNames,
  termNames,
}: {
  assignments: HomeworkMaterialAssignmentRecord[];
  courseNames: ReadonlyMap<string, string>;
  termNames: ReadonlyMap<string, string>;
}) {
  return (
    <section className="next-list-panel" aria-label="Ödevler">
      <h2>Ödevler</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Materyal</th>
            <th>Bağlam</th>
            <th>Not</th>
            <th>Teslim</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={assignment.id}>
              <td>{assignment.materialTitle ?? assignment.materialId}</td>
              <td>{formatAssignmentContext(assignment, courseNames, termNames)}</td>
              <td>{assignment.note ?? "-"}</td>
              <td>{assignment.dueAt ? formatDateTime(assignment.dueAt) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function TeacherHomeworkPanel({
  homework,
  onToggle,
}: {
  homework: HomeworkRecord[];
  onToggle(homework: HomeworkRecord): void;
}) {
  return (
    <section className="next-list-panel" aria-label="Öğretmen ödev kontrolü">
      <h2>Ödev Kontrolü</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Ödev</th>
            <th>Materyal</th>
            <th>Teslim</th>
            <th>Durum</th>
            <th>İşlem</th>
          </tr>
        </thead>
        <tbody>
          {homework.map((record) => (
            <tr key={record.id}>
              <td>{record.title}</td>
              <td>{record.sourceMaterialTitle ?? "-"}</td>
              <td>{record.dueAt ? formatDateTime(record.dueAt) : "-"}</td>
              <td>{record.checkedAt ? "Kontrol edildi" : "Bekliyor"}</td>
              <td>
                <Button onClick={() => onToggle(record)} variant="secondary">
                  {record.checkedAt ? "Bekliyor yap" : "Kontrol et"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
  return (
    <section className="next-list-panel" aria-label="Öğretmen materyal atamaları">
      <h2>Materyal Atamaları</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Öğrenci</th>
            <th>Materyal</th>
            <th>Branş</th>
            <th>Dönem</th>
            <th>Not</th>
            <th>Teslim</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((assignment) => (
            <tr key={assignment.id}>
              <td>{studentNameById.get(assignment.studentId) ?? assignment.studentId}</td>
              <td>{materialTitleById.get(assignment.materialId) ?? assignment.materialId}</td>
              <td>{assignment.courseId ? courseNames.get(assignment.courseId) ?? assignment.courseId : "-"}</td>
              <td>{assignment.termId ? termNames.get(assignment.termId) ?? assignment.termId : "-"}</td>
              <td>{assignment.note ?? "-"}</td>
              <td>{assignment.dueAt ? formatDateTime(assignment.dueAt) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatAssignmentContext(
  assignment: Pick<HomeworkMaterialAssignmentRecord, "courseId" | "termId">,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  const parts = [
    assignment.courseId ? courseNames.get(assignment.courseId) ?? assignment.courseId : undefined,
    assignment.termId ? termNames.get(assignment.termId) ?? assignment.termId : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
