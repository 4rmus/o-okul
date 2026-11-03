"use client";

import { type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { AttendanceRecord, AttendanceStatus } from "@o-okul/shared-types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, Button, DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import { formatAttendanceSummary } from "../../_shared/attendance-summary.js";
import { formatDateKey, istanbulDateKey } from "../../_shared/format.js";
import {
  type AttendanceCalendarDay,
  type AttendanceMonthKey,
  attendanceStatusLabels,
  attendanceStatusMarks,
  attendanceStatusOrder,
  buildAttendanceCalendarMonth,
  defaultCalendarMonth,
  describeCalendarDay,
  formatCalendarDayLabel,
  monthKeyOf,
  shiftMonth,
  weekdayLabels,
} from "./attendance-calendar-model.js";

// Takvim yalnız token değişkenleriyle biçimlenir; koyu tema tokens.css üzerinden kendiliğinden uyar.
const statusTone: Record<AttendanceStatus, { background: string; border: string; text: string }> = {
  ABSENT: { background: "var(--color-danger-subtle)", border: "var(--color-danger)", text: "var(--color-danger)" },
  EXCUSED: { background: "var(--color-info-subtle)", border: "var(--color-info)", text: "var(--color-info)" },
  LATE: { background: "var(--color-warning-subtle)", border: "var(--color-warning)", text: "var(--color-warning)" },
  PRESENT: { background: "var(--color-success-subtle)", border: "var(--color-success)", text: "var(--color-success)" },
};

const tableStyle: CSSProperties = {
  borderCollapse: "separate",
  borderSpacing: "var(--space-3xs)",
  tableLayout: "fixed",
  width: "100%",
};
const headerCellStyle: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "var(--text-xs)",
  fontWeight: 700,
  padding: "var(--space-3xs) 0",
  textAlign: "center",
};
const dayCellStyle: CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-faint)",
  borderRadius: "var(--radius)",
  height: "2.75rem",
  padding: "var(--space-3xs)",
  textAlign: "left",
  verticalAlign: "top",
};
const dayNumberStyle: CSSProperties = { display: "block", fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.2 };
const markStyle: CSSProperties = { display: "block", fontSize: "var(--text-xs)", fontWeight: 800, lineHeight: 1.2 };
const navStyle: CSSProperties = { alignItems: "center", display: "flex", flexWrap: "wrap", gap: "var(--space-2xs)" };
const legendStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2xs) var(--space-sm)",
  listStyle: "none",
  margin: "0 0 var(--space-2xs)",
  padding: 0,
};
const legendItemStyle: CSSProperties = { alignItems: "center", display: "inline-flex", fontSize: "var(--text-sm)", gap: "var(--space-3xs)" };
const legendSwatchStyle: CSSProperties = {
  borderRadius: "var(--radius)",
  display: "inline-grid",
  fontSize: "var(--text-xs)",
  fontWeight: 800,
  height: "1.5rem",
  placeItems: "center",
  width: "1.5rem",
};

export interface AttendanceCalendarPanelProps {
  className?: string;
  /** Ekranın zaten okuduğu yoklama kayıtları; takvim yeni veri istemez. */
  records: readonly AttendanceRecord[];
  month: AttendanceMonthKey;
  onMonthChange(month: AttendanceMonthKey): void;
  description?: ReactNode;
  error?: ReactNode;
  loading?: boolean;
  /** Bu aydan önceye gidilmez (kayıtların başladığı ay). */
  minMonth?: AttendanceMonthKey;
  /** Takvimin metin eşdeğeri olarak ayın kayıt tablosunu da gösterir. */
  showRecordTable?: boolean;
  title?: string;
}

