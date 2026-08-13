"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  canAccessExamWorkspace,
  type ExamWorkspaceNextAction,
  ExamWorkspaceReadModel,
  ExamWorkspaceReadinessKey,
  ExamWorkspaceReadinessStep,
} from "@o-okul/shared-types";
import { InfoGrid, InfoItem, Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import { ArrowRight } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { featureRolloutQueryKey, isFeatureEnabled, loadFeatureRollouts } from "../../../../src/feature-rollouts.js";
import { PageFrame } from "../_shared/page-frame.js";

export function ExamWorkspacePage({ examId }: { examId: string }) {
  const { auth } = useAuth();
  const router = useRouter();
  const featureRolloutsQuery = useQuery({
    queryKey: featureRolloutQueryKey(
      auth?.session.tenantId,
      auth?.session.id,
      auth?.session.activePersona,
    ),
    queryFn: () => loadFeatureRollouts(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const workspaceEligible = Boolean(auth && canAccessExamWorkspace(
    auth.session.roles,
    auth.session.activePersona,
  ));
  const workspaceV2Enabled = workspaceEligible && featureRolloutsQuery.isSuccess
    && !featureRolloutsQuery.isError
    && isFeatureEnabled(featureRolloutsQuery.data, "web.exam-workspace-v2");
  const workspaceQuery = useQuery({
    queryKey: ["next-exam-workspace", auth?.session.tenantId ?? "anonymous", examId],
    queryFn: () => apiRequest<ExamWorkspaceReadModel>(
      auth?.accessToken ?? "",
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/workspace`,
    ),
    enabled: Boolean(auth && workspaceV2Enabled),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (featureRolloutsQuery.isPending) return;
    if (featureRolloutsQuery.isError || !workspaceV2Enabled) {
      router.replace(`/kurum/sinavlar?examId=${encodeURIComponent(examId)}`);
    }
  }, [examId, featureRolloutsQuery.isError, featureRolloutsQuery.isPending, router, workspaceV2Enabled]);

  if (featureRolloutsQuery.isPending || featureRolloutsQuery.isError || !workspaceV2Enabled) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Güvenli çalışma alanı seçiliyor.">
        <p className="next-status-note">Mevcut sınav görünümüne dönülüyor.</p>
      </PageFrame>
    );
  }

  if (workspaceQuery.isPending) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Sınav hazırlığı salt okunur olarak yükleniyor.">
        <p className="next-status-note">Sınav bilgileri yükleniyor.</p>
      </PageFrame>
    );
  }

  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Bu sınav güvenli kapsamda gösterilemiyor.">
        <Panel aria-label="Sınav çalışma alanı hatası" title="Sınav bulunamadı veya erişilemiyor">
          <p>Sınav listesine dönüp erişebildiğiniz bir sınav seçin.</p>
          <Link className="uh-button uh-button--secondary uh-button--md" href="/kurum/sinavlar">
            <span className="uh-button__content">Sınav listesine dön</span>
          </Link>
        </Panel>
      </PageFrame>
    );
  }

  const workspace = workspaceQuery.data;
  const legacyExamHref = `/kurum/sinavlar?examId=${encodeURIComponent(examId)}`;

  return (
    <PageFrame
      title={workspace.exam.title}
      subtitle="Mevcut sınav verisinin salt okunur hazırlık ve geçiş özeti."
      actions={(
        <Link className="uh-button uh-button--secondary uh-button--md" href={legacyExamHref}>
          <span className="uh-button__content">Mevcut yönetime dön</span>
        </Link>
      )}
    >
      <section aria-label="Salt okunur sınav çalışma alanı">
        <Panel aria-label="Sınav özeti" title="Sınav bağlamı">
          <InfoGrid aria-label="Sınav bilgileri" role="region">
            <InfoItem label="Durum" value={examStatusLabel(workspace.exam.status)} />
            <InfoItem label="Başlangıç" value={formatDateTime(workspace.exam.startsAt)} />
            <InfoItem label="Sınav türü" value={workspace.exam.examType ?? "Belirtilmedi"} />
            <InfoItem label="Cevap anahtarı" value={answerKeyLabel(workspace)} />
          </InfoGrid>
        </Panel>

        <Panel aria-label="Katılımcı özeti" title="Katılımcı özeti">
          <InfoGrid aria-label="Katılımcı sayıları" role="region">
            <InfoItem label="Toplam" value={formatCount(workspace.participantSummary.total)} />
            <InfoItem label="Kayıtlı" value={formatCount(workspace.participantSummary.registered)} />
            <InfoItem label="Katıldı" value={formatCount(workspace.participantSummary.attended)} />
            <InfoItem label="Gelmedi" value={formatCount(workspace.participantSummary.absent)} />
          </InfoGrid>
        </Panel>

        <Panel aria-label="Sınav hazırlık durumu" title="Hazırlık durumu">
          <ul className="next-exam-workspace-readiness">
            {workspace.readiness.map((step) => (
              <li key={step.key}>
                <span>{readinessLabel(step.key)}</span>
                <StatusBadge tone={readinessTone(step)}>{readinessStatus(step)}</StatusBadge>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel aria-label="Önerilen sonraki iş" title="Sonraki önerilen iş">
          <p>{nextActionDescription(workspace.nextAction)}</p>
          <div className="next-exam-workspace-actions">
            <Link className="uh-button uh-button--primary uh-button--md" href={nextActionHref(workspace.nextAction, examId)}>
              <span className="uh-button__content">
                {nextActionLabel(workspace.nextAction)}
                <ArrowRight size={17} aria-hidden="true" />
              </span>
            </Link>
            <Link className="uh-button uh-button--secondary uh-button--md" href={`/kurum/raporlar?examId=${encodeURIComponent(examId)}`}>
              <span className="uh-button__content">Rapor görünümünü aç</span>
            </Link>
          </div>
        </Panel>
      </section>
    </PageFrame>
  );
}

function readinessLabel(key: ExamWorkspaceReadinessKey) {
  return {
    EXAM: "Sınav bilgisi",
    ANSWER_KEY: "Cevap anahtarı",
    PARTICIPANTS: "Katılımcılar",
    PUBLISHED: "Yayın durumu",
    OPTICAL_ENTRY: "Optik akışına geçiş",
  }[key];
}

function readinessStatus(step: ExamWorkspaceReadinessStep) {
  if (step.status === "READY") return "Hazır";
  return {
    ANSWER_KEY_MISSING: "Cevap anahtarı bekleniyor",
    PARTICIPANTS_MISSING: "Katılımcı bekleniyor",
    EXAM_NOT_PUBLISHED: "Yayın bekleniyor",
  }[step.blocker ?? "EXAM_NOT_PUBLISHED"];
}

function readinessTone(step: ExamWorkspaceReadinessStep): StatusBadgeProps["tone"] {
  return step.status === "READY" ? "success" : "warning";
}

function nextActionHref(nextAction: ExamWorkspaceNextAction, examId: string) {
  return nextAction === "OPEN_OPTICAL"
    ? `/kurum/optik?examId=${encodeURIComponent(examId)}`
    : `/kurum/sinavlar?examId=${encodeURIComponent(examId)}`;
}

function nextActionLabel(nextAction: ExamWorkspaceNextAction) {
  return nextAction === "OPEN_OPTICAL" ? "Optik işlemlerine geç" : "Mevcut sınav yönetimini aç";
}

function nextActionDescription(nextAction: ExamWorkspaceNextAction) {
  return {
    ADD_ANSWER_KEY: "Cevap anahtarını mevcut sınav yönetiminde tamamlayın.",
    ADD_PARTICIPANTS: "En az bir katılımcıyı mevcut sınav yönetiminde ekleyin.",
    PUBLISH_EXAM: "Hazır sınavı mevcut sınav yönetiminde yayınlayın.",
    OPEN_OPTICAL: "Sınav optik işlemlerine geçmeye hazır.",
  }[nextAction];
}

function answerKeyLabel(workspace: ExamWorkspaceReadModel) {
  const summary = workspace.exam.answerKeySummary;
  if (!summary || summary.status === "MISSING") return "Eksik";
  return `${summary.status === "PUBLISHED" ? "Yayında" : "Taslak"} · ${formatCount(summary.questionCount ?? 0)} soru`;
}

function examStatusLabel(status: string) {
  return status === "PUBLISHED" ? "Yayında" : status === "DRAFT" ? "Taslak" : status;
}

function formatDateTime(value: string | undefined) {
  if (!value) return "Tarih belirtilmedi";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
