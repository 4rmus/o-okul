"use client";

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AttendanceSummaryRecord,
  AuditLogRecord,
  ClassRecord,
  CourseRecord,
  ExamRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportStudentQuestionSummary,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  TeacherAssignmentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { ArrowLeft, BarChart3, ChevronRight, LayoutDashboard } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";
import { formatCourseName, formatOutcomeCode, shortCourseName } from "../../_shared/academic-labels.js";
import { ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { formatNetNumber, OutcomeNetTable } from "../../_shared/outcome-net-table.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { fallbackReportExamId, readReportExamId } from "../../_shared/report-exam-selection.js";
import type { StudentRelationshipFlowData } from "./student-relationship-flow.js";

const LazyStudentRelationshipFlow = lazy(() => import("./student-relationship-flow.js"));

interface StudentBaseDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  auditLogs: AuditLogRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  guardianLinks: GuardianStudentRecord[];
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  classHistory: StudentClassHistoryRecord[];
  enrollments: StudentEnrollmentRecord[];
  teacherAssignments: TeacherAssignmentRecord[];
  teachers: TeacherRecord[];
  teacherNotes: TeacherNoteRecord[];
  terms: AcademicTermRecord[];
}

interface StudentDetailPageData {
  detail: StudentBaseDetail;
  exams: ExamRecord[];
}

interface StudentReportData {
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  selectedSnapshot: ReportSnapshotRecord | null;
  snapshots: ReportSnapshotRecord[];
}

type StudentDetailMode = "dashboard" | "exams";

