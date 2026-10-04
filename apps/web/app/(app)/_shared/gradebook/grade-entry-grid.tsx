"use client";

import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { GradeAssessmentDetail, GradeEntryDraftInput, GradeEntryRecord } from "@o-okul/shared-types";
import { Alert, Button, Checkbox, DataTable, Input, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import { entriesByStudent, formatGrade } from "./gradebook-api.js";

export interface GradeGridStudent {
  id: string;
  name: string;
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

/**
 * Score grid for one assessment. Published cells are read-only; "Düzelt" opens a correction that the
 * server stores as a new version, so v1 stays visible in the history column.
 */
export function GradeEntryGrid({
  canEdit,
  detail,
  onSave,
  saving,
  students,
}: {
  canEdit: boolean;
  detail: GradeAssessmentDetail;
  onSave(entries: GradeEntryDraftInput[]): Promise<void>;
  saving: boolean;
  students: readonly GradeGridStudent[];
}) {
  const [drafts, setDrafts] = useState<Record<string, DraftCell>>({});
  const [correcting, setCorrecting] = useState<ReadonlySet<string>>(new Set());
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
  const cellFor = (row: GridRow): DraftCell => drafts[row.student.id] ?? {
    score: row.current && !row.current.publishedAt && row.current.score !== null ? String(row.current.score).replace(".", ",") : "",
    absent: Boolean(row.current && !row.current.publishedAt && row.current.absent),
  };
  const updateCell = (studentId: string, cell: DraftCell) => setDrafts((current) => ({ ...current, [studentId]: cell }));

  function focusNextRow(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    tableRef.current?.querySelector<HTMLInputElement>(`input[data-grade-row="${index + 1}"]`)?.focus();
  }

  async function save() {
    const entries: GradeEntryDraftInput[] = [];
    for (const studentId of Object.keys(drafts)) {
      const row = rows.find((item) => item.student.id === studentId);
      if (!row || !isEditable(row)) continue;
      const cell = drafts[studentId]!;
      if (cell.absent) {
        entries.push({ studentId, score: null, absent: true });
        continue;
      }
      if (!cell.score.trim()) continue;
      const score = Number(cell.score.replace(",", "."));
      if (!Number.isFinite(score) || score < 0 || score > maxScore || !/^\d+([.,]\d{1,2})?$/.test(cell.score.trim())) {
        setError(`${row.student.name}: not 0 ile ${maxScore} arasında ve en fazla iki ondalıklı olmalı.`);
        return;
      }
      entries.push({ studentId, score, absent: false });
    }
    if (entries.length === 0) {
      setError("Kaydedilecek değişiklik yok.");
      return;
    }
    setError("");
    try {
      await onSave(entries);
      // Clear only what was saved; a cell opened or edited while saving stays as the user left it.
      const saved = new Set(entries.map((entry) => entry.studentId));
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([studentId]) => !saved.has(studentId))));
      setCorrecting((current) => new Set([...current].filter((studentId) => !saved.has(studentId))));
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
        return (
          <Input
            aria-label={`${row.student.name} notu`}
            data-grade-row={index}
            disabled={cell.absent || saving}
            inputMode="decimal"
            onChange={(event) => updateCell(row.student.id, { ...cell, score: event.target.value })}
            onKeyDown={(event) => focusNextRow(event, index)}
            value={cell.score}
          />
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
          disabled={saving}
          label="Girmedi"
          onChange={(event) => updateCell(row.student.id, { score: "", absent: event.target.checked })}
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
        description="Yayınlanan not değişmez; düzeltme yeni sürüm olarak kaydedilir ve geçmişte görünür."
        emptyText="Bu sınıfta öğrenci yok"
        getRowKey={(row) => row.student.id}
        rows={rows}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {canEdit ? (
        <div className="next-form-actions">
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? "Kaydediliyor…" : "Taslağı kaydet"}
          </Button>
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
