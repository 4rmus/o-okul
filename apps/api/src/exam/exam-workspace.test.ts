import { describe, expect, it } from "vitest";
import type { ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import { buildExamWorkspace } from "./exam.service.js";

const exam: ExamRecord = {
  id: "exam-a",
  tenantId: "tenant-a",
  title: "LGS Genel Deneme",
  status: "PUBLISHED",
  answerKeySummary: { status: "PUBLISHED", version: "v1", questionCount: 90, branchCount: 6 },
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
};

const participant: ExamParticipantRecord = {
  id: "participant-private",
  tenantId: "tenant-a",
  examId: "exam-a",
  studentId: "student-private",
  status: "ATTENDED",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
};

describe("buildExamWorkspace", () => {
  it("ilk eksik adımı current, sonrakileri blocked yapar", () => {
    const workspace = buildExamWorkspace(
      { ...exam, status: "DRAFT", answerKeySummary: { status: "MISSING" } },
      [],
      [],
    );

    expect(workspace.readiness).toMatchObject({ status: "ACTION_REQUIRED", readyForOptical: false });
    expect(workspace.readiness.steps.map((step) => [step.id, step.state])).toEqual([
      ["definition", "COMPLETE"],
      ["answer-key", "CURRENT"],
      ["participants", "BLOCKED"],
      ["optical", "BLOCKED"],
      ["report", "BLOCKED"],
    ]);
  });

  it("hazır snapshot ile readiness'i kapatır ve katılımcı kimliğini taşımaz", () => {
    const workspace = buildExamWorkspace(exam, [participant], [
      { id: "snapshot-old", status: "STALE", generatedAt: "2026-08-02T09:00:00.000Z", updatedAt: "2026-08-02T09:00:00.000Z" },
      { id: "snapshot-ready", status: "READY", generatedAt: "2026-08-03T09:00:00.000Z", updatedAt: "2026-08-03T09:00:00.000Z" },
    ]);

    expect(workspace.readiness).toMatchObject({ status: "READY", readyForOptical: true });
    expect(workspace.readiness.steps.every((step) => step.state === "COMPLETE")).toBe(true);
    expect(workspace.participantSummary).toEqual({ total: 1, registered: 0, attended: 1, absent: 0 });
    expect(workspace.reportSummary).toEqual({
      total: 2,
      ready: 1,
      stale: 1,
      latestSnapshotId: "snapshot-ready",
      latestGeneratedAt: "2026-08-03T09:00:00.000Z",
    });
    expect(JSON.stringify(workspace)).not.toContain("student-private");
    expect(JSON.stringify(workspace)).not.toContain("participant-private");
  });
});