export function StudentDetailPage({ mode = "dashboard", studentId }: { mode?: StudentDetailMode; studentId: string }) {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const requestedReportExamId = readReportExamId(searchParams);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");

  const pageDataQuery = useQuery({
    queryKey: ["next-student-detail-page-data", auth?.session.tenantId ?? "anonymous", studentId],
    queryFn: () => loadStudentDetailPageData(auth?.accessToken ?? "", studentId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const detail = pageDataQuery.data?.detail;
  const studentAuditLogs = useMemo(
    () => (detail?.auditLogs ?? []).filter((record) => isStudentAuditLog(record, studentId)).slice(0, 5),
    [detail?.auditLogs, studentId],
  );
  const guardianNameById = useMemo(
    () => new Map((detail?.guardians ?? []).map((guardian) => [guardian.id, `${guardian.firstName} ${guardian.lastName}`])),
    [detail?.guardians],
  );
  const teacherNameById = useMemo(
    () => new Map((detail?.teachers ?? []).map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`])),
    [detail?.teachers],
  );
  const classNameById = useMemo(() => new Map((detail?.classes ?? []).map((record) => [record.id, record.name])), [detail?.classes]);
  const courseNameById = useMemo(() => new Map((detail?.courses ?? []).map((record) => [record.id, formatCourseName(record.name)])), [detail?.courses]);
  const termNameById = useMemo(() => new Map((detail?.terms ?? []).map((record) => [record.id, record.name])), [detail?.terms]);
  const exams = pageDataQuery.data?.exams ?? [];
  const activeExamId = selectedExamId || preferredExamId(exams, requestedReportExamId);
  const reportDataQuery = useQuery({
    queryKey: [
      "next-student-detail-report-data",
      auth?.session.tenantId ?? "anonymous",
      activeExamId,
      selectedSnapshotId || "auto",
      studentId,
    ],
    queryFn: () => loadStudentReportData(auth?.accessToken ?? "", activeExamId, selectedSnapshotId, studentId),
    enabled: Boolean(auth && activeExamId),
    refetchOnWindowFocus: false,
  });
  const snapshots = reportDataQuery.data?.snapshots ?? [];
  const selectedSnapshot = reportDataQuery.data?.selectedSnapshot ?? null;
  const report = reportDataQuery.data?.report ?? null;
  const errorBooklet = reportDataQuery.data?.errorBooklet ?? null;
  const progress = reportDataQuery.data?.progress ?? null;
  const studentName = detail ? `${detail.profile.firstName} ${detail.profile.lastName}` : "Öğrenci 360";
  const examResult = toStudentExamResult(report);
  const branchRadar = toStudentBranchRadar(report);
  const outcomeRows = toStudentOutcomeRows(report);
  const progressPoints = toProgressPoints(progress);
  const studentDashboardHref = `/kurum/ogrenciler/${encodeURIComponent(studentId)}`;
  const studentExamsHref = `${studentDashboardHref}/sinavlar`;

  useEffect(() => {
    if (!selectedExamId || exams.some((exam) => exam.id === selectedExamId)) return;
    setSelectedExamId("");
    setSelectedSnapshotId("");
  }, [exams, selectedExamId]);

  return (
    <PageFrame
      title={studentName}
      subtitle={mode === "exams" ? "Sınav detayları" : "Öğrenci dashboard"}
      actions={
        <div className="next-student-detail-actions">
          <Link className="uh-button uh-button--secondary" href="/kurum/ogrenciler">
            <ArrowLeft size={17} aria-hidden="true" />
            Öğrencilere dön
          </Link>
          {mode === "exams" ? (
            <Link className="uh-button uh-button--secondary" href={studentDashboardHref}>
              <LayoutDashboard size={17} aria-hidden="true" />
              Dashboard'a dön
            </Link>
          ) : (
            <Link className="uh-button" href={studentExamsHref}>
              <BarChart3 size={17} aria-hidden="true" />
              Sınav detayları
            </Link>
          )}
        </div>
      }
    >
      {pageDataQuery.isPending ? (
        <section className="next-report-panel" aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}>
          <p>Yükleniyor...</p>
        </section>
      ) : pageDataQuery.isError ? (
        <section className="next-report-panel" aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}>
          <p className="uh-crud-page__error">Öğrenci detayı alınamadı.</p>
        </section>
      ) : detail && mode === "exams" ? (
        <StudentExamDetails
          branchRadar={branchRadar}
          errorBooklet={errorBooklet}
          examResult={examResult}
          exams={exams}
          outcomeRows={outcomeRows}
          progress={progress}
          progressPoints={progressPoints}
          report={report}
          selectedExamId={activeExamId}
          selectedSnapshot={selectedSnapshot}
          snapshots={snapshots}
          studentId={studentId}
          onExamChange={(nextExamId) => {
            setSelectedExamId(nextExamId);
            setSelectedSnapshotId("");
          }}
          onSnapshotChange={setSelectedSnapshotId}
        />
      ) : detail ? (
        <StudentDashboard
          classNameById={classNameById}
          courseNameById={courseNameById}
          detail={detail}
          errorBooklet={errorBooklet}
          guardianNameById={guardianNameById}
          progress={progress}
          progressPoints={progressPoints}
          report={report}
          selectedSnapshot={selectedSnapshot}
          studentAuditLogs={studentAuditLogs}
          studentExamsHref={studentExamsHref}
          studentId={studentId}
          termNameById={termNameById}
          teacherNameById={teacherNameById}
        />
      ) : null}
    </PageFrame>
  );
}

function StudentDashboard({
  classNameById,
  courseNameById,
  detail,
  errorBooklet,
  guardianNameById,
  progress,
  progressPoints,
  report,
  selectedSnapshot,
  studentAuditLogs,
  studentExamsHref,
  studentId,
  teacherNameById,
  termNameById,
}: {
  classNameById: ReadonlyMap<string, string>;
  courseNameById: ReadonlyMap<string, string>;
  detail: StudentBaseDetail;
  errorBooklet: ReportErrorBooklet | null;
  guardianNameById: ReadonlyMap<string, string>;
  progress: ReportStudentProgress | null;
  progressPoints: ReturnType<typeof toProgressPoints>;
  report: ReportStudentSnapshot | null;
  selectedSnapshot: ReportSnapshotRecord | null;
  studentAuditLogs: AuditLogRecord[];
  studentExamsHref: string;
  studentId: string;
  teacherNameById: ReadonlyMap<string, string>;
  termNameById: ReadonlyMap<string, string>;
}) {
  const currentClass = formatCurrentClass(detail.profile.classId, classNameById);
  const primaryGuardian = detail.guardianLinks.find((link) => link.isPrimary) ?? detail.guardianLinks[0];
  const primaryGuardianName = primaryGuardian ? guardianNameById.get(primaryGuardian.guardianId) ?? primaryGuardian.guardianId : "Veli bağı yok";
  const activeEnrollment = resolveActiveEnrollment(detail.enrollments);
  const latestAudit = studentAuditLogs[0];
  const relationshipFlowData = buildStudentRelationshipFlowData({
    activeEnrollment,
    classNameById,
    courseNameById,
    currentClass,
    detail,
    guardianNameById,
    teacherNameById,
    termNameById,
  });

  return (
    <section className="next-report-panel" aria-label="Öğrenci dashboard">
      <div className="next-student-dashboard-hero">
        <div>
          <span>Kurum ilişkisi</span>
          <h2>{detail.profile.firstName} {detail.profile.lastName}</h2>
          <p>{currentClass} · {formatStudentStatus(detail.profile.status)} · {primaryGuardianName}</p>
        </div>
        <Link className="uh-button" href={studentExamsHref}>
          <BarChart3 size={17} aria-hidden="true" />
          Sınav detayları
        </Link>
      </div>

      <MetricPanelGrid
        ariaLabel="Öğrenci dashboard özeti"
        metrics={[
          { label: "Kayıt durumu", value: formatStudentStatus(detail.profile.status) },
          { label: "Kurum sınıfı", value: currentClass },
          { label: "Veli bağı", value: detail.guardianLinks.length },
          { label: "Eğitim ekibi", value: detail.teacherAssignments.length },
          { label: "Devamsızlık", value: detail.attendanceSummary?.total ?? 0 },
          { label: "Bekleyen ödeme", value: formatPendingPayment(detail.paymentPlans) },
          { label: "Başarı", value: formatPercentNumber(reportSuccessRate(report?.total)) },
          { label: "Son net", value: formatNetNumber(report?.total?.net) },
          { label: "Soru", value: formatNumber(reportQuestionCount(report?.total)) },
          { label: "Net gelişimi", value: formatDelta(progress?.netDelta) },
        ]}
      />

      <ReportChartPanel description="Hazır raporu olan tüm sınavlardaki başarı yüzdesi, net ve standart puan gelişimi" title="Öğrenci Gelişim Grafiği">
        <ProgressLineChart caption="Tüm sınav başarı gelişimi" points={progressPoints} />
      </ReportChartPanel>

      <section className="next-report-list next-student-relationship-section" aria-label="Öğrenci ilişki haritası">
        <h2>İlişki haritası</h2>
        <p>Sınıf, veli ve öğretmen bağları öğrenci merkezli gösterilir; aynı bilgi liste görünümünde de korunur.</p>
        <div className="next-student-relationship-flow-shell" aria-hidden="true">
          <Suspense fallback={<p className="next-status-note">İlişki haritası yükleniyor...</p>}>
            <LazyStudentRelationshipFlow data={relationshipFlowData} />
          </Suspense>
        </div>
        <div className="next-student-relationship-fallback" aria-label="İlişki haritası liste görünümü">
          <RelationshipList title="Sınıf" items={[relationshipFlowData.classNode]} />
          <RelationshipList title="Veliler" items={relationshipFlowData.guardians} />
          <RelationshipList title="Öğretmenler" items={relationshipFlowData.teachers} />
        </div>
      </section>

      <div className="next-dashboard-summary-grid" aria-label="Öğrenci karar kartları">
        <Link className="next-dashboard-summary-card" href={studentExamsHref}>
          <span>Sınav performansı</span>
          <strong>{formatPercentNumber(reportSuccessRate(report?.total))}</strong>
          <small>
            {selectedSnapshot ? formatSnapshotLabel(selectedSnapshot, studentId) : "Hazır rapor bekleniyor"}
            <ChevronRight size={15} aria-hidden="true" />
          </small>
        </Link>
        <article className="next-dashboard-summary-card">
          <span>Kurum bağı</span>
          <strong>{currentClass}</strong>
          <small>{activeEnrollment ? `${formatEnrollmentReason(activeEnrollment.reason)} · ${formatDate(activeEnrollment.startsAt)}` : "Aktif kayıt bulunamadı"}</small>
        </article>
        <article className="next-dashboard-summary-card">
          <span>Veli erişimi</span>
          <strong>{primaryGuardianName}</strong>
          <small>{primaryGuardian ? formatGuardianPermissions(primaryGuardian) : "Veli izinleri tanımlı değil"}</small>
        </article>
        <article className="next-dashboard-summary-card">
          <span>Takip odağı</span>
          <strong>{errorBooklet ? `${errorBooklet.items.length} soru` : "Hata yok"}</strong>
          <small>{detail.teacherNotes[0]?.body ?? "Öğretmen notu yok"}</small>
        </article>
      </div>

      <div className="next-student-detail-grid">
        <section className="next-report-list" aria-label="İletişim ve veli">
          <h2>İletişim ve veli</h2>
          <p>Telefon: {detail.profile.phone ?? "-"}</p>
          <p>E-posta: {detail.profile.email ?? "-"}</p>
          {detail.guardians.length > 0 ? (
            detail.guardians.map((guardian) => (
              <p key={guardian.id}>
                {guardian.firstName} {guardian.lastName}
                {guardian.phone ? ` - ${guardian.phone}` : ""}
              </p>
            ))
          ) : (
            <p>Bağlı veli yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="İlişki geçmişi">
          <h2>İlişki geçmişi</h2>
          {detail.guardianLinks.length > 0 ? (
            detail.guardianLinks.map((link) => (
              <p key={link.id}>
                {guardianNameById.get(link.guardianId) ?? link.guardianId}: {formatRelationshipType(link.relationshipType)}
                {link.isPrimary ? " - Birincil" : ""} - {formatGuardianPermissions(link)}
                {link.createdAt ? ` - ${formatDateTime(link.createdAt)} tarihinde bağlandı` : ""}
              </p>
            ))
          ) : (
            <p>Veli ilişkisi yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="Öğretmen ilişkileri">
          <h2>Öğretmen ilişkileri</h2>
          {detail.teacherAssignments.length > 0 ? (
            detail.teacherAssignments.map((assignment) => (
              <p key={assignment.id}>
                {teacherNameById.get(assignment.teacherId) ?? assignment.teacherId}: {formatTeacherAssignmentRole(assignment.role)}
                {formatTeacherAssignmentScope(assignment, classNameById, courseNameById, termNameById)}
              </p>
            ))
          ) : (
            <p>Öğretmen ilişkisi yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="Öğretmen notları">
          <h2>Öğretmen notları</h2>
          {detail.teacherNotes.length > 0 ? (
            detail.teacherNotes.map((note) => <p key={note.id}>{note.body}</p>)
          ) : (
            <p>Not yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="Sınıf geçmişi">
          <h2>Sınıf geçmişi</h2>
          {detail.classHistory.length > 0 ? (
            detail.classHistory.map((record) => (
              <p key={record.id}>
                {record.classId ?? "Sınıfsız"} · {formatClassHistoryAcademicContext(record)}: {formatDate(record.startsAt)}
                {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
              </p>
            ))
          ) : (
            <p>Sınıf geçmişi yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="Kayıt geçmişi">
          <h2>Kayıt geçmişi</h2>
          {detail.enrollments.length > 0 ? (
            detail.enrollments.map((record) => (
              <p key={record.id}>
                {formatEnrollmentReason(record.reason)} · {formatStudentStatus(record.status)} · {record.classId ? classNameById.get(record.classId) ?? record.classId : "Sınıfsız"} · {formatClassHistoryAcademicContext(record)}: {formatDate(record.startsAt)}
                {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
              </p>
            ))
          ) : (
            <p>Kayıt geçmişi yok</p>
          )}
        </section>

        <section className="next-report-list" aria-label="Ödevler">
          <h2>Ödevler</h2>
          <p>{detail.homeworkAssignments.length} ödev</p>
        </section>

        <section className="next-report-list" aria-label="Denetim özeti">
          <h2>Denetim özeti</h2>
          {latestAudit ? (
            studentAuditLogs.map((record) => (
              <p key={record.id}>
                {formatDateTime(record.createdAt)} - {formatAuditAction(record.action)}
              </p>
            ))
          ) : (
            <p>Denetim kaydı yok</p>
          )}
        </section>
      </div>
    </section>
  );
}

function RelationshipList({ items, title }: { items: StudentRelationshipFlowData["guardians"]; title: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>Tanımlı kayıt yok.</p>
      )}
    </section>
  );
}

function buildStudentRelationshipFlowData({
  activeEnrollment,
  classNameById,
  courseNameById,
  currentClass,
  detail,
  guardianNameById,
  teacherNameById,
  termNameById,
}: {
  activeEnrollment: StudentEnrollmentRecord | undefined;
  classNameById: ReadonlyMap<string, string>;
  courseNameById: ReadonlyMap<string, string>;
  currentClass: string;
  detail: StudentBaseDetail;
  guardianNameById: ReadonlyMap<string, string>;
  teacherNameById: ReadonlyMap<string, string>;
  termNameById: ReadonlyMap<string, string>;
}): StudentRelationshipFlowData {
  return {
    student: {
      id: detail.profile.id,
      label: `${detail.profile.firstName} ${detail.profile.lastName}`,
      detail: formatStudentStatus(detail.profile.status),
    },
    classNode: {
      id: detail.profile.classId ?? "no-class",
      label: currentClass,
      detail: activeEnrollment
        ? `${formatEnrollmentReason(activeEnrollment.reason)} · ${formatDate(activeEnrollment.startsAt)}`
        : "Aktif kayıt bulunamadı",
    },
    guardians: detail.guardianLinks.map((link) => ({
      id: link.id,
      label: guardianNameById.get(link.guardianId) ?? link.guardianId,
      detail: [
        formatRelationshipType(link.relationshipType),
        link.isPrimary ? "Birincil" : "",
        formatGuardianPermissions(link),
      ].filter(Boolean).join(" · "),
    })),
    teachers: detail.teacherAssignments.map((assignment) => ({
      id: assignment.id,
      label: teacherNameById.get(assignment.teacherId) ?? assignment.teacherId,
      detail: [
        formatTeacherAssignmentRole(assignment.role),
        formatTeacherAssignmentScope(assignment, classNameById, courseNameById, termNameById).replace(/^ - /, ""),
      ].filter(Boolean).join(" · "),
    })),
  };
}

function StudentExamDetails({
  branchRadar,
  errorBooklet,
  examResult,
  exams,
  outcomeRows,
  progress,
  progressPoints,
  report,
  selectedExamId,
  selectedSnapshot,
  snapshots,
  studentId,
  onExamChange,
  onSnapshotChange,
}: {
  branchRadar: ReturnType<typeof toStudentBranchRadar>;
  errorBooklet: ReportErrorBooklet | null;
  examResult: ReturnType<typeof toStudentExamResult>;
  exams: ExamRecord[];
  outcomeRows: ReturnType<typeof toStudentOutcomeRows>;
  progress: ReportStudentProgress | null;
  progressPoints: ReturnType<typeof toProgressPoints>;
  report: ReportStudentSnapshot | null;
  selectedExamId: string;
  selectedSnapshot: ReportSnapshotRecord | null;
  snapshots: ReportSnapshotRecord[];
  studentId: string;
  onExamChange: (examId: string) => void;
  onSnapshotChange: (snapshotId: string) => void;
}) {
  return (
    <section className="next-report-panel" aria-label="Öğrenci sınav detayları">
      <div className="next-detail-selects">
        <label>
          Sınav
          <select aria-label="Sınav" value={selectedExamId} onChange={(event) => onExamChange(event.target.value)}>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sınav raporu
          <select
            aria-label="Sınav raporu"
            disabled={snapshots.length === 0}
            value={selectedSnapshot?.id ?? ""}
            onChange={(event) => onSnapshotChange(event.target.value)}
          >
            {snapshots.length === 0 ? <option value="">Hazır rapor yok</option> : null}
            {snapshots.map((snapshot) => (
              <option key={snapshot.id} value={snapshot.id}>
                {formatSnapshotLabel(snapshot, studentId)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <MetricPanelGrid
        ariaLabel="Sınav rapor özeti"
        metrics={[
          { label: "Başarı", value: formatPercentNumber(reportSuccessRate(report?.total)) },
          { label: "Son net", value: formatNetNumber(report?.total?.net) },
          { label: "Soru", value: formatNumber(reportQuestionCount(report?.total)) },
          { label: "Hata kitapçığı", value: errorBooklet ? `${errorBooklet.items.length} soru` : "-" },
          { label: "Net gelişimi", value: formatDelta(progress?.netDelta) },
          { label: "LGS puanı", value: formatNumber(readLgsScore(report?.total)) },
          { label: "Standart puan", value: formatNumber(report?.total?.standardScore) },
        ]}
      />

      {report ? (
        <>
          <div className="next-report-visual-grid">
            <ReportChartPanel description="Soru sayısına göre başarı ve doğruluk dağılımı" title="Öğrenci Sonuç Dağılımı">
              <ExamResultDonut result={examResult} />
            </ReportChartPanel>
            <ReportChartPanel description="Rapor bazlı branş başarıları" title="Branş Başarıları">
              <TopicRadarChart branches={branchRadar} caption="Öğrenci branş başarıları" />
            </ReportChartPanel>
            <ReportChartPanel description="Kazanım bazlı başarı ve net karşılaştırması" title="Kazanım Başarıları">
              <OutcomeNetTable caption="Öğrenci kazanım başarıları" rows={outcomeRows} />
            </ReportChartPanel>
            <ReportChartPanel description="Başarı yüzdesi, net ve standart puan gelişimi" title="Öğrenci Gelişim">
              <ProgressLineChart caption="Öğrenci başarı gelişimi" points={progressPoints} />
            </ReportChartPanel>
          </div>

          <section className="next-report-list" aria-label="Hata kitapçığı">
            <h2>Hata kitapçığı</h2>
            <ErrorBookletTable
              caption="Öğrenci hata kitapçığı"
              emptyLabel="Hata kaydı yok"
              items={errorBooklet?.items ?? []}
            />
          </section>
        </>
      ) : (
        <section className="next-report-list" aria-label="Hazır rapor durumu">
          <h2>Hazır rapor yok</h2>
          <p>Bu öğrenci için seçili sınava ait hazır rapor bulunamadı.</p>
        </section>
      )}
    </section>
  );
}

function ErrorBookletTable({
  caption,
  emptyLabel,
  items,
}: {
  caption: string;
  emptyLabel: string;
  items: ReportStudentQuestionSummary[];
}) {
  return (
    <table className="uh-chart-table next-error-booklet-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Soru</th>
          <th scope="col">Ders</th>
          <th scope="col">Kazanım</th>
          <th scope="col">Durum</th>
          <th scope="col">Yanıt</th>
          <th scope="col">Doğru</th>
        </tr>
      </thead>
      <tbody>
        {items.length > 0 ? (
          items.map((item) => (
            <tr key={`${item.questionNo}-${item.branch}-${item.status}`}>
              <th scope="row">{item.questionNo}</th>
              <td>{formatCourseName(item.branch)}</td>
              <td>{item.outcomeCode ? formatOutcomeCode(item.outcomeCode) : "-"}</td>
              <td>{formatQuestionStatus(item.status)}</td>
              <td>{item.status === "BLANK" ? "Boş" : item.answer}</td>
              <td>{item.correctAnswer}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6}>{emptyLabel}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function formatQuestionStatus(status: ReportStudentQuestionSummary["status"]) {
  const labels: Record<ReportStudentQuestionSummary["status"], string> = {
    BLANK: "Boş",
    CORRECT: "Doğru",
    WRONG: "Yanlış",
  };
  return labels[status] ?? status;
}

async function loadStudentDetailPageData(accessToken: string, id: string): Promise<StudentDetailPageData> {
  const [detail, exams] = await Promise.all([
    loadStudentBaseDetail(accessToken, id),
    loadExams(accessToken),
  ]);
  return { detail, exams };
}

async function loadStudentBaseDetail(accessToken: string, id: string): Promise<StudentBaseDetail> {
  const [
    attendanceSummary,
    auditLogs,
    guardianLinks,
    profile,
    guardians,
    homeworkAssignments,
    paymentPlans,
    classHistory,
    enrollments,
    teacherAssignments,
    teachers,
    teacherNotes,
    classes,
    courses,
    terms,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<AuditLogRecord[]>(accessToken, `${apiBaseUrl}/audit-logs`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardian-links`),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/class-history`),
    apiRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments`),
    apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/teacher-assignments`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/teacher-notes?studentId=${encodeURIComponent(id)}`),
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    attendanceSummary,
    auditLogs: auditLogs ?? [],
    classes,
    courses,
    guardianLinks,
    guardians,
    homeworkAssignments,
    paymentPlans,
    profile,
    classHistory,
    enrollments,
    teacherAssignments,
    teachers,
    teacherNotes,
    terms,
  };
}

async function loadExams(accessToken: string): Promise<ExamRecord[]> {
  const exams = await apiRequestOrNull<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
  return exams && exams.length > 0
    ? exams
    : [{
        id: fallbackReportExamId,
        tenantId: "",
        title: "Demo sınav",
        status: "PUBLISHED",
        createdAt: "",
        updatedAt: "",
      }];
}

function preferredExamId(exams: ExamRecord[], requestedExamId = fallbackReportExamId) {
  return exams.find((exam) => exam.id === requestedExamId)?.id
    ?? exams.find((exam) => exam.status === "PUBLISHED")?.id
    ?? exams[0]?.id
    ?? requestedExamId;
}

async function loadStudentSnapshots(accessToken: string, examId: string, studentId: string) {
  const snapshots = await apiRequestOrNull<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );
  return (snapshots ?? []).filter((snapshot) =>
    snapshot.status === "READY" && snapshot.snapshotData?.students?.some((student) => student.studentId === studentId),
  );
}

