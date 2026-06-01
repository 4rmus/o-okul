import { describe, expect, it } from "vitest";
import {
  computeCohortStatistics,
  psychometricsVersion,
  type CohortStudentInput,
} from "./psychometrics.js";

describe("Psychometrics cohort statistics", () => {
  // İki sınıf (c1, c2), iki branş (Mat, Tür). Toplam ham puan dağılımı {70,50,70,50}
  // → ortalama 60, popülasyon std sapması 10 (temiz T-skor doğrulaması için seçildi).
  const cohort: CohortStudentInput[] = [
    { studentId: "s3", classId: "c2", net: 70, rawScore: 70, branches: [{ branch: "Mat", net: 40 }, { branch: "Tür", net: 30 }] },
    { studentId: "s1", classId: "c1", net: 70, rawScore: 70, branches: [{ branch: "Mat", net: 40 }, { branch: "Tür", net: 30 }] },
    { studentId: "s4", classId: "c2", net: 50, rawScore: 50, branches: [{ branch: "Mat", net: 20 }, { branch: "Tür", net: 30 }] },
    { studentId: "s2", classId: "c1", net: 50, rawScore: 50, branches: [{ branch: "Mat", net: 20 }, { branch: "Tür", net: 30 }] },
  ];

  it("standart puan, yüzdelik dilim ve sıralamayı genel + sınıf kapsamında deterministik üretir", () => {
    const result = computeCohortStatistics(cohort);

    expect(result).toEqual({
      count: 4,
      total: { meanNet: 60, sdNet: 10, meanRawScore: 60, sdRawScore: 10 },
      branches: [
        { branch: "Mat", count: 4, meanNet: 30, sdNet: 10 },
        { branch: "Tür", count: 4, meanNet: 30, sdNet: 0 },
      ],
      students: [
        {
          studentId: "s1",
          classId: "c1",
          total: {
            net: 70,
            rawScore: 70,
            standardScore: 60,
            general: { rank: 1, outOf: 4, percentile: 75 },
            class: { rank: 1, outOf: 2, percentile: 75 },
          },
          branches: [
            {
              branch: "Mat",
              net: 40,
              standardScore: 60,
              general: { rank: 1, outOf: 4, percentile: 75 },
              class: { rank: 1, outOf: 2, percentile: 75 },
            },
            {
              branch: "Tür",
              net: 30,
              standardScore: 50,
              general: { rank: 1, outOf: 4, percentile: 50 },
              class: { rank: 1, outOf: 2, percentile: 50 },
            },
          ],
        },
        {
          studentId: "s2",
          classId: "c1",
          total: {
            net: 50,
            rawScore: 50,
            standardScore: 40,
            general: { rank: 3, outOf: 4, percentile: 25 },
            class: { rank: 2, outOf: 2, percentile: 25 },
          },
          branches: [
            {
              branch: "Mat",
              net: 20,
              standardScore: 40,
              general: { rank: 3, outOf: 4, percentile: 25 },
              class: { rank: 2, outOf: 2, percentile: 25 },
            },
            {
              branch: "Tür",
              net: 30,
              standardScore: 50,
              general: { rank: 1, outOf: 4, percentile: 50 },
              class: { rank: 1, outOf: 2, percentile: 50 },
            },
          ],
        },
        {
          studentId: "s3",
          classId: "c2",
          total: {
            net: 70,
            rawScore: 70,
            standardScore: 60,
            general: { rank: 1, outOf: 4, percentile: 75 },
            class: { rank: 1, outOf: 2, percentile: 75 },
          },
          branches: [
            {
              branch: "Mat",
              net: 40,
              standardScore: 60,
              general: { rank: 1, outOf: 4, percentile: 75 },
              class: { rank: 1, outOf: 2, percentile: 75 },
            },
            {
              branch: "Tür",
              net: 30,
              standardScore: 50,
              general: { rank: 1, outOf: 4, percentile: 50 },
              class: { rank: 1, outOf: 2, percentile: 50 },
            },
          ],
        },
        {
          studentId: "s4",
          classId: "c2",
          total: {
            net: 50,
            rawScore: 50,
            standardScore: 40,
            general: { rank: 3, outOf: 4, percentile: 25 },
            class: { rank: 2, outOf: 2, percentile: 25 },
          },
          branches: [
            {
              branch: "Mat",
              net: 20,
              standardScore: 40,
              general: { rank: 3, outOf: 4, percentile: 25 },
              class: { rank: 2, outOf: 2, percentile: 25 },
            },
            {
              branch: "Tür",
              net: 30,
              standardScore: 50,
              general: { rank: 1, outOf: 4, percentile: 50 },
              class: { rank: 1, outOf: 2, percentile: 50 },
            },
          ],
        },
      ],
      _meta: { psychometricsVersion, standardScore: { mean: 50, sd: 10 } },
    });
  });

  it("girdi sırasından bağımsız aynı çıktıyı üretir (determinizm)", () => {
    const reversed = [...cohort].reverse();
    expect(computeCohortStatistics(reversed)).toEqual(computeCohortStatistics(cohort));
  });

  it("tüm puanlar eşitse standart puanı ölçek ortalamasına sabitler, herkese 1. sıra ve %50 dilim verir", () => {
    const result = computeCohortStatistics([
      { studentId: "a", net: 50, rawScore: 50, branches: [] },
      { studentId: "b", net: 50, rawScore: 50, branches: [] },
      { studentId: "c", net: 50, rawScore: 50, branches: [] },
    ]);

    expect(result.count).toBe(3);
    expect(result.total.sdRawScore).toBe(0);
    for (const student of result.students) {
      expect(student.total.standardScore).toBe(50);
      expect(student.total.general).toEqual({ rank: 1, outOf: 3, percentile: 50 });
      expect(student.total.class).toBeNull();
    }
  });

  it("standart puan ölçeğini konfigürasyondan alır (100 taban / 15 ölçek)", () => {
    const result = computeCohortStatistics(
      [
        { studentId: "high", net: 60, rawScore: 60, branches: [] },
        { studentId: "low", net: 40, rawScore: 40, branches: [] },
      ],
      { standardScore: { mean: 100, sd: 15 } },
    );

    const high = result.students.find((student) => student.studentId === "high");
    const low = result.students.find((student) => student.studentId === "low");
    expect(high?.total.standardScore).toBe(115);
    expect(low?.total.standardScore).toBe(85);
    expect(result._meta.standardScore).toEqual({ mean: 100, sd: 15 });
  });

  it("sınıfı olmayan öğrenci için sınıf kapsamını null bırakır, genel kapsamda tutar", () => {
    const result = computeCohortStatistics([
      { studentId: "withClass", classId: "c1", net: 80, rawScore: 80, branches: [] },
      { studentId: "noClass", net: 40, rawScore: 40, branches: [] },
    ]);

    const withClass = result.students.find((student) => student.studentId === "withClass");
    const noClass = result.students.find((student) => student.studentId === "noClass");
    expect(withClass?.total.class).toEqual({ rank: 1, outOf: 1, percentile: 50 });
    expect(withClass?.total.general).toEqual({ rank: 1, outOf: 2, percentile: 75 });
    expect(noClass?.total.class).toBeNull();
    expect(noClass?.total.general).toEqual({ rank: 2, outOf: 2, percentile: 25 });
  });

  it("boş kohortta hata fırlatır", () => {
    expect(() => computeCohortStatistics([])).toThrow("PSYCHOMETRICS_INPUT_EMPTY");
  });
});
