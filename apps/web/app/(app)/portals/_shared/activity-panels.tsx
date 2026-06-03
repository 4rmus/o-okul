"use client";

import type { AttendanceRecord, StudentRecord, TeacherNoteRecord } from "@uzman-hocam/shared-types";

export function AttendancePanel({ records }: { records: AttendanceRecord[] }) {
  return (
    <section className="next-list-panel" aria-label="Devamsızlık">
      <h2>Devamsızlık</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{record.date}</td>
              <td>{formatAttendanceStatus(record.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
  return (
    <section className="next-list-panel" aria-label="Öğretmen yoklama kayıtları">
      <h2>Yoklama Kayıtları</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Öğrenci</th>
            <th>Branş</th>
            <th>Dönem</th>
            <th>Tarih</th>
            <th>Durum</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{studentNameById.get(record.studentId) ?? record.studentId}</td>
              <td>{record.courseId ? courseNames.get(record.courseId) ?? record.courseId : "-"}</td>
              <td>{record.termId ? termNames.get(record.termId) ?? record.termId : "-"}</td>
              <td>{record.date}</td>
              <td>{formatAttendanceStatus(record.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
  return (
    <section className="next-list-panel" aria-label="Öğretmen notları">
      <h2>Öğretmen Notları</h2>
      <div className="next-note-list">
        {notes.map((note) => (
          <article key={note.id}>
            <strong>{studentNameById.get(note.studentId) ?? note.developmentStatus ?? "Not"}</strong>
            <span className="next-field-hint">
              {note.courseId ? courseNames?.get(note.courseId) ?? note.courseId : "Branş yok"} ·{" "}
              {note.termId ? termNames?.get(note.termId) ?? note.termId : "Dönem yok"}
            </span>
            <p>{note.body}</p>
          </article>
        ))}
      </div>
    </section>
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
