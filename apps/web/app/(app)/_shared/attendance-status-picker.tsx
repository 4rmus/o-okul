"use client";

import { useId, type ReactNode } from "react";
import type { AttendanceStatus } from "@o-okul/shared-types";
import { Button } from "@o-okul/ui";

export type AttendanceStatusDraft = Record<string, AttendanceStatus | "">;

export interface AttendanceRosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  studentNo?: string;
}

export interface AttendanceStatusCounts {
  absent: number;
  excused: number;
  late: number;
  present: number;
  unmarked: number;
}

// Sıra, yoklamada en sık seçilen durumdan başlar; "Var" her zaman ilk seçenektir.
export const attendanceStatusOptions: ReadonlyArray<{ label: string; value: AttendanceStatus }> = [
  { label: "Var", value: "PRESENT" },
  { label: "Yok", value: "ABSENT" },
  { label: "Geç", value: "LATE" },
  { label: "İzinli", value: "EXCUSED" },
];

/** Tek öğrenci için tek dokunuşla yoklama durumu: yerel radio grubu, ok tuşlarıyla gezilir. */
export function AttendanceStatusPicker({
  disabled = false,
  name,
  onChange,
  studentName,
  value,
}: {
  disabled?: boolean;
  name: string;
  onChange(status: AttendanceStatus): void;
  studentName: string;
  value: AttendanceStatus | "";
}) {
  return (
    <div aria-label={`${studentName} yoklama durumu`} className="next-attendance-status" role="radiogroup">
      {attendanceStatusOptions.map((option) => (
        <label className="next-attendance-status__option" data-status={option.value} key={option.value}>
          <input
            checked={value === option.value}
            disabled={disabled}
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Sınıf listesinin tamamı için yoklama: önce "Tümünü Var", sonra öğrenci başına durum grubu,
 * en altta kaydet düğmesinin yanında yapışkan özet satırı. Kaydetme işlemi çağıran sayfadadır.
 */
export function AttendanceRoster({
  description,
  disabled = false,
  emptyText,
  error,
  label,
  loading = false,
  onMarkAllPresent,
  onStatusChange,
  saveAction,
  showMarkAllPresent = true,
  statuses,
  students,
  summaryId,
}: {
  description?: ReactNode;
  disabled?: boolean;
  emptyText: string;
  error?: string;
  label: string;
  loading?: boolean;
  onMarkAllPresent(): void;
  onStatusChange(studentId: string, status: AttendanceStatus): void;
  saveAction: ReactNode;
  showMarkAllPresent?: boolean;
  statuses: AttendanceStatusDraft;
  students: AttendanceRosterStudent[];
  summaryId: string;
}) {
  const groupPrefix = useId();
  if (error) return <p className="next-form-error" role="alert">{error}</p>;
  if (students.length === 0) {
    return loading
      ? <p className="next-field-hint" role="status">Sınıf listesi yükleniyor…</p>
      : <p className="next-field-hint">{emptyText}</p>;
  }

  const counts = countAttendanceStatuses(students, statuses);
  return (
    <div className="next-attendance-roster">
      {showMarkAllPresent || description ? (
        <div className="next-attendance-roster__toolbar">
          {showMarkAllPresent ? (
            <Button disabled={disabled} onClick={onMarkAllPresent} type="button" variant="secondary">Tümünü Var</Button>
          ) : null}
          {description ? <p className="next-field-hint">{description}</p> : null}
        </div>
      ) : null}
      <ul aria-label={label} className="next-attendance-roster__list">
        {students.map((student) => {
          const studentName = `${student.firstName} ${student.lastName}`;
          return (
            <li className="next-attendance-roster__row" data-marked={statuses[student.id] ? "true" : "false"} key={student.id}>
              <span className="next-attendance-roster__student">
                <strong>{studentName}</strong>
                {student.studentNo ? <span>No {student.studentNo}</span> : null}
              </span>
              <AttendanceStatusPicker
                disabled={disabled}
                name={`${groupPrefix}-${student.id}`}
                onChange={(status) => onStatusChange(student.id, status)}
                studentName={studentName}
                value={statuses[student.id] ?? ""}
              />
            </li>
          );
        })}
      </ul>
      <div className="next-attendance-roster__bar">
        <p aria-live="polite" id={summaryId}>{formatAttendanceStatusCounts(counts)}</p>
        {saveAction}
      </div>
    </div>
  );
}

export function countAttendanceStatuses(students: Array<Pick<AttendanceRosterStudent, "id">>, statuses: AttendanceStatusDraft): AttendanceStatusCounts {
  const counts: AttendanceStatusCounts = { absent: 0, excused: 0, late: 0, present: 0, unmarked: 0 };
  for (const student of students) {
    const status = statuses[student.id];
    if (status === "PRESENT") counts.present += 1;
    else if (status === "ABSENT") counts.absent += 1;
    else if (status === "LATE") counts.late += 1;
    else if (status === "EXCUSED") counts.excused += 1;
    else counts.unmarked += 1;
  }
  return counts;
}

/** "25 Var · 2 Yok · 1 Geç · 0 seçilmedi"; İzinli yalnız seçildiğinde yazılır. */
export function formatAttendanceStatusCounts(counts: AttendanceStatusCounts) {
  return [
    `${counts.present} Var`,
    `${counts.absent} Yok`,
    `${counts.late} Geç`,
    counts.excused > 0 ? `${counts.excused} İzinli` : undefined,
    `${counts.unmarked} seçilmedi`,
  ].filter(Boolean).join(" · ");
}