async function loadStudentReportData(
  accessToken: string,
  examId: string,
  selectedSnapshotId: string,
  studentId: string,
): Promise<StudentReportData> {
  const snapshots = await loadStudentSnapshots(accessToken, examId, studentId);
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? snapshots[0] ?? null;
  const [report, errorBooklet, progress] = await Promise.all([
    selectedSnapshot
      ? apiRequestOrNull<ReportStudentSnapshot>(
          accessToken,
          `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(selectedSnapshot.id)}/students/${encodeURIComponent(studentId)}`,
        )
      : Promise.resolve(null),
    selectedSnapshot
      ? apiRequestOrNull<ReportErrorBooklet>(
          accessToken,
          `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(selectedSnapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
        )
      : Promise.resolve(null),
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
    ),
  ]);
  return { errorBooklet, progress, report, selectedSnapshot, snapshots };
}

async function loadStudentHomeworkAssignments(accessToken: string, studentId: string) {
  const materials = await apiRequest<HomeworkMaterialRecord[]>(accessToken, `${apiBaseUrl}/homework/materials`);
  const assignmentLists = await Promise.all(
    materials.map((material) =>
      apiRequest<HomeworkMaterialAssignmentRecord[]>(
        accessToken,
        `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/assignments`,
      ),
    ),
  );
  return assignmentLists.flat().filter((assignment) => assignment.studentId === studentId);
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch {
    return null;
  }
}

function formatSnapshotLabel(snapshot: ReportSnapshotRecord, studentId: string) {
  const date = snapshot.generatedAt ?? snapshot.snapshotData?.generatedAt ?? snapshot.createdAt;
  const prefix = date ? new Date(date).toLocaleDateString("tr-TR") : snapshot.id;
  const student = snapshot.snapshotData?.students?.find((record) => record.studentId === studentId);
  return `${prefix} - ${formatNetNumber(student?.total?.net)} net`;
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency}`;
}

function formatPendingPayment(plans: PaymentPlanWithInstallmentsRecord[]) {
  const total = plans.reduce(
    (sum, plan) =>
      sum + plan.installments
        .filter((installment) => installment.status === "PENDING" || installment.status === "OVERDUE")
        .reduce((installmentSum, installment) => installmentSum + installment.amount, 0),
    0,
  );
  return formatMoney(total, plans[0]?.currency ?? "TRY");
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function readLgsScore(total: { estimatedRawScore?: number; standardScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore;
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return value > 0 ? `+${formatNetNumber(value)}` : formatNetNumber(value);
}

function isStudentAuditLog(record: AuditLogRecord, studentId: string) {
  return (record.entityType === "Student" && record.entityId === studentId) ||
    (record.entityType === "GuardianStudent" && record.diff?.studentId === studentId);
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    "guardian_student.linked": "Veli ilişkisi kuruldu",
    "guardian_student.unlinked": "Veli ilişkisi kaldırıldı",
    "guardian_student.updated": "Veli ilişkisi güncellendi",
    "student.created": "Öğrenci oluşturuldu",
    "student.deleted": "Öğrenci silindi",
    "student.profile_updated": "Profil güncellendi",
    "student.profile_viewed": "Profil görüntülendi",
    "student.updated": "Öğrenci bilgisi güncellendi",
  };
  return labels[action] ?? action;
}

function formatRelationshipType(value: GuardianStudentRecord["relationshipType"]) {
  const labels: Record<GuardianStudentRecord["relationshipType"], string> = {
    EMERGENCY_CONTACT: "Acil kişi",
    FATHER: "Baba",
    GUARDIAN: "Vasi",
    MOTHER: "Anne",
    OTHER: "Diğer",
  };
  return labels[value] ?? value;
}

function formatTeacherAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  const labels: Record<TeacherAssignmentRecord["role"], string> = {
    BRANCH_TEACHER: "Branş öğretmeni",
    CLASS_TEACHER: "Sınıf öğretmeni",
    GUIDANCE_COUNSELOR: "Rehber öğretmen",
    RESPONSIBLE_TEACHER: "Sorumlu öğretmen",
  };
  return labels[role] ?? role;
}

function formatTeacherAssignmentScope(
  assignment: TeacherAssignmentRecord,
  classNames: ReadonlyMap<string, string>,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  const parts = [
    assignment.classId ? classNames.get(assignment.classId) ?? assignment.classId : undefined,
    assignment.courseId ? courseNames.get(assignment.courseId) ?? assignment.courseId : undefined,
    assignment.termId ? termNames.get(assignment.termId) ?? assignment.termId : undefined,
    assignment.startsAt ? formatDate(assignment.startsAt) : undefined,
    assignment.endsAt ? formatDate(assignment.endsAt) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? ` - ${parts.join(" · ")}` : "";
}

function formatStudentStatus(status: StudentProfileRecord["status"]) {
  const labels: Record<StudentProfileRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? status;
}

function formatCurrentClass(classId: string | undefined, classNameById: ReadonlyMap<string, string>) {
  return classId ? classNameById.get(classId) ?? classId : "Sınıfsız";
}

function resolveActiveEnrollment(records: StudentEnrollmentRecord[]) {
  return records.find((record) => !record.endsAt) ?? records[0];
}

function formatClassHistoryAcademicContext(record: { academicYearId?: string; termId?: string }) {
  return [record.academicYearId, record.termId].filter(Boolean).join(" / ") || "Akademik bağlam yok";
}

function formatEnrollmentReason(reason: string | undefined) {
  const labels: Record<string, string> = {
    CLASS_CHANGED: "Sınıf değişikliği",
    CREATED: "İlk kayıt",
    RENEWED: "Kayıt yenileme",
    TRANSFERRED: "Nakil",
  };
  return reason ? labels[reason] ?? reason : "Kayıt";
}

function formatGuardianPermissions(link: GuardianStudentRecord) {
  const permissions = [
    link.canViewFinance ? "Ödeme görür" : "Ödeme kapalı",
    link.canReceiveSms ? "SMS alır" : "SMS kapalı",
    link.canReceiveAnnouncements ? "Duyuru alır" : "Duyuru kapalı",
    link.canOpenSupportTickets ? "Destek açar" : "Destek kapalı",
  ];
  return permissions.join(", ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function toStudentExamResult(report: ReportStudentSnapshot | null) {
  return {
    correct: report?.total?.correct ?? 0,
    wrong: report?.total?.wrong ?? 0,
    blank: report?.total?.blank ?? 0,
    net: report?.total?.net ?? 0,
    questionCount: report?.total?.questionCount ?? reportQuestionCount(report?.total),
    successRate: report?.total?.successRate ?? reportSuccessRate(report?.total),
  };
}

function toStudentBranchRadar(report: ReportStudentSnapshot | null) {
  return (report?.branches ?? []).map((branch) => ({
    branch: formatCourseName(branch.branch),
    chartLabel: shortCourseName(branch.branch),
    blank: branch.blank,
    correct: branch.correct,
    net: branch.net ?? 0,
    questionCount: branch.questionCount ?? reportQuestionCount(branch),
    successRate: branch.successRate ?? reportSuccessRate(branch),
    wrong: branch.wrong,
  }));
}

function toStudentOutcomeRows(report: ReportStudentSnapshot | null) {
  return [...(report?.outcomes ?? [])]
    .sort((first, second) => (reportSuccessRate(second) ?? Number.NEGATIVE_INFINITY) - (reportSuccessRate(first) ?? Number.NEGATIVE_INFINITY))
    .slice(0, 12)
    .map((outcome, index) => ({
      courseName: formatCourseName(outcome.branch),
      id: `${outcome.branch}-${outcome.outcomeCode}-${index}`,
      net: outcome.net,
      outcomeCode: formatOutcomeCode(outcome.outcomeCode),
      questionCount: outcome.questionCount ?? reportQuestionCount(outcome),
      successRate: outcome.successRate ?? reportSuccessRate(outcome),
    }));
}

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}
