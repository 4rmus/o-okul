"use client";

import Link from "next/link";
import type { ExamWorkspaceReadModel } from "@o-okul/shared-types";
import { InfoGrid, InfoItem, Panel } from "@o-okul/ui";
import { PageFrame } from "../_shared/page-frame.js";
import { examStatusLabel, formatDateTime, useExamWorkspace } from "./exam-workspace-frame.js";

// Sınav çalışma alanı genel bakışı. Hazırlık adımları ve sonraki iş üst çerçevededir (exam-workspace-frame).
export function ExamWorkspacePage({ examId }: { examId: string }) {
  const { eligible, query, workspace } = useExamWorkspace(examId);
  const legacyExamHref = `/kurum/sinavlar?examId=${encodeURIComponent(examId)}`;

  if (!eligible || query.isError || (!query.isPending && !workspace)) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Bu sınav güvenli kapsamda gösterilemiyor.">
        <Panel aria-label="Sınav çalışma alanı hatası" title="Sınav bulunamadı veya erişilemiyor">
          <p>Sınav listesine dönüp erişebildiğiniz bir sınav seçin.</p>
          <Link className="uh-button uh-button--secondary uh-button--md" href={legacyExamHref}>
            <span className="uh-button__content">Sınav listesine dön</span>
          </Link>
        </Panel>
      </PageFrame>
    );
  }

  if (!workspace) {
    return (
      <PageFrame title="Sınav çalışma alanı" subtitle="Sınav hazırlığı yükleniyor.">
        <p className="next-status-note">Sınav bilgileri yükleniyor.</p>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title={workspace.exam.title}
      subtitle="Sınav bağlamı ve katılım özeti."
      actions={(
        <Link className="uh-button uh-button--secondary uh-button--md" href={legacyExamHref}>
          <span className="uh-button__content">Sınav yönetimini aç</span>
        </Link>
      )}
    >
      <section aria-label="Sınav çalışma alanı özeti">
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
      </section>
    </PageFrame>
  );
}

function answerKeyLabel(workspace: ExamWorkspaceReadModel) {
  const summary = workspace.exam.answerKeySummary;
  if (!summary || summary.status === "MISSING") return "Eksik";
  return `${summary.status === "PUBLISHED" ? "Yayında" : "Taslak"} · ${formatCount(summary.questionCount ?? 0)} soru`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
