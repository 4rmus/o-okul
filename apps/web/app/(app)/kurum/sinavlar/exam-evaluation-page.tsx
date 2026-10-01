"use client";

import Link from "next/link";
import { InfoGrid, InfoItem, Panel } from "@o-okul/ui";
import { PageFrame } from "../_shared/page-frame.js";
import { useExamWorkspace } from "./exam-workspace-frame.js";
import { opticalWorkspaceHref, reportWorkspaceHref } from "./exam-workspace-routes.js";

// Değerlendirme adımı: son optik yüklemenin sunucu sayımları. Değerlendirme yükleme sonrası kuyrukta başlar.
export function ExamEvaluationPage({ examId }: { examId: string }) {
  const { query, workspace } = useExamWorkspace(examId);
  const evaluation = workspace?.readiness.find((step) => step.key === "EVALUATION");

  return (
    <PageFrame title="Değerlendirme" subtitle="Son optik yüklemenin puanlama ilerlemesi.">
      <Panel aria-label="Değerlendirme durumu" title="Değerlendirme durumu">
        {workspace ? (
          <>
            <InfoGrid aria-label="Değerlendirme sayıları" role="region">
              <InfoItem label="Eşleşen satır" value={formatCount(workspace.progress.matchedCount)} />
              <InfoItem label="Değerlendirilen" value={formatCount(workspace.progress.evaluatedCount)} />
              <InfoItem label="Eşleşmeyen" value={formatCount(workspace.progress.openQuarantineCount)} />
              <InfoItem label="Durum" value={evaluation?.status === "READY" ? "Tamamlandı" : evaluationBlockerLabel(evaluation?.blocker)} />
            </InfoGrid>
            <div className="next-exam-workspace-actions">
              <Link className="uh-button uh-button--secondary uh-button--md" href={opticalWorkspaceHref(examId, "upload")}>
                <span className="uh-button__content">Optik yüklemeye dön</span>
              </Link>
              <Link className="uh-button uh-button--secondary uh-button--md" href={reportWorkspaceHref(examId, "overview")}>
                <span className="uh-button__content">Rapora geç</span>
              </Link>
            </div>
          </>
        ) : (
          <p className="next-status-note">{query.isPending ? "Değerlendirme durumu yükleniyor." : "Değerlendirme durumu şu an alınamadı."}</p>
        )}
      </Panel>
    </PageFrame>
  );
}

function evaluationBlockerLabel(blocker: string | undefined) {
  if (blocker === "IMPORT_MISSING") return "Optik yükleme bekleniyor";
  return "Değerlendirme sürüyor";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
