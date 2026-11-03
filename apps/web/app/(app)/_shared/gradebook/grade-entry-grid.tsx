"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { GradeAssessmentDetail, GradeEntryDraftInput, GradeEntryRecord } from "@o-okul/shared-types";
import { Button, Checkbox, DataTable, Input, StatusBadge, type ConfirmDialogRequest, type DataTableColumn } from "@o-okul/ui";
import { entriesByStudent, formatGrade } from "./gradebook-api.js";
import styles from "./grade-entry-grid.module.css";

export interface GradeGridStudent {
  id: string;
  name: string;
}

const turkishCollator = new Intl.Collator("tr", { sensitivity: "base", numeric: true });

/**
 * Grid rows in roster order (UAT 2026-11-03 U8): surname, then first name, with Turkish collation so Ç, Ğ, İ, Ö,
 * Ş and Ü sort in place; the id breaks ties so equal names keep a stable order. Students added later used to stay
 * at the end because the API returns them in creation order.
 */
export function toGradeGridStudents(records: readonly { id: string; firstName: string; lastName: string }[]): GradeGridStudent[] {
  return [...records]
    .sort((left, right) => turkishCollator.compare(left.lastName, right.lastName)
      || turkishCollator.compare(left.firstName, right.firstName)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((record) => ({ id: record.id, name: `${record.firstName} ${record.lastName}` }));
}

export interface GradeGridActionState {
  /** Entries typed in the grid that are not saved as a draft yet. */
  unsavedCount: number;
}

interface DraftCell {
  score: string;
  absent: boolean;
}

interface GridRow {
  student: GradeGridStudent;
  versions: GradeEntryRecord[];
  current?: GradeEntryRecord;
}

type GridField = "score" | "absent";
const gridFields: readonly GridField[] = ["score", "absent"];

/** Confirm request shown before an action would drop grades that are typed but not saved. */
export function discardUnsavedGradesRequest(unsavedCount: number): ConfirmDialogRequest {
  return {
    cancelLabel: "Notlara dön",
    confirmLabel: "Kaydetmeden devam et",
    confirmVariant: "danger",
    description: "Kaydedilmemiş notlar silinir. Saklamak için önce “Taslağı kaydet”e basın.",
    message: `${unsavedCount} değişiklik kaydedilmedi.`,
    title: "Kaydedilmemiş notlar var",
  };
}

/**
 * Score grid for one assessment. Published cells are read-only; "Düzelt" opens a correction that the
 * server stores as a new version, so v1 stays visible in the history column.
 * Mount it with `key={assessment.id}` so typed values never leak into another assessment.
 */
export function GradeEntryGrid({
  actions,
  canEdit,
  detail,
  onSave,
  onUnsavedChange,
  saving,
  students,
}: {
  /** Extra buttons for the sticky action bar, e.g. "Yayınla"; rendered after "Taslağı kaydet". */
  actions?: (state: GradeGridActionState) => ReactNode;
  canEdit: boolean;
  detail: GradeAssessmentDetail;
  onSave(entries: GradeEntryDraftInput[]): Promise<void>;
  onUnsavedChange?(unsavedCount: number): void;
  saving: boolean;
  students: readonly GradeGridStudent[];
}) {
  const [drafts, setDrafts] = useState<Record<string, DraftCell>>({});
  const [correcting, setCorrecting] = useState<ReadonlySet<string>>(new Set());
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const tableRef = useRef<HTMLDivElement>(null);
  const { maxScore } = detail.assessment;

  const rows = useMemo<GridRow[]>(() => {
    const byStudent = entriesByStudent(detail.entries);
    return students.map((student) => {
      const versions = byStudent.get(student.id) ?? [];
      return { student, versions, current: versions.at(-1) };
    });
  }, [detail.entries, students]);

  const isEditable = (row: GridRow) => canEdit && (!row.current?.publishedAt || correcting.has(row.student.id));
  const savedCell = (row: GridRow): DraftCell => ({
    score: row.current && !row.current.publishedAt && row.current.score !== null ? String(row.current.score).replace(".", ",") : "",
    absent: Boolean(row.current && !row.current.publishedAt && row.current.absent),
  });
  const cellFor = (row: GridRow): DraftCell => drafts[row.student.id] ?? savedCell(row);
  const updateCell = (studentId: string, cell: DraftCell) => {
    setDrafts((current) => ({ ...current, [studentId]: cell }));
    setError("");
  };
  const scoreError = (cell: DraftCell) => {
    if (cell.absent || !cell.score.trim()) return undefined;
    const value = cell.score.trim();
    const score = Number(value.replace(",", "."));
    return /^\d+([.,]\d{1,2})?$/.test(value) && Number.isFinite(score) && score >= 0 && score <= maxScore
      ? undefined
      : `0 ile ${maxScore} arasında, en fazla iki ondalıklı olmalı.`;
  };

  // A change counts only when saving would send it: a new absence or a new non-empty score. A cleared draft
  // cell is not sent (drafts are never deleted), so it is not counted either.
  const pending = rows.flatMap((row) => {
    const cell = drafts[row.student.id];
    if (!cell || !isEditable(row)) return [];
    const saved = savedCell(row);
    const changed = cell.absent
      ? !saved.absent
      : Boolean(cell.score.trim()) && (saved.absent || cell.score.trim() !== saved.score);
    return changed ? [{ row, cell, error: scoreError(cell) }] : [];
  });
  const unsavedCount = pending.length;
  const visibleErrors = pending.filter((item) => item.error && (submitted || touched.has(item.row.student.id)));

  const onUnsavedChangeRef = useRef(onUnsavedChange);
  useEffect(() => { onUnsavedChangeRef.current = onUnsavedChange; });
  useEffect(() => { onUnsavedChangeRef.current?.(unsavedCount); }, [unsavedCount]);
  useEffect(() => () => onUnsavedChangeRef.current?.(0), []);

  const hasUnsaved = unsavedCount > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  function control(rowIndex: number, field: GridField) {
    const element = tableRef.current?.querySelector<HTMLInputElement>(`input[data-grade-row="${rowIndex}"][data-grade-field="${field}"]`);
    return element && !element.disabled ? element : undefined;
  }

  function verticalTarget(rowIndex: number, field: GridField, step: 1 | -1) {
    for (let index = rowIndex + step; index >= 0 && index < rows.length; index += step) {
      const target = control(index, field) ?? gridFields.map((other) => control(index, other)).find(Boolean);
      if (target) return target;
    }
    return undefined;
  }

  function horizontalTarget(rowIndex: number, field: GridField, step: 1 | -1) {
    for (let index = gridFields.indexOf(field) + step; index >= 0 && index < gridFields.length; index += step) {
      const target = control(rowIndex, gridFields[index]!);
      if (target) return target;
    }
    return undefined;
  }

  // Up/down move between rows in the same column, left/right between fields once the caret is at the edge of the
  // text, Enter keeps moving down from a score cell. Read-only (published) rows are skipped.
  function moveFocus(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, field: GridField) {
    const input = event.currentTarget;
    const isText = input.type !== "checkbox";
    const atStart = !isText || (input.selectionStart === 0 && input.selectionEnd === 0);
    const atEnd = !isText || (input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
    let target: HTMLInputElement | undefined;
    if (event.key === "Enter" && field === "score") {
      event.preventDefault();
      target = verticalTarget(rowIndex, "score", 1);
    } else if (event.key === "ArrowDown") target = verticalTarget(rowIndex, field, 1);
    else if (event.key === "ArrowUp") target = verticalTarget(rowIndex, field, -1);
    else if (event.key === "ArrowRight" && atEnd) target = horizontalTarget(rowIndex, field, 1);
    else if (event.key === "ArrowLeft" && atStart) target = horizontalTarget(rowIndex, field, -1);
    if (!target) return;
    event.preventDefault();
    target.focus();
    if (target.type !== "checkbox") target.select();
  }

  async function save() {
    if (pending.length === 0) {
      setError("Kaydedilecek değişiklik yok.");
      return;
    }
    const invalid = pending.filter((item) => item.error);
    if (invalid.length > 0) {
      setSubmitted(true);
      setError(`${invalid.length} notta hata var. İşaretli hücreleri düzeltip tekrar kaydedin.`);
      control(rows.indexOf(invalid[0]!.row), "score")?.focus();
      return;
    }
    const entries: GradeEntryDraftInput[] = pending.map(({ row, cell }) => cell.absent
      ? { studentId: row.student.id, score: null, absent: true }
      : { studentId: row.student.id, score: Number(cell.score.trim().replace(",", ".")), absent: false });
    setError("");
    try {
      await onSave(entries);
      // Clear only what was saved; a cell opened or edited while saving stays as the user left it.
      const saved = new Set(entries.map((entry) => entry.studentId));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([studentId]) => !saved.has(studentId))));
      setCorrecting((current) => new Set([...current].filter((studentId) => !saved.has(studentId))));
      setSubmitted(false);
    } catch {
      setError("Notlar kaydedilemedi. Yetkinizi ve değerleri kontrol edip tekrar deneyin.");
    }
  }

  const columns: Array<DataTableColumn<GridRow>> = [
    { key: "student", header: "Öğrenci", priority: "primary", mobilePriority: "primary", render: (row) => row.student.name },
    {
      key: "score",
      header: `Not (0-${maxScore})`,
      priority: "primary",
      mobilePriority: "primary",
      render: (row) => {
        if (!isEditable(row)) return row.current ? formatGrade(row.current) : "-";
        const cell = cellFor(row);
        const index = rows.indexOf(row);
        const message = visibleErrors.find((item) => item.row === row)?.error;
        const errorId = `grade-error-${row.student.id}`;
        return (
          <>
            <Input
              aria-describedby={message ? errorId : undefined}
              aria-label={`${row.student.name} notu`}
              data-grade-field="score"
              data-grade-row={index}
              disabled={cell.absent || saving}
              inputMode="decimal"
              invalid={Boolean(message)}
              onBlur={() => setTouched((current) => current.has(row.student.id) ? current : new Set([...current, row.student.id]))}
              onChange={(event) => updateCell(row.student.id, { ...cell, score: event.target.value })}
              onKeyDown={(event) => moveFocus(event, index, "score")}
              value={cell.score}
            />
            {message ? <span className={styles.cellError} id={errorId}>{message}</span> : null}
          </>
        );
      },
    },
    {
      key: "absent",
      header: "Girmedi",
      render: (row) => isEditable(row) ? (
        <Checkbox
          aria-label={`${row.student.name} sınava girmedi`}
          checked={cellFor(row).absent}
          data-grade-field="absent"
          data-grade-row={rows.indexOf(row)}
          disabled={saving}
          label="Girmedi"
          onChange={(event) => updateCell(row.student.id, { score: "", absent: event.target.checked })}
          onKeyDown={(event) => moveFocus(event, rows.indexOf(row), "absent")}
        />
      ) : (row.current?.absent ? "Evet" : "-"),
    },
    { key: "status", header: "Durum", render: (row) => <GradeStatus current={row.current} correcting={correcting.has(row.student.id)} /> },
    {
      key: "history",
      header: "Sürüm geçmişi",
      mobilePriority: "secondary",
      render: (row) => row.versions.length === 0
        ? "-"
        : row.versions.map((entry) => `v${entry.version} ${formatGrade(entry)}${entry.publishedAt ? "" : " (taslak)"}`).join(" · "),
    },
    {
      key: "actions",
      header: "İşlem",
      render: (row) => canEdit && row.current?.publishedAt && !correcting.has(row.student.id) ? (
        <Button
          aria-label={`${row.student.name} notunu düzelt`}
          onClick={() => setCorrecting((current) => new Set([...current, row.student.id]))}
          size="sm"
          variant="secondary"
        >
          Düzelt
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="next-portal-stack" ref={tableRef}>
      <DataTable
        caption="Öğrenci notları"
        columns={columns}
        density="compact"
        description="Yayınlanan not değişmez; düzeltme yeni sürüm olarak kaydedilir ve geçmişte görünür. Ok tuşları ve Enter ile hücreler arasında geçilir."
        emptyText="Bu sınıfta öğrenci yok"
        getRowKey={(row) => row.student.id}
        rows={rows}
      />
      {canEdit ? (
        <div aria-label="Not kaydetme" className={styles.actionBar} role="group">
          <div className={styles.actionSummary}>
            <p aria-live="polite" className="next-status-note" data-testid="grade-unsaved-summary">
              {hasUnsaved ? `${unsavedCount} değişiklik kaydedilmedi` : "Kaydedilmemiş değişiklik yok"}
              {visibleErrors.length > 0 ? ` · ${visibleErrors.length} notta hata var` : ""}
            </p>
            {error ? <p className="next-form-error" role="alert">{error}</p> : null}
          </div>
          <div className={styles.actionButtons}>
            <Button disabled={saving} onClick={() => void save()} variant={hasUnsaved ? "primary" : "secondary"}>
              {saving ? "Kaydediliyor…" : "Taslağı kaydet"}
            </Button>
            {actions?.({ unsavedCount })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GradeStatus({ current, correcting }: { current?: GradeEntryRecord; correcting: boolean }) {
  if (!current) return <StatusBadge tone="neutral">Girilmedi</StatusBadge>;
  if (correcting) return <StatusBadge tone="warning">Düzeltiliyor</StatusBadge>;
  if (current.publishedAt) return <StatusBadge tone="success">{`Yayında v${current.version}`}</StatusBadge>;
  return <StatusBadge tone="warning">{current.version > 1 ? `Düzeltme taslağı v${current.version}` : "Taslak"}</StatusBadge>;
}