export function AttendanceCalendarPanel({
  className,
  description = "Ay içindeki yoklama günleri; her gün o günün en önemli durumunu gösterir.",
  error,
  loading = false,
  minMonth,
  month,
  onMonthChange,
  records,
  showRecordTable = false,
  title = "Yoklama takvimi",
}: AttendanceCalendarPanelProps) {
  const todayKey = istanbulDateKey();
  const currentMonth = monthKeyOf(todayKey);
  const calendar = useMemo(() => buildAttendanceCalendarMonth(records, month), [month, records]);
  const monthRecords = useMemo(
    () => records
      .filter((record) => !record.deletedAt && monthKeyOf(record.date) === month)
      .sort((left, right) => right.date.localeCompare(left.date)),
    [month, records],
  );
  const canGoBack = !minMonth || month > minMonth;
  const canGoForward = month < currentMonth;
  const summary = loading
    ? "Yükleniyor…"
    : calendar.total === 0
      ? "Bu ay yoklama kaydı yok."
      : `${calendar.total} yoklama kaydı · ${formatAttendanceSummary({ ...countsAsSummary(calendar.counts), total: calendar.total })}`;

  return (
    <Panel
      actions={
        <div aria-label="Ay seçimi" role="group" style={navStyle}>
          <Button disabled={!canGoBack || loading} size="sm" type="button" variant="secondary" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            <ChevronLeft size={16} aria-hidden="true" />
            Önceki ay
          </Button>
          <Button disabled={!canGoForward || loading} size="sm" type="button" variant="secondary" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            Sonraki ay
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      }
      aria-label={title}
      className={className}
      description={description}
      title={title}
    >
      <p aria-live="polite" className="next-status-note">
        <strong>{calendar.label}</strong> · {summary}
      </p>
      <ul aria-label="Takvim açıklaması" style={legendStyle}>
        {attendanceStatusOrder.map((status) => (
          <li key={status} style={legendItemStyle}>
            <span
              aria-hidden="true"
              style={{ ...legendSwatchStyle, background: statusTone[status].background, border: `1px solid ${statusTone[status].border}`, color: statusTone[status].text }}
            >
              {attendanceStatusMarks[status]}
            </span>
            {attendanceStatusLabels[status]}
          </li>
        ))}
      </ul>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <table aria-busy={loading || undefined} style={tableStyle}>
        <caption className="uh-visually-hidden">{`${title}, ${calendar.label}`}</caption>
        <thead>
          <tr>
            {weekdayLabels.map((weekday) => (
              <th key={weekday.short} scope="col" style={headerCellStyle}>
                <abbr title={weekday.full} style={{ textDecoration: "none" }}>{weekday.short}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {calendar.weeks.map((week, weekIndex) => (
            <tr key={`${month}-week-${weekIndex}`}>
              {week.map((day, dayIndex) => day
                ? <CalendarDayCell day={day} isToday={day.dateKey === todayKey} key={day.dateKey} />
                : <td aria-hidden="true" key={`${month}-blank-${weekIndex}-${dayIndex}`} />)}
            </tr>
          ))}
        </tbody>
      </table>
      {showRecordTable ? (
        <DataTable
          caption="Ayın yoklama kayıtları"
          columns={monthRecordColumns}
          density="compact"
          emptyText="Bu ay yoklama kaydı yok."
          getRowKey={(record) => record.id}
          loading={loading}
          rows={monthRecords}
        />
      ) : null}
    </Panel>
  );
}

function CalendarDayCell({ day, isToday }: { day: AttendanceCalendarDay; isToday: boolean }) {
  const tone = day.status ? statusTone[day.status] : undefined;
  const style: CSSProperties = {
    ...dayCellStyle,
    ...(tone ? { background: tone.background, borderColor: tone.border } : {}),
    ...(isToday ? { boxShadow: "inset 0 0 0 2px var(--color-primary)" } : {}),
  };
  return (
    <td aria-current={isToday ? "date" : undefined} data-status={day.status} style={style}>
      <span aria-hidden="true" style={dayNumberStyle}>{day.day}</span>
      {day.status ? (
        <span aria-hidden="true" style={{ ...markStyle, color: tone?.text }}>
          {attendanceStatusMarks[day.status]}{day.total > 1 ? ` ${day.total}` : ""}
        </span>
      ) : null}
      <span className="uh-visually-hidden">{`${formatCalendarDayLabel(day.dateKey)}: ${describeCalendarDay(day)}${isToday ? " (bugün)" : ""}`}</span>
    </td>
  );
}

const monthRecordColumns: Array<DataTableColumn<AttendanceRecord>> = [
  {
    header: "Tarih",
    key: "date",
    mobilePriority: "primary",
    priority: "primary",
    render: (record) => formatDateKey(record.date),
    sticky: "left",
  },
  {
    header: "Durum",
    key: "status",
    mobilePriority: "primary",
    priority: "primary",
    render: (record) => attendanceStatusLabels[record.status],
  },
];

function countsAsSummary(counts: Record<AttendanceStatus, number>) {
  return { absent: counts.ABSENT, excused: counts.EXCUSED, late: counts.LATE };
}

/**
 * Portal görünümleri için: tüm yoklama kayıtları zaten yüklüdür, ay gezinmesi yalnız istemcide yapılır.
 * Açılış ayı bu aydır; bu ay kayıt yoksa en son kaydın ayı açılır.
 */
export function PortalAttendanceCalendar({ records }: { records: readonly AttendanceRecord[] }) {
  const todayKey = istanbulDateKey();
  const [selectedMonth, setSelectedMonth] = useState<AttendanceMonthKey | null>(null);
  const month = selectedMonth ?? defaultCalendarMonth(records, todayKey);
  const minMonth = useMemo(() => {
    const keys = records.filter((record) => !record.deletedAt).map((record) => monthKeyOf(record.date));
    return keys.length > 0 ? keys.reduce((earliest, key) => (key < earliest ? key : earliest)) : monthKeyOf(todayKey);
  }, [records, todayKey]);
  return (
    <AttendanceCalendarPanel
      description="Yoklama kayıtlarının aylık görünümü; kayıtların tam listesi Devamsızlık tablosundadır."
      minMonth={minMonth}
      month={month}
      records={records}
      onMonthChange={setSelectedMonth}
    />
  );
}
