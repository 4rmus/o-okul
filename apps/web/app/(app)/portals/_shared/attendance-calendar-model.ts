import type { AttendanceRecord, AttendanceStatus } from "@o-okul/shared-types";
import { appLocale } from "../../_shared/format.js";

// Aylık yoklama takvimi (DEC-20261102-08): yalnız ekranın zaten okuduğu yoklama kayıtlarından türetilir; yeni veri istemez.

export type AttendanceMonthKey = string;

export interface AttendanceCalendarDay {
  /** "2026-11-03" */
  dateKey: string;
  day: number;
  /** Gün içindeki kayıtların en ağır durumu: Yok > Geç > İzinli > Var. */
  status?: AttendanceStatus;
  counts: Record<AttendanceStatus, number>;
  total: number;
}

export interface AttendanceCalendarMonth {
  monthKey: AttendanceMonthKey;
  label: string;
  /** Pazartesi ile başlayan haftalar; ay dışındaki hücreler null. */
  weeks: Array<Array<AttendanceCalendarDay | null>>;
  counts: Record<AttendanceStatus, number>;
  total: number;
}

export const attendanceStatusOrder: readonly AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

export const attendanceStatusLabels: Record<AttendanceStatus, string> = {
  ABSENT: "Yok",
  EXCUSED: "İzinli",
  LATE: "Geç",
  PRESENT: "Var",
};

/** Hücrede renge ek olarak görünen tek harf; durum yalnız renkle anlatılmaz. */
export const attendanceStatusMarks: Record<AttendanceStatus, string> = {
  ABSENT: "Y",
  EXCUSED: "İ",
  LATE: "G",
  PRESENT: "V",
};

const statusSeverity: Record<AttendanceStatus, number> = { ABSENT: 3, LATE: 2, EXCUSED: 1, PRESENT: 0 };

export const weekdayLabels: ReadonlyArray<{ full: string; short: string }> = [
  { full: "Pazartesi", short: "Pzt" },
  { full: "Salı", short: "Sal" },
  { full: "Çarşamba", short: "Çar" },
  { full: "Perşembe", short: "Per" },
  { full: "Cuma", short: "Cum" },
  { full: "Cumartesi", short: "Cmt" },
  { full: "Pazar", short: "Paz" },
];

const monthLabelFormat = new Intl.DateTimeFormat(appLocale, { month: "long", timeZone: "UTC", year: "numeric" });
const dayMonthFormat = new Intl.DateTimeFormat(appLocale, { day: "numeric", month: "long", timeZone: "UTC", weekday: "long" });

export function isMonthKey(value: string | null | undefined): value is AttendanceMonthKey {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

/** "2026-11-03" veya "2026-11" değerinden ay anahtarı. */
export function monthKeyOf(dateKey: string): AttendanceMonthKey {
  return dateKey.slice(0, 7);
}

export function shiftMonth(monthKey: AttendanceMonthKey, delta: number): AttendanceMonthKey {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(monthKey: AttendanceMonthKey): { dateFrom: string; dateTo: string } {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { dateFrom: `${monthKey}-01`, dateTo: `${monthKey}-${String(lastDay).padStart(2, "0")}` };
}

export function formatMonthLabel(monthKey: AttendanceMonthKey): string {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const label = monthLabelFormat.format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toLocaleUpperCase(appLocale) + label.slice(1);
}

/** "3 Kasım Salı" biçiminde ekran okuyucu etiketi. */
export function formatCalendarDayLabel(dateKey: string): string {
  return dayMonthFormat.format(new Date(`${dateKey}T00:00:00Z`));
}

/**
 * Açılış ayı: bu ay kayıt varsa bu ay; bu ayda kayıt yok ama geçmiş kayıt varsa en son kaydın ayı; hiç kayıt yoksa bu ay.
 */
export function defaultCalendarMonth(records: readonly Pick<AttendanceRecord, "date">[], todayKey: string): AttendanceMonthKey {
  const currentMonth = monthKeyOf(todayKey);
  const pastKeys = records.map((record) => record.date.slice(0, 10)).filter((key) => key <= todayKey);
  if (pastKeys.length === 0 || pastKeys.some((key) => monthKeyOf(key) === currentMonth)) return currentMonth;
  return monthKeyOf(pastKeys.reduce((latest, key) => (key > latest ? key : latest)));
}

function emptyCounts(): Record<AttendanceStatus, number> {
  return { ABSENT: 0, EXCUSED: 0, LATE: 0, PRESENT: 0 };
}

export function buildAttendanceCalendarMonth(
  records: readonly Pick<AttendanceRecord, "date" | "status" | "deletedAt">[],
  monthKey: AttendanceMonthKey,
): AttendanceCalendarMonth {
  const [year, month] = monthKey.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDay = new Map<string, AttendanceCalendarDay>();
  const counts = emptyCounts();
  let total = 0;

  for (const record of records) {
    if (record.deletedAt) continue;
    const dateKey = record.date.slice(0, 10);
    if (monthKeyOf(dateKey) !== monthKey) continue;
    const day = byDay.get(dateKey) ?? { counts: emptyCounts(), dateKey, day: Number(dateKey.slice(8, 10)), total: 0 };
    day.counts[record.status] += 1;
    day.total += 1;
    if (!day.status || statusSeverity[record.status] > statusSeverity[day.status]) day.status = record.status;
    byDay.set(dateKey, day);
    counts[record.status] += 1;
    total += 1;
  }

  // Date.getUTCDay: 0 = Pazar; takvim Pazartesi ile başlar.
  const leadingBlanks = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: Array<AttendanceCalendarDay | null> = Array.from({ length: leadingBlanks }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    cells.push(byDay.get(dateKey) ?? { counts: emptyCounts(), dateKey, day, total: 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<AttendanceCalendarDay | null>> = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));

  return { counts, label: formatMonthLabel(monthKey), monthKey, total, weeks };
}

/** "2 kayıt: 1 Yok, 1 Var" gibi bir günün ayrıntısı; tek kayıtlı gün yalnız durumu söyler. */
export function describeCalendarDay(day: AttendanceCalendarDay): string {
  if (!day.status) return "Yoklama kaydı yok";
  if (day.total === 1) return attendanceStatusLabels[day.status];
  const parts = attendanceStatusOrder
    .filter((status) => day.counts[status] > 0)
    .map((status) => `${day.counts[status]} ${attendanceStatusLabels[status]}`);
  return `${day.total} kayıt: ${parts.join(", ")}`;
}
