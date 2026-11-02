"use client";

import Link from "next/link";
import type { ExamWorkspaceReadModel } from "@o-okul/shared-types";
import { InfoGrid, InfoItem, Panel } from "@o-okul/ui";
import { PageFrame } from "../_shared/page-frame.js";
import { examStatusLabel, formatDateTime, useExamWorkspace } from "./exam-workspace-frame.js";
import { examManagementHref } from "./exam-workspace-routes.js";

// Sınav çalışma alanı genel bakışı. Sayfa başlığı, hazırlık adımları ve sonraki iş üst çerçevededir
// (exam-workspace-frame); çerçeve yalnız çalışma alanı rolüne açılır, diğer durumda sayfa kendi başlığını çizer.
export function ExamWorkspacePage({ examId }: { examId: string }) {
  const { eligible, query, workspace } = useExamWorkspace(examId);
  const legacyExamHref = `/kurum/sinavlar?examId=${encodeURIComponent(examId)}`;

  if (!eligible || query.isError || (!query.isPending && !workspace)) {
    const errorPanel = (
      <Panel aria-label="Sınav çalışma alanı hatası" title="Sınav bulunamadı veya erişilemiyor">
        <p>Sınav listesine dönüp erişebildiğiniz bir sınav seçin.</p>
        <Link className="uh-button uh-button--secondary uh-button--md" href={legacyExamHref}>
          <span className="uh-button__content">Sınav listesine dön</span>
        </Link>
      </Panel>
    );
    return eligible ? errorPanel : (
      <PageFrame title="Sınav çalışma alanı" subtitle="Bu sınav güvenli kapsamda gösterilemiyor.">
        {errorPanel}
      </PageFrame>
    );
  }

  if (!workspace) {
    return null;
  }

  return (
    <section aria-label="Sınav çalışma alanı özeti" className="next-page-frame__body">
      <Panel
        actions={(
          <Link className="uh-button uh-button--secondary uh-button--md" href={examManagementHref(examId)}>
            <span className="uh-button__content">Sınav yönetimini aç</span>
          </Link>
        )}
        aria-label="Sınav özeti"
        description="Sınav bağlamı ve katılım özeti."
        title="Sınav bağlamı"
      >
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
