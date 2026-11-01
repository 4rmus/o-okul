import type { AttendanceSummaryRecord } from "@o-okul/shared-types";

// "Devamsızlık" alanı toplam yoklama kaydını değil durum sayılarını gösterir; geldiği günler devamsızlık sayılmaz.
export function formatAttendanceSummary(summary: Pick<AttendanceSummaryRecord, "absent" | "excused" | "late" | "total"> | null | undefined) {
  if (!summary) return "-";
  if (summary.total === 0) return "Kayıt yok";
  return [
    `${summary.absent} yok`,
    summary.late > 0 ? `${summary.late} geç` : null,
    summary.excused > 0 ? `${summary.excused} izinli` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}
