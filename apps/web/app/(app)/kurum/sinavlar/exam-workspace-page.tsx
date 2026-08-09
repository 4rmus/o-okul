"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ExamWorkspaceRecord, ResolvedFeatureRollouts } from "@o-okul/shared-types";
import { ContextBar, InfoGrid, InfoItem, Panel, StatusBadge, WorkflowStepper, type WorkflowStepState } from "@o-okul/ui";
import { apiBaseUrl, apiErrorMessage, apiRequest } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { PageFrame } from "../_shared/page-frame.js";

const requiredFeatureKeys = ["web.shell-v2", "web.ia-v2", "web.exam-workspace-v2"] as const;

export function ExamWorkspacePage({ examId }: { examId: string }) {
  const { auth } = useAuth();
  const router = useRouter();
  const rolloutsQuery = useQuery({
    queryKey: ["next-feature-rollouts", auth?.session.tenantId ?? "anonymous", auth?.session.id ?? "none"],
    queryFn: () => apiRequest<ResolvedFeatureRollouts>(auth?.accessToken ?? "", `${apiBaseUrl}/me/feature-rollouts`),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
    retry: false,
  });
  const enabledFeatureKeys = rolloutsQuery.data?.enabledFeatureKeys ?? [];
  const workspaceEnabled = requiredFeatureKeys.every((featureKey) => enabledFeatureKeys.includes(featureKey));
  const fallbackHref = `/kurum/sinavlar?examId=${encodeURIComponent(examId)}`;
  const workspaceQuery = useQuery({
    queryKey: ["next-exam-workspace", auth?.session.tenantId ?? "anonymous", examId],
    queryFn: () => apiRequest<ExamWorkspaceRecord>(
      auth?.accessToken ?? "",
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/workspace`,
    ),
    enabled: Boolean(auth && workspaceEnabled),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!auth || rolloutsQuery.isPending || workspaceEnabled) return;
    router.replace(fallbackHref);
  }, [auth, fallbackHref, rolloutsQuery.isPending, router, workspaceEnabled]);

  if (!auth || rolloutsQuery.isPending || !workspaceEnabled) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Çalışma alanı erişimi doğrulanıyor.">
        <Panel tone="muted"><p>Mevcut sınav ekranına yönlendiriliyor.</p></Panel>
      </PageFrame>
    );
  }

  if (workspaceQuery.isPending) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Hazırlık durumu yükleniyor.">
        <Panel tone="muted"><p>Sınav bilgileri yükleniyor.</p></Panel>
      </PageFrame>
    );
  }

  if (workspaceQuery.error || !workspaceQuery.data) {
    return (
      <PageFrame
        actions={<Link className="uh-button uh-button--secondary uh-button--md" href={fallbackHref}>Eski ekrana dön</Link>}
        title="Sınav çalışma alanı"
        subtitle="Hazırlık durumu alınamadı."
      >
        <Panel tone="danger">
          <p role="alert">{apiErrorMessage(workspaceQuery.error, "Sınav çalışma alanı yüklenemedi.")}</p>
        </Panel>
      </PageFrame>
    );
  }

  const workspace = workspaceQuery.data;
  const exam = workspace.exam;
  const stepDescriptions = {
    definition: "Sınav bağlamı oluşturuldu.",
    "answer-key": "Cevap anahtarı sürümü hazır.",
    participants: `${workspace.participantSummary.total} katılımcı kapsamda.`,
    optical: workspace.readiness.readyForOptical ? "Optik işleme başlanabilir." : "Yayın ve önceki hazırlıklar bekleniyor.",
    report: workspace.reportSummary.ready > 0 ? "Salt-okunur rapor hazır." : "Optik değerlendirme ve rapor bekleniyor.",
  } as const;
  const steps = workspace.readiness.steps.map((step) => ({
    id: step.id,
    label: step.label,
    description: stepDescriptions[step.id],
    state: stepState(step.state),
  }));

  return (
    <PageFrame
      actions={(
        <div className="next-exam-workspace-actions">
          <Link className="uh-button uh-button--secondary uh-button--md" href={fallbackHref}>Sınav listesi</Link>
          <Link className="uh-button uh-button--secondary uh-button--md" href={`/kurum/optik?examId=${encodeURIComponent(exam.id)}`}>Optik işlemleri</Link>
          <Link className="uh-button uh-button--primary uh-button--md" href={`/kurum/raporlar?examId=${encodeURIComponent(exam.id)}`}>Raporlar</Link>
        </div>
      )}
      context={(
        <ContextBar
          items={[
            { label: "Sınav", value: exam.title },
            { label: "Durum", value: exam.status === "PUBLISHED" ? "Yayında" : "Taslak" },
            { label: "Başlangıç", value: formatDateTime(exam.startsAt) },
          ]}
          label="Sınav bağlamı"
        />
      )}
      subtitle="Mevcut sınav, optik ve rapor akışının salt-okunur hazırlık özeti."
      title={exam.title}
    >
      <section aria-label="Sınav çalışma alanı" className="next-exam-workspace">
        <InfoGrid>
          <InfoItem label="Katılımcı" value={formatCount(workspace.participantSummary.total)} description={`${formatCount(workspace.participantSummary.attended)} katıldı`} />
          <InfoItem label="Cevap anahtarı" value={answerKeyLabel(exam.answerKeySummary?.status)} description={exam.answerKeySummary?.version ?? "Sürüm yok"} />
          <InfoItem label="Hazır rapor" value={formatCount(workspace.reportSummary.ready)} description={`${formatCount(workspace.reportSummary.stale)} eski sürüm`} />
          <InfoItem
            label="Hazırlık"
            value={<StatusBadge tone={workspace.readiness.status === "READY" ? "success" : "warning"}>{workspace.readiness.status === "READY" ? "Hazır" : "İşlem gerekiyor"}</StatusBadge>}
          />
        </InfoGrid>
        <Panel
          actions={<StatusBadge tone={workspace.readiness.readyForOptical ? "success" : "warning"}>{workspace.readiness.readyForOptical ? "Optiğe hazır" : "Hazırlık bekliyor"}</StatusBadge>}
          description="Adımlar sunucu read model'inden hesaplanır; bu ekran kayıt değiştirmez."
          title="Sınav hazırlığı"
        >
          <WorkflowStepper steps={steps} />
        </Panel>
      </section>
    </PageFrame>
  );
}

function stepState(state: ExamWorkspaceRecord["readiness"]["steps"][number]["state"]): WorkflowStepState {
  if (state === "COMPLETE") return "complete";
  if (state === "CURRENT") return "current";
  return "blocked";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatDateTime(value: string | undefined) {
  if (!value) return "Planlanmadı";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Planlanmadı" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function answerKeyLabel(status: string | undefined) {
  if (status === "PUBLISHED") return "Yayında";
  if (status === "DRAFT") return "Taslak";
  return "Eksik";
}
