import { describe, expect, it } from "vitest";
import { computeCohortStatistics, psychometricsVersion, type CohortStudentInput } from "./psychometrics.js";

describe("Psychometrics competition ranks", () => {
  const cohort: CohortStudentInput[] = [
    { studentId: "s3", classId: "c2", net: 70, rawScore: 70, rankingScore: 400, branches: [{ branch: "Mat", net: 40 }] },
    { studentId: "s1", classId: "c1", net: 70, rawScore: 70, rankingScore: 400, branches: [{ branch: "Mat", net: 40 }] },
    { studentId: "s4", classId: "c2", net: 50, rawScore: 50, rankingScore: 300, branches: [{ branch: "Mat", net: 20 }] },
    { studentId: "s2", classId: "c1", net: 50, rawScore: 50, rankingScore: 300, branches: [{ branch: "Mat", net: 20 }] },
  ];

  it("eşit puanlarda competition rank üretir ve sonraki sırayı atlar", () => {
    const result = computeCohortStatistics(cohort);

    expect(result).toMatchObject({
      count: 4,
      total: { meanNet: 60, meanRawScore: 60 },
      branches: [{ branch: "Mat", count: 4, meanNet: 30 }],
      _meta: { psychometricsVersion },
    });
    expect(result.students.map((student) => ({
      studentId: student.studentId,
      general: student.total.general,
      class: student.total.class,
    }))).toEqual([
      { studentId: "s1", general: { rank: 1, outOf: 4 }, class: { rank: 1, outOf: 2 } },
      { studentId: "s2", general: { rank: 3, outOf: 4 }, class: { rank: 2, outOf: 2 } },
      { studentId: "s3", general: { rank: 1, outOf: 4 }, class: { rank: 1, outOf: 2 } },
      { studentId: "s4", general: { rank: 3, outOf: 4 }, class: { rank: 2, outOf: 2 } },
    ]);
    expect(result).not.toHaveProperty("standardScore");
    expect(JSON.stringify(result)).not.toMatch(/percentile|standardScore|sdNet|sdRawScore/u);
  });

  it("girdi sırasından bağımsızdır", () => {
    expect(computeCohortStatistics([...cohort].reverse())).toEqual(computeCohortStatistics(cohort));
  });

  it("sınıfsız öğrenciyi kurum sıralamasında tutup sınıf sırasını null bırakır", () => {
    const result = computeCohortStatistics([
      { studentId: "a", net: 10, rawScore: 10, branches: [] },
      { studentId: "b", classId: "c1", net: 5, rawScore: 5, branches: [] },
    ]);
    expect(result.students[0]?.total).toMatchObject({ general: { rank: 1, outOf: 2 }, class: null });
  });

  it("boş kohortta hata fırlatır", () => {
    expect(() => computeCohortStatistics([])).toThrow("PSYCHOMETRICS_INPUT_EMPTY");
  });
});
