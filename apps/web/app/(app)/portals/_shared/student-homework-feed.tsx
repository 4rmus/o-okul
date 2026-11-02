"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type { HomeworkMaterialAssignmentRecord, HomeworkSubmissionStatus, StudentHomeworkRecord } from "@o-okul/shared-types";
import { istanbulDateKey } from "../../_shared/istanbul-date.js";

export type StudentHomeworkFeedGroupKey = "overdue" | "today" | "week" | "later" | "done";

export interface StudentHomeworkFeedItem {
  key: string;
  kind: "class" | "material";
  title: string;
  description: string;
  context: string;
  dueAt?: string;
  /** Yalnız sınıf ödevinde var; materyal atamasının teslim durumu yoktur. */
  homeworkId?: string;
  status?: HomeworkSubmissionStatus;
}

const groupCaptions: Record<StudentHomeworkFeedGroupKey, string> = {
  overdue: "Gecikmiş",
  today: "Bugün",
  week: "Bu hafta",
  later: "Sonra",
  done: "Teslim edilenler",
};
const openGroupOrder: StudentHomeworkFeedGroupKey[] = ["overdue", "today", "week", "later"];

const submissionStatusLabels: Record<HomeworkSubmissionStatus, string> = {
  NOT_SUBMITTED: "Teslim edilmedi",
  SUBMITTED: "Teslim edildi",
  CHECKED: "Kontrol edildi",
};

/** Sınıf ödevi ve materyal atamasını tek akışta birleştirir; açık iş = teslim edilmemiş sınıf ödevi + materyal ataması. */
export function buildStudentHomeworkFeed({
  classHomework,
  courseNames,
  materialAssignments,
  termNames,
}: {
  classHomework: readonly StudentHomeworkRecord[];
  courseNames: ReadonlyMap<string, string>;
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[];
  termNames: ReadonlyMap<string, string>;
}): StudentHomeworkFeedItem[] {
  return [
    ...classHomework.map((record): StudentHomeworkFeedItem => ({
      context: "Sınıf ödevi",
      description: [record.sourceMaterialTitle, record.description].filter(Boolean).join(" · ") || "-",
      ...(record.dueAt ? { dueAt: record.dueAt } : {}),
      homeworkId: record.id,
      key: `class-${record.id}`,
      kind: "class",
      status: record.submission.status,
      title: record.title,
    })),
    ...materialAssignments.map((assignment): StudentHomeworkFeedItem => ({
      context: formatAssignmentContext(assignment, courseNames, termNames),
      description: assignment.note ?? "-",
      ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
      key: `material-${assignment.id}`,
      kind: "material",
      title: assignment.materialTitle ?? "Bilinmeyen materyal",
    })),
  ];
}

export function isOpenStudentHomeworkFeedItem(item: StudentHomeworkFeedItem) {
  return item.kind === "material" || item.status === "NOT_SUBMITTED";
}

/** "Bugün" ve "Bu hafta" Türkiye saatine göredir; hafta pazar günü biter. Tarihsiz iş "Sonra"ya düşer. */
export function studentHomeworkFeedGroup(item: StudentHomeworkFeedItem, now: Date): StudentHomeworkFeedGroupKey {
  if (!isOpenStudentHomeworkFeedItem(item)) return "done";
  if (!item.dueAt) return "later";
  const todayKey = istanbulDateKey(now);
  const dueKey = istanbulDateKey(new Date(item.dueAt));
  if (dueKey < todayKey) return "overdue";
  if (dueKey === todayKey) return "today";
  return dueKey <= weekEndKey(todayKey) ? "week" : "later";
}

