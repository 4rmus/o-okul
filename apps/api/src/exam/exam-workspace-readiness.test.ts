import { describe, expect, it } from "vitest";
import { buildExamWorkspaceReadiness } from "./exam-workspace-readiness.js";
import type { ExamWorkspaceProgress } from "./exam-workspace-progress-store.js";

const emptyProgress: ExamWorkspaceProgress = { approvedLayout: false, openQuarantineCount: 0, matchedCount: 0, evaluatedCount: 0, readyReport: false };
const ready = { answerKeyReady: true, participantsReady: true, published: true };

function statusOf(result: ReturnType<typeof buildExamWorkspaceReadiness>) {
  return Object.fromEntries(result.readiness.map((step) => [step.key, step.blocker ?? step.status]));
}

describe("buildExamWorkspaceReadiness", () => {
  it("ilk eksik adımı sonraki iş olarak seçer ve sonraki adımları bloklar", () => {
    const result = buildExamWorkspaceReadiness({ ...ready, answerKeyReady: false, progress: emptyProgress });
    expect(result.nextAction).toBe("ADD_ANSWER_KEY");
    expect(statusOf(result)).toMatchObject({ ANSWER_KEY: "ANSWER_KEY_MISSING", OPTICAL_ENTRY: "ANSWER_KEY_MISSING", IMPORT: "IMPORT_MISSING", REPORT: "REPORT_MISSING" });
  });

  it("optik düzen onaylı değilse optiği açtırır; import yoksa yükleme ister", () => {
    expect(buildExamWorkspaceReadiness({ ...ready, progress: emptyProgress }).nextAction).toBe("OPEN_OPTICAL");
    expect(buildExamWorkspaceReadiness({ ...ready, progress: { ...emptyProgress, approvedLayout: true } }).nextAction).toBe("UPLOAD_OPTICAL");
  });

  it("açık karantina varken eşleştirmeyi bloklar", () => {
    const result = buildExamWorkspaceReadiness({
      ...ready,
      progress: { ...emptyProgress, approvedLayout: true, latestRawImportId: "ri", openQuarantineCount: 2, matchedCount: 5, evaluatedCount: 5 },
    });
    expect(result.nextAction).toBe("RESOLVE_UNMATCHED");
    expect(statusOf(result)).toMatchObject({ IMPORT: "READY", MATCHING: "UNMATCHED_ROWS", EVALUATION: "READY" });
  });

  it("eşleşen satır yokken veya değerlendirme eksikken değerlendirmeyi hazır saymaz", () => {
    const noMatches = buildExamWorkspaceReadiness({ ...ready, progress: { ...emptyProgress, approvedLayout: true, latestRawImportId: "ri" } });
    expect(noMatches.nextAction).toBe("WAIT_EVALUATION");
    const partial = buildExamWorkspaceReadiness({ ...ready, progress: { ...emptyProgress, approvedLayout: true, latestRawImportId: "ri", matchedCount: 4, evaluatedCount: 3 } });
    expect(statusOf(partial)).toMatchObject({ EVALUATION: "EVALUATION_PENDING" });
  });

  it("değerlendirme tamamsa rapor ister; READY rapor varsa raporu açar", () => {
    const evaluated = { ...emptyProgress, approvedLayout: true, latestRawImportId: "ri", matchedCount: 4, evaluatedCount: 4 };
    expect(buildExamWorkspaceReadiness({ ...ready, progress: evaluated }).nextAction).toBe("GENERATE_REPORT");
    const done = buildExamWorkspaceReadiness({ ...ready, progress: { ...evaluated, readyReport: true } });
    expect(done.nextAction).toBe("OPEN_REPORT");
    expect(done.readiness.every((step) => step.status === "READY")).toBe(true);
    expect(done.readiness.map((step) => step.key)).toEqual(["EXAM", "ANSWER_KEY", "PARTICIPANTS", "PUBLISHED", "OPTICAL_ENTRY", "OPTICAL_LAYOUT", "IMPORT", "MATCHING", "EVALUATION", "REPORT"]);
  });
});
