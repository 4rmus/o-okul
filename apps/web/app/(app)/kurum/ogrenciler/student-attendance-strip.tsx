"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AttendanceRecord } from "@o-okul/shared-types";
import { Check, ChevronLeft, ChevronRight, Clock3, Minus, ShieldCheck, X } from "lucide-react";
import { Alert, Button } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest, withQueryParams } from "../../../../src/api-client.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { formatDateKey, istanbulDateKey } from "../../_shared/format.js";
import { attendanceStatusLabels, describeCalendarDay, formatCalendarDayLabel } from "../../portals/_shared/attendance-calendar-model.js";
import { shiftDateKey } from "./student-timeline-model.js";
import { buildAttendanceStripDays } from "./student-profile-model.js";

const periodDays = 20;
const statusIcons = { PRESENT: Check, ABSENT: X, LATE: Clock3, EXCUSED: ShieldCheck };

export function StudentAttendanceStrip({ studentId }: { studentId: string }) {
  const { auth } = useAuth();
  const canRead = hasCapabilityForRoles(auth?.session.roles ?? [], "attendance:read-assigned");
  const today = istanbulDateKey();
  const from = shiftDateKey(today, -(periodDays - 1));
  const [pageEnd, setPageEnd] = useState(periodDays);
  const [pageSize, setPageSize] = useState(5);
  const [selectedDate, setSelectedDate] = useState(today);
  const stripRef = useRef<HTMLElement>(null);
  const query = useQuery({
    queryKey: ["next-student-attendance-strip", auth?.session.tenantId ?? "anonymous", studentId, from, today],
    queryFn: () => apiRequest<AttendanceRecord[]>(auth?.accessToken ?? "", withQueryParams(`${apiBaseUrl}/attendance`, { studentId, dateFrom: from, dateTo: today })),
    enabled: Boolean(auth) && canRead,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const days = useMemo(() => buildAttendanceStripDays(
    (query.data ?? []).filter((record) => record.studentId === studentId && record.tenantId === auth?.session.tenantId), from, today,
  ), [query.data, from, today, studentId, auth?.session.tenantId]);
  const end = Math.max(pageSize, Math.min(days.length, pageEnd));
  const visibleDays = days.slice(Math.max(0, end - pageSize), end);
  const selected = visibleDays.find((day) => day.dateKey === selectedDate) ?? visibleDays.at(-1);
  const absentDays = days.filter((day) => day.counts.ABSENT > 0).length;
  const lateDays = days.filter((day) => day.counts.LATE > 0).length;
  const hasRecords = days.some((day) => day.total > 0);

  useEffect(() => {
    const element = stripRef.current;
    if (!element) return;
    const resize = () => setPageSize(element.clientWidth >= 960 ? 20 : element.clientWidth >= 480 ? 10 : 5);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [canRead]);

  if (!canRead) return null;
  return (
    <section className="next-student-attendance-strip" aria-label="Öğrenci devam günleri" ref={stripRef}>
      <div className="next-student-attendance-strip__heading">
        <h2>Devam</h2>
        <span>{formatDateKey(visibleDays[0]?.dateKey ?? from)} – {formatDateKey(visibleDays.at(-1)?.dateKey ?? today)}</span>
        {!query.isPending && !query.isError ? <p>{hasRecords ? <>Son {periodDays} gün: <strong>{absentDays} günde Yok kaydı</strong> · {lateDays} günde Geç kaydı</> : "Yoklama kaydı yok"}</p> : null}
      </div>
      {query.isPending ? <p role="status">Yoklama kayıtları yükleniyor...</p> : query.isError ? (
        <Alert tone="warning">Yoklama kayıtları alınamadı. <Button onClick={() => void query.refetch()} size="sm" type="button" variant="secondary">Tekrar dene</Button></Alert>
      ) : (
        <>
          <div className="next-student-attendance-strip__days" style={{ gridTemplateColumns: `repeat(${visibleDays.length}, minmax(0, 1fr))` }}>
            {visibleDays.map((day) => {
              const Icon = day.status ? statusIcons[day.status] : Minus;
              return <Button aria-controls="student-attendance-day-detail" aria-label={`${formatCalendarDayLabel(day.dateKey)}: ${describeCalendarDay(day)}`} aria-pressed={selected?.dateKey === day.dateKey} data-status={day.status ?? "MISSING"} key={day.dateKey} onClick={() => setSelectedDate(day.dateKey)} type="button" variant="ghost">
                <span className="next-student-attendance-date">{day.day}</span><Icon aria-hidden="true" size={14} />
              </Button>;
            })}
          </div>
          <div className="next-student-attendance-strip__detail">
            <p aria-live="polite" id="student-attendance-day-detail">{selected ? <><strong>{formatCalendarDayLabel(selected.dateKey)}</strong> · {describeCalendarDay(selected)}</> : "Yoklama kaydı yok"}</p>
            {pageSize < periodDays ? <div className="next-student-attendance-strip__pager">
              <Button aria-label="Önceki günler" disabled={end <= pageSize} onClick={() => { setPageEnd(Math.max(pageSize, end - pageSize)); setSelectedDate(""); }} size="icon" type="button" variant="secondary"><ChevronLeft aria-hidden="true" size={16} /></Button>
              <Button aria-label="Sonraki günler" disabled={end >= days.length} onClick={() => { setPageEnd(Math.min(days.length, end + pageSize)); setSelectedDate(""); }} size="icon" type="button" variant="secondary"><ChevronRight aria-hidden="true" size={16} /></Button>
            </div> : null}
          </div>
          <ul aria-label="Devam açıklaması" className="next-student-attendance-strip__legend">
            {Object.entries(statusIcons).map(([status, Icon]) => <li key={status} data-status={status}><Icon aria-hidden="true" size={13} />{attendanceStatusLabels[status as keyof typeof statusIcons]}</li>)}
            <li><Minus aria-hidden="true" size={13} />Kayıt yok</li>
          </ul>
          {!hasRecords ? <p className="next-student-profile-hint">Bu dönemde yoklama kaydı yok. Boş günler devamsız sayılmaz.</p> : null}
        </>
      )}
    </section>
  );
}
