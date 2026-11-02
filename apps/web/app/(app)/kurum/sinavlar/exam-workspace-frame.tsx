"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  canAccessExamWorkspace,
  type ExamWorkspaceNextAction,
  type ExamWorkspaceReadModel,
  type ExamWorkspaceReadinessKey,
} from "@o-okul/shared-types";
import { PageHeader, StatusBadge, Stepper, type StepperStep } from "@o-okul/ui";
import { ArrowRight } from "lucide-react";
import { ApiRequestError, apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { examManagementHref, examWorkspaceHref, opticalWorkspaceHref, reportWorkspaceHref } from "./exam-workspace-routes.js";

// Değerlendirme kuyrukta sürerken çalışma alanı 5 sn'de bir yenilenir; sonraki iş değişince yenileme durur.
export const evaluationPollIntervalMs = 5_000;

export function useExamWorkspace(examId: string, options: { pollEvaluation?: boolean } = {}) {
  const { auth } = useAuth();
  const eligible = Boolean(auth && canAccessExamWorkspace(auth.session.roles, auth.session.activePersona));
  const query = useQuery({
    queryKey: ["next-exam-workspace", auth?.session.tenantId ?? "anonymous", examId],
    queryFn: () => apiRequest<ExamWorkspaceReadModel>(auth?.accessToken ?? "", `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/workspace`),
    enabled: eligible,
    refetchOnWindowFocus: false,
    // Yalnız çerçeve yoklar; alt sayfalar aynı önbellekten güncellenir, ikinci zamanlayıcı açılmaz.
    refetchInterval: options.pollEvaluation
      ? (current) => (isWorkspaceReadModel(current.state.data) && current.state.data.nextAction === "WAIT_EVALUATION" ? evaluationPollIntervalMs : false)
      : false,
  });
  const workspace = isWorkspaceReadModel(query.data) ? query.data : undefined;
  return { eligible, query, workspace };
}

// Sınav çalışma alanı çerçevesi (§4): sayfa başlığı (sınav adı), sunucuda hesaplanan 8 adımlı Stepper ve tek
// birincil sonraki iş. Alt sayfalar (genel, optik, değerlendirme, rapor) kendi başlığını ve sınav seçicisini çizmez.
// Hazırlık okunamazsa alt sayfa yine çalışır; client hazırlık tahmini yapmaz.
export function ExamWorkspaceFrame({ children, examId }: { children: ReactNode; examId: string }) {
  const pathname = usePathname();
  const { eligible, query, workspace } = useExamWorkspace(examId, { pollEvaluation: true });
  const nextHref = workspace ? nextActionHref(workspace.nextAction, examId) : "";
  const isWaitingEvaluation = workspace?.nextAction === "WAIT_EVALUATION";
  // Sınav yok veya erişilemiyorsa (404/403) çerçeve yalnız nötr başlığı çizer; bulunamadı mesajı alt sayfanındır.
  const isExamUnavailable = query.error instanceof ApiRequestError && (query.error.status === 404 || query.error.status === 403);

  return (
    <div className="next-exam-workspace" data-exam-workspace-layout="stepper">
      {eligible ? (
        <section aria-label="Sınav çalışma alanı" className="next-exam-workspace-frame">
          {workspace ? (
            <>
              <PageHeader
                subtitle={(
                  <span className="next-exam-workspace-frame__context">
                    <span>{formatDateTime(workspace.exam.startsAt)}</span>
                    <StatusBadge tone={workspace.exam.status === "PUBLISHED" ? "success" : "warning"}>{examStatusLabel(workspace.exam.status)}</StatusBadge>
                  </span>
                )}
                title={workspace.exam.title}
              />
              <Stepper currentHref={pathname} label="Sınav adımları" linkComponent={Link} steps={buildWorkspaceSteps(workspace, examId)} />
              <div aria-label="Sonraki önerilen iş" className="next-exam-workspace-frame__next" data-next-action={workspace.nextAction} role="group">
                <p aria-live={isWaitingEvaluation ? "polite" : undefined} role={isWaitingEvaluation ? "status" : undefined}>
                  {nextActionDescription(workspace)}
                  {isWaitingEvaluation ? ` ${evaluationPercentLabel(workspace)}Durum otomatik yenilenir.` : null}
                </p>
                {/* Önerilen işin sayfasındaysa bağlantı kendine döner; o sayfadaki iş formu birincil kalır. */}
                {!isSameWorkspaceStep(pathname, nextHref, examId) ? (
                  <Link className="uh-button uh-button--primary uh-button--md" href={nextHref}>
                    <span className="uh-button__content">
                      {nextActionLabel(workspace.nextAction)}
                      <ArrowRight aria-hidden="true" size={17} />
                    </span>
                  </Link>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <PageHeader title="Sınav çalışma alanı" />
              {query.isPending ? (
                <p className="next-status-note">Sınav hazırlığı yükleniyor.</p>
              ) : isExamUnavailable ? null : (
                <p className="next-status-note" role="status">Sınav hazırlık durumu şu an alınamadı.</p>
              )}
            </>
          )}
        </section>
      ) : null}
      {children}
    </div>
  );
}

const stepDefinitions: Array<{ key: string; label: string; readiness: ExamWorkspaceReadinessKey; actions: ExamWorkspaceNextAction[] }> = [
  { key: "info", label: "Sınav bilgisi", readiness: "PUBLISHED", actions: ["PUBLISH_EXAM"] },
  { key: "participants", label: "Katılımcılar", readiness: "PARTICIPANTS", actions: ["ADD_PARTICIPANTS"] },
  { key: "answer-key", label: "Cevap anahtarı", readiness: "ANSWER_KEY", actions: ["ADD_ANSWER_KEY"] },
  { key: "layout", label: "Optik düzen", readiness: "OPTICAL_LAYOUT", actions: ["OPEN_OPTICAL"] },
  { key: "import", label: "Yükleme", readiness: "IMPORT", actions: ["UPLOAD_OPTICAL"] },
  { key: "matching", label: "Eşleşmeyenler", readiness: "MATCHING", actions: ["RESOLVE_UNMATCHED"] },
  { key: "evaluation", label: "Değerlendirme", readiness: "EVALUATION", actions: ["WAIT_EVALUATION"] },
  { key: "report", label: "Rapor", readiness: "REPORT", actions: ["GENERATE_REPORT"] },
];

function buildWorkspaceSteps(workspace: ExamWorkspaceReadModel, examId: string): StepperStep[] {
  const managementHref = examManagementHref(examId);
  const hrefs: Record<string, string> = {
    info: examWorkspaceHref(examId),
    participants: managementHref,
    "answer-key": managementHref,
    layout: opticalWorkspaceHref(examId, "format"),
    import: opticalWorkspaceHref(examId, "upload"),
    matching: opticalWorkspaceHref(examId, "quarantine"),
    evaluation: examWorkspaceHref(examId, "degerlendirme"),
    report: reportWorkspaceHref(examId, "overview"),
  };
  return stepDefinitions.map((definition) => {
    const step = workspace.readiness.find((candidate) => candidate.key === definition.readiness);
    const status = step?.status === "READY"
      ? "complete"
      : definition.actions.includes(workspace.nextAction)
        ? "current"
        : step?.blocker === "UNMATCHED_ROWS"
          ? "blocked"
          : "upcoming";
    return {
      description: stepDescription(definition.key, workspace),
      href: hrefs[definition.key],
      key: definition.key,
      label: definition.label,
      status,
    };
  });
}

function nextActionHref(nextAction: ExamWorkspaceNextAction, examId: string) {
  switch (nextAction) {
    case "OPEN_OPTICAL":
      return opticalWorkspaceHref(examId, "format");
    case "UPLOAD_OPTICAL":
      return opticalWorkspaceHref(examId, "upload");
    case "RESOLVE_UNMATCHED":
      return opticalWorkspaceHref(examId, "quarantine");
    case "WAIT_EVALUATION":
      return examWorkspaceHref(examId, "degerlendirme");
    case "GENERATE_REPORT":
    case "OPEN_REPORT":
      return reportWorkspaceHref(examId, "overview");
    default:
      return examManagementHref(examId);
  }
}

// Rapor sekmeleri (genel, öğrenciler, karne, çıktılar) tek "Rapor" adımıdır.
function isSameWorkspaceStep(pathname: string, href: string, examId: string) {
  if (pathname === href) return true;
  const reportBase = `${examWorkspaceHref(examId)}/rapor/`;
  return pathname.startsWith(reportBase) && href.startsWith(reportBase);
}

function stepDescription(key: string, workspace: ExamWorkspaceReadModel) {
  if (key === "matching" && workspace.progress.openQuarantineCount > 0) return `${workspace.progress.openQuarantineCount} satır eşleşmedi`;
  if (key === "evaluation" && workspace.nextAction === "WAIT_EVALUATION") {
    return `${workspace.progress.evaluatedCount}/${workspace.progress.matchedCount} değerlendirildi`;
  }
  return undefined;
}

function evaluationPercentLabel(workspace: ExamWorkspaceReadModel) {
  const { evaluatedCount, matchedCount } = workspace.progress;
  if (matchedCount <= 0) return "";
  const percent = Math.min(100, Math.floor((evaluatedCount / matchedCount) * 100));
  return `İlerleme %${new Intl.NumberFormat("tr-TR").format(percent)}. `;
}

function nextActionLabel(nextAction: ExamWorkspaceNextAction) {
  return {
    ADD_ANSWER_KEY: "Cevap anahtarını tamamla",
    ADD_PARTICIPANTS: "Katılımcı ekle",
    PUBLISH_EXAM: "Sınavı yayınla",
    OPEN_OPTICAL: "Optik düzeni onayla",
    UPLOAD_OPTICAL: "Optik dosyasını yükle",
    RESOLVE_UNMATCHED: "Eşleşmeyen satırları çöz",
    WAIT_EVALUATION: "Değerlendirmeyi izle",
    GENERATE_REPORT: "Raporu hazırla",
    OPEN_REPORT: "Raporu aç",
  }[nextAction];
}

function nextActionDescription(workspace: ExamWorkspaceReadModel) {
  return {
    ADD_ANSWER_KEY: "Cevap anahtarı eksik; sınav yönetiminde tamamlayın.",
    ADD_PARTICIPANTS: "Katılımcı yok; sınav yönetiminde en az bir katılımcı ekleyin.",
    PUBLISH_EXAM: "Sınav taslak; yayınlandıktan sonra optik akışı açılır.",
    OPEN_OPTICAL: "Optik akışına hazır; önce optik düzeni onaylayın.",
    UPLOAD_OPTICAL: "Optik düzen onaylı; TXT veya DAT dosyasını yükleyin.",
    RESOLVE_UNMATCHED: `${workspace.progress.openQuarantineCount} satır öğrenciyle eşleşmedi; sonuçlar eksik kalır.`,
    WAIT_EVALUATION: `Değerlendirme sürüyor: ${workspace.progress.evaluatedCount}/${workspace.progress.matchedCount} satır tamamlandı.`,
    GENERATE_REPORT: "Değerlendirme tamamlandı; raporu hazırlayın.",
    OPEN_REPORT: "Rapor hazır.",
  }[workspace.nextAction];
}

function isWorkspaceReadModel(value: unknown): value is ExamWorkspaceReadModel {
  const candidate = value as Partial<ExamWorkspaceReadModel> | undefined;
  return Boolean(candidate?.exam && Array.isArray(candidate.readiness) && candidate.nextAction && candidate.progress);
}

export function examStatusLabel(status: string) {
  return status === "PUBLISHED" ? "Yayında" : status === "DRAFT" ? "Taslak" : status;
}

export function formatDateTime(value: string | undefined) {
  if (!value) return "Tarih belirtilmedi";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}
