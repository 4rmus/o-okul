import type {
  ExamWorkspaceBlocker,
  ExamWorkspaceNextAction,
  ExamWorkspaceReadinessKey,
  ExamWorkspaceReadinessStep,
} from "@o-okul/shared-types";
import type { ExamWorkspaceProgress } from "./exam-workspace-progress-store.js";

export interface ExamWorkspaceReadinessInput {
  answerKeyReady: boolean;
  participantsReady: boolean;
  published: boolean;
  progress: ExamWorkspaceProgress;
}

// Hazırlık sırası: sınav → cevap anahtarı → katılımcı → yayın → optik düzen → yükleme → eşleştirme →
// değerlendirme → rapor. İlk eksik adım "sonraki önerilen iş"tir.
export function buildExamWorkspaceReadiness(input: ExamWorkspaceReadinessInput): {
  nextAction: ExamWorkspaceNextAction;
  readiness: ExamWorkspaceReadinessStep[];
} {
  const { answerKeyReady, participantsReady, progress, published } = input;
  const opticalReady = answerKeyReady && participantsReady && published;
  const imported = Boolean(progress.latestRawImportId);
  const matchingReady = imported && progress.openQuarantineCount === 0;
  const evaluationReady = imported && progress.matchedCount > 0 && progress.evaluatedCount >= progress.matchedCount;
  const opticalBlocker: ExamWorkspaceBlocker | undefined = !answerKeyReady
    ? "ANSWER_KEY_MISSING"
    : !participantsReady
      ? "PARTICIPANTS_MISSING"
      : !published
        ? "EXAM_NOT_PUBLISHED"
        : undefined;

  const readiness: ExamWorkspaceReadinessStep[] = [
    { key: "EXAM", status: "READY" },
    step("ANSWER_KEY", answerKeyReady, "ANSWER_KEY_MISSING"),
    step("PARTICIPANTS", participantsReady, "PARTICIPANTS_MISSING"),
    step("PUBLISHED", published, "EXAM_NOT_PUBLISHED"),
    step("OPTICAL_ENTRY", opticalReady, opticalBlocker ?? "EXAM_NOT_PUBLISHED"),
    step("OPTICAL_LAYOUT", progress.approvedLayout, "OPTICAL_LAYOUT_MISSING"),
    step("IMPORT", imported, "IMPORT_MISSING"),
    step("MATCHING", matchingReady, imported ? "UNMATCHED_ROWS" : "IMPORT_MISSING"),
    step("EVALUATION", evaluationReady, imported ? "EVALUATION_PENDING" : "IMPORT_MISSING"),
    step("REPORT", progress.readyReport, "REPORT_MISSING"),
  ];

  return { nextAction: resolveNextAction(), readiness };

  function resolveNextAction(): ExamWorkspaceNextAction {
    if (!answerKeyReady) return "ADD_ANSWER_KEY";
    if (!participantsReady) return "ADD_PARTICIPANTS";
    if (!published) return "PUBLISH_EXAM";
    if (!progress.approvedLayout) return "OPEN_OPTICAL";
    if (!imported) return "UPLOAD_OPTICAL";
    if (!matchingReady) return "RESOLVE_UNMATCHED";
    if (!evaluationReady) return "WAIT_EVALUATION";
    if (!progress.readyReport) return "GENERATE_REPORT";
    return "OPEN_REPORT";
  }
}

function step(key: ExamWorkspaceReadinessKey, ready: boolean, blocker: ExamWorkspaceBlocker): ExamWorkspaceReadinessStep {
  return ready ? { key, status: "READY" } : { key, status: "BLOCKED", blocker };
}