export function StudentHomeworkFeed({
  classHomework,
  classHomeworkFailed = false,
  courseNames,
  limit,
  materialAssignments,
  materialAssignmentsFailed = false,
  moreHref,
  onRetry,
  onSubmit,
  readOnly = false,
  showDone = false,
  termNames,
}: {
  classHomework: readonly StudentHomeworkRecord[];
  classHomeworkFailed?: boolean;
  courseNames: ReadonlyMap<string, string>;
  /** Özette yalnız ilk N açık iş; tamamı moreHref ile Ödevler sayfasında. */
  limit?: number;
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[];
  materialAssignmentsFailed?: boolean;
  moreHref?: string;
  onRetry?: () => void;
  onSubmit?(homeworkId: string): Promise<unknown>;
  readOnly?: boolean;
  /** Ödevler sayfası teslim edilen sınıf ödevlerini ayrı grupta gösterir. */
  showDone?: boolean;
  termNames: ReadonlyMap<string, string>;
}) {
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const now = new Date();
  const items = buildStudentHomeworkFeed({ classHomework, courseNames, materialAssignments, termNames })
    .map((item) => ({ group: studentHomeworkFeedGroup(item, now), item }))
    .sort((left, right) => compareDue(left.item.dueAt, right.item.dueAt));
  const openItems = openGroupOrder.flatMap((group) => items.filter((entry) => entry.group === group));
  const visibleOpen = limit ? openItems.slice(0, limit) : openItems;
  const hiddenCount = openItems.length - visibleOpen.length;
  const groups = [...openGroupOrder, ...(showDone ? (["done"] as const) : [])]
    .map((group) => ({
      group,
      rows: (group === "done" ? items.filter((entry) => entry.group === "done") : visibleOpen.filter((entry) => entry.group === group)).map((entry) => entry.item),
    }))
    .filter((entry) => entry.rows.length > 0);
  const failedSources = [classHomeworkFailed ? "sınıf ödevleri" : "", materialAssignmentsFailed ? "materyal atamaları" : ""].filter(Boolean);
  const showActions = showDone && (readOnly || Boolean(onSubmit));

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

  const columns: Array<DataTableColumn<StudentHomeworkFeedItem>> = [
    { header: "Ödev", key: "title", priority: "primary", render: (item) => item.title, sticky: "left" },
    // Öğretmenin yazdığı açıklama ve materyal notu öğrenciye görünür.
    { header: "Açıklama", key: "description", priority: "secondary", render: (item) => item.description },
    { header: "Bağlam", key: "context", priority: "secondary", render: (item) => item.context },
    { header: "Son tarih", key: "dueAt", priority: "secondary", render: (item) => (item.dueAt ? formatDateTime(item.dueAt) : "-") },
    { header: "Durum", key: "status", priority: "primary", render: (item) => (item.status ? submissionStatusLabels[item.status] : "Atandı") },
    ...(showActions
      ? [{
          header: "İşlem",
          key: "action",
          priority: "primary" as const,
          render: (item: StudentHomeworkFeedItem) =>
            readOnly || !onSubmit || item.kind !== "class" ? (
              item.kind === "class" && readOnly ? "Yalnızca görüntüleme" : "-"
            ) : item.status === "NOT_SUBMITTED" && item.homeworkId ? (
              <Button disabled={pendingId === item.homeworkId} onClick={() => void submit(item.homeworkId!)} variant="secondary">
                Teslim ettim
              </Button>
            ) : (
              "-"
            ),
          sticky: "right" as const,
        }]
      : []),
  ];

  return (
    <Panel
      actions={moreHref && hiddenCount > 0 ? <Link href={moreHref}>Tümünü aç ({openItems.length})</Link> : undefined}
      aria-label="Ödevlerim"
      description={
        hiddenCount > 0
          ? `İlk ${visibleOpen.length} açık iş; ${hiddenCount} iş daha Ödevler sayfasında.`
          : "Sınıf ödevleri ve materyal atamaları teslim tarihine göre tek listede."
      }
      title="Ödevlerim"
    >
      {failedSources.length > 0 ? (
        <div role="alert">
          <p className="next-form-error">{`${capitalize(failedSources.join(" ve "))} şu an alınamadı; liste eksik olabilir.`}</p>
          {onRetry ? <Button onClick={onRetry} variant="secondary">Tekrar dene</Button> : null}
        </div>
      ) : null}
      {error ? <p className="next-form-error" role="alert">{error}</p> : null}
      {groups.length === 0 && failedSources.length === 0 ? <p className="next-status-note" role="status">Açık ödev yok.</p> : null}
      {groups.map(({ group, rows }) => (
        <DataTable
          caption={groupCaptions[group]}
          columns={columns}
          density="compact"
          getRowKey={(item) => item.key}
          key={group}
          rows={rows}
        />
      ))}
    </Panel>
  );
}

function weekEndKey(todayKey: string) {
  const today = new Date(`${todayKey}T00:00:00Z`);
  const daysToSunday = (7 - today.getUTCDay()) % 7;
  return new Date(today.getTime() + daysToSunday * 86_400_000).toISOString().slice(0, 10);
}

function compareDue(left: string | undefined, right: string | undefined) {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  return right ? 1 : 0;
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
  return parts.length > 0 ? parts.join(" / ") : "Materyal ataması";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase("tr-TR") + value.slice(1);
}
