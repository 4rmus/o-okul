import type {
  AttendanceRecord,
  DevelopmentAssessmentRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportStudentProgressPoint,
  StudentHomeworkRecord,
  StudentPublishedGradeItem,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
import { istanbulDateKey } from "../../_shared/format.js";
import { gradeKindLabels } from "../../_shared/gradebook/gradebook-api.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

// Öğrenci 360 zaman çizelgesi (DEC-20261102-08, yalnız personel): olaylar sayfanın zaten okuduğu kaynaklardan ve
// birkaç sınırlı istekten türetilir; olay başına istek atılmaz. Öğretmen notu ve gelişim değerlendirmesinin metni
// zaman çizelgesine taşınmaz, yalnız türü, görünürlüğü ve tarihi görünür.

export type StudentTimelineEventKind = "attendance" | "grade" | "exam" | "homework" | "material" | "note" | "development" | "finance";

export type StudentTimelineTone = "danger" | "info" | "neutral" | "success" | "warning";

export interface StudentTimelineLink {
  href: string;
  label: string;
}

export interface StudentTimelineEvent {
  id: string;
  kind: StudentTimelineEventKind;
  /** Türkiye takvim günü: "2026-11-03". */
  dateKey: string;
  /** Aynı gün içindeki sıralama için ISO anı; yalnız gün bilinen olaylarda gün anahtarıdır. */
  sortKey: string;
  title: string;
  detail?: string;
  status?: { label: string; tone: StudentTimelineTone };
  link?: StudentTimelineLink;
}

export const studentTimelineKindLabels: Record<StudentTimelineEventKind, string> = {
  attendance: "Yoklama",
  development: "Gelişim",
  exam: "Sınav",
  finance: "Finans",
  grade: "Okul notu",
  homework: "Ödev",
  material: "Materyal",
  note: "Öğretmen notu",
};

export const studentTimelineKindOrder: readonly StudentTimelineEventKind[] = [
  "attendance",
  "grade",
  "exam",
  "homework",
  "material",
  "note",
  "development",
  "finance",
];

export interface StudentTimelineSources {
  attendance: readonly AttendanceRecord[];
  development: readonly Pick<DevelopmentAssessmentRecord, "createdAt" | "id" | "periodLabel" | "visibility">[];
  examPoints: readonly ReportStudentProgressPoint[];
  grades: readonly StudentPublishedGradeItem[];
  homework: readonly StudentHomeworkRecord[];
  materialAssignments: readonly HomeworkMaterialAssignmentRecord[];
  paymentPlans: readonly PaymentPlanWithInstallmentsRecord[];
  teacherNotes: readonly TeacherNoteRecord[];
}

export interface StudentTimelineContext {
  courseNameById: ReadonlyMap<string, string>;
  /** Finans olayları yalnız finans görünürlüğü olan personele üretilir. */
  canViewFinance: boolean;
  /** Pencerenin ilk günü (dahil). */
  fromKey: string;
  /** Hedef ekran bu rolde açılabiliyorsa bağlantı üretilir. */
  links: Partial<Record<StudentTimelineEventKind, (event: { classId?: string }) => string | undefined>>;
  linkLabels?: Partial<Record<StudentTimelineEventKind, string>>;
  /** Bugün (dahil); gelecek tarihli olaylar listelenmez. */
  todayKey: string;
}

const attendanceTimelineStatus: Record<Exclude<AttendanceRecord["status"], "PRESENT">, { label: string; tone: StudentTimelineTone }> = {
  ABSENT: { label: "Yok", tone: "danger" },
  EXCUSED: { label: "İzinli", tone: "info" },
  LATE: { label: "Geç", tone: "warning" },
};

const defaultLinkLabels: Record<StudentTimelineEventKind, string> = {
  attendance: "Yoklama",
  development: "Gelişim kriterleri",
  exam: "Sınav detayları",
  finance: "Ödeme planları",
  grade: "Not defteri",
  homework: "Ödev ve materyal",
  material: "Ödev ve materyal",
  note: "Öğretmen notları",
};

/** ISO anı veya takvim gününü Türkiye takvim gününe çevirir; geçersiz değer için undefined. */
export function timelineDateKey(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : istanbulDateKey(date);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildStudentTimeline(sources: StudentTimelineSources, context: StudentTimelineContext): StudentTimelineEvent[] {
  const events: StudentTimelineEvent[] = [];
  const courseName = (courseId: string | undefined) => (courseId ? context.courseNameById.get(courseId) : undefined);
  const link = (kind: StudentTimelineEventKind, scope: { classId?: string } = {}): StudentTimelineLink | undefined => {
    const href = context.links[kind]?.(scope);
    return href ? { href, label: context.linkLabels?.[kind] ?? defaultLinkLabels[kind] } : undefined;
  };
  const push = (event: Omit<StudentTimelineEvent, "dateKey" | "sortKey"> & { at: string | undefined }) => {
    const dateKey = timelineDateKey(event.at);
    if (!dateKey || dateKey < context.fromKey || dateKey > context.todayKey) return;
    const { at, ...rest } = event;
    events.push({ ...rest, dateKey, sortKey: at && at.length > 10 ? at : dateKey });
  };

  // Yoklama: yalnız Yok/Geç/İzinli günleri olay sayılır; "Var" kayıtları takvimde görünür.
  for (const record of sources.attendance) {
    if (record.deletedAt || record.status === "PRESENT") continue;
    const status = attendanceTimelineStatus[record.status];
    push({
      at: record.date,
      detail: courseName(record.courseId),
      id: `attendance:${record.id}`,
      kind: "attendance",
      link: link("attendance", { classId: record.classId }),
      status,
      title: `Yoklama: ${status.label}`,
    });
  }

  // Yalnız yayınlanmış not sürümleri gelir (API taslak döndürmez); her not kendi ölçeğindedir, Başarı % ile karışmaz.
  for (const grade of sources.grades) {
    const score = grade.absent || grade.score === null ? "Girmedi" : `${formatScore(grade.score)} / ${formatScore(grade.maxScore)}`;
    push({
      at: grade.heldOn,
      detail: [courseName(grade.courseId), score, grade.version > 1 ? `${grade.version}. sürüm` : undefined].filter(Boolean).join(" · "),
      id: `grade:${grade.assessmentId}`,
      kind: "grade",
      link: link("grade", { classId: grade.classId }),
      status: grade.absent ? { label: "Girmedi", tone: "warning" } : undefined,
      title: `${gradeKindLabels[grade.kind] ?? "Değerlendirme"}: ${grade.title}`,
    });
  }

  // Sınav: Başarı % birincil ölçüdür; Net ve Soru bağlam olarak yanında durur.
  for (const point of sources.examPoints) {
    const successRate = reportSuccessRate(point.total);
    const questionCount = reportQuestionCount(point.total);
    const net = point.total.net;
    push({
      at: point.generatedAt,
      detail: [
        `Başarı ${formatPercentNumber(successRate)}`,
        typeof net === "number" ? `Net ${formatNet(net)}` : undefined,
        questionCount !== undefined ? `Soru ${questionCount}` : undefined,
      ].filter(Boolean).join(" · "),
      id: `exam:${point.snapshotId}`,
      kind: "exam",
      link: link("exam"),
      title: `Sınav sonucu: ${point.examTitle ?? "Sınav"}`,
    });
  }

  for (const homework of sources.homework) {
    const { submission } = homework;
    if (submission.checkedAt) {
      push({ at: submission.checkedAt, id: `homework-checked:${homework.id}`, kind: "homework", link: link("homework", { classId: homework.classId }), status: { label: "Kontrol edildi", tone: "success" }, title: `Ödev kontrol edildi: ${homework.title}` });
    }
    if (submission.submittedAt) {
      push({ at: submission.submittedAt, id: `homework-submitted:${homework.id}`, kind: "homework", link: link("homework", { classId: homework.classId }), status: { label: "Teslim edildi", tone: "info" }, title: `Ödev teslim edildi: ${homework.title}` });
    } else if (homework.dueAt && (timelineDateKey(homework.dueAt) ?? "") < context.todayKey) {
      push({ at: homework.dueAt, id: `homework-missed:${homework.id}`, kind: "homework", link: link("homework", { classId: homework.classId }), status: { label: "Teslim edilmedi", tone: "warning" }, title: `Ödev teslim tarihi geçti: ${homework.title}` });
    }
  }

  for (const assignment of sources.materialAssignments) {
    push({
      at: assignment.createdAt,
      detail: courseName(assignment.courseId),
      id: `material:${assignment.id}`,
      kind: "material",
      link: link("material"),
      title: `Materyal atandı: ${assignment.materialTitle ?? "Materyal"}`,
    });
  }

  for (const note of sources.teacherNotes) {
    if (note.deletedAt) continue;
    push({
      at: note.createdAt,
      detail: [note.visibility === "INTERNAL" ? "Kurum içi" : "Veli/öğrenci görünür", courseName(note.courseId)].filter(Boolean).join(" · "),
      id: `note:${note.id}`,
      kind: "note",
      link: link("note"),
      status: note.developmentStatus === "WATCH" ? { label: "Takipte", tone: "warning" } : note.developmentStatus === "IMPROVING" ? { label: "Gelişim olumlu", tone: "success" } : undefined,
      title: "Öğretmen notu eklendi",
    });
  }

  // INTERNAL kayıtlar API'nin RK-6 süzgecinden geçtiyse gelir; mentör notu metni gösterilmez.
  for (const assessment of sources.development) {
    push({
      at: assessment.createdAt,
      detail: assessment.visibility === "INTERNAL" ? "Kurum içi" : "Veliyle paylaşılan",
      id: `development:${assessment.id}`,
      kind: "development",
      link: link("development"),
      title: `Gelişim değerlendirmesi: ${assessment.periodLabel}`,
    });
  }

  if (context.canViewFinance) {
    for (const plan of sources.paymentPlans) {
      for (const transaction of plan.transactions ?? []) {
        if (transaction.voidedAt) continue;
        push({
          at: transaction.paidAt,
          detail: `${formatMoney(transaction.amount, transaction.currency)} · Makbuz ${transaction.receiptNo}`,
          id: `payment:${transaction.id}`,
          kind: "finance",
          link: link("finance"),
          status: { label: "Ödendi", tone: "success" },
          title: "Ödeme alındı",
        });
      }
      for (const installment of plan.installments) {
        if (installment.deletedAt || !installment.overdue) continue;
        push({
          at: installment.dueDate,
          detail: formatMoney(installment.amount, plan.currency),
          id: `installment:${installment.id}`,
          kind: "finance",
          link: link("finance"),
          status: { label: "Gecikti", tone: "danger" },
          title: `${installment.installmentNo}. taksit vadesi geçti`,
        });
      }
    }
  }

  return events.sort((left, right) =>
    right.dateKey.localeCompare(left.dateKey) || right.sortKey.localeCompare(left.sortKey) || left.id.localeCompare(right.id));
}

function formatScore(value: number) {
  return value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatNet(value: number) {
  return value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Tutarlar kuruş olarak saklanır. */
function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency}`;
}
