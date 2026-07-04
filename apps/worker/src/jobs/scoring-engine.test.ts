import { describe, expect, it } from "vitest";
import { scoreExam, scoringEngineVersion } from "./scoring-engine.js";

describe("ScoringEngine", () => {
  const answerKey = [
    { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
    { questionNo: 2, correctAnswer: "B", branch: "Matematik" },
    { questionNo: 3, correctAnswer: "C", branch: "Türkçe" },
    { questionNo: 4, correctAnswer: "D", branch: "Türkçe" },
  ] as const;
  const config = {
    answerKeyVersion: "answer-key-v3",
    computedAt: "2026-05-30T00:00:00.000Z",
    engineVersion: scoringEngineVersion,
    wrongPenalty: 0.25,
  };

  it("doğru, yanlış, boş ve net değerlerini branş bazında deterministik hesaplar", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "C" },
        { questionNo: 3, answer: "" },
        { questionNo: 4, answer: "D" },
      ],
      [...answerKey],
      config,
    );

    expect(result).toMatchObject({
      total: {
        correct: 2,
        wrong: 1,
        blank: 1,
        net: 1.75,
        rawScore: 1.75,
        standardScore: 1.75,
      },
      branches: [
        { branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 },
        { branch: "Türkçe", correct: 1, wrong: 0, blank: 1, net: 1 },
      ],
      questions: [
        { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
        { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
        { questionNo: 3, branch: "Türkçe", answer: "", correctAnswer: "C", status: "BLANK" },
        { questionNo: 4, branch: "Türkçe", answer: "D", correctAnswer: "D", status: "CORRECT" },
      ],
      _meta: {
        answerKeyVersion: "answer-key-v3",
        engineVersion: scoringEngineVersion,
        computedAt: "2026-05-30T00:00:00.000Z",
      },
    });
  });

  it("outcomeCode varsa kazanım kırılımını ve soru satırını deterministik üretir", () => {
    const answerKeyWithOutcomes = [
      { questionNo: 1, correctAnswer: "A", branch: "Matematik", outcomeCode: "MAT.8.1.1" },
      { questionNo: 2, correctAnswer: "B", branch: "Matematik", outcomeCode: "MAT.8.1.1" },
      { questionNo: 3, correctAnswer: "C", branch: "Türkçe", outcomeCode: "TUR.8.2.1" },
    ] as const;
    const answers = [
      { questionNo: 1, answer: "A" },
      { questionNo: 2, answer: "C" },
      { questionNo: 3, answer: "" },
    ] as const;

    const result = scoreExam([...answers], [...answerKeyWithOutcomes], config);

    expect(result.outcomes).toEqual([
      { outcomeCode: "MAT.8.1.1", branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 },
      { outcomeCode: "TUR.8.2.1", branch: "Türkçe", correct: 0, wrong: 0, blank: 1, net: 0 },
    ]);
    expect(result.questions).toEqual([
      {
        questionNo: 1,
        branch: "Matematik",
        outcomeCode: "MAT.8.1.1",
        answer: "A",
        correctAnswer: "A",
        status: "CORRECT",
      },
      {
        questionNo: 2,
        branch: "Matematik",
        outcomeCode: "MAT.8.1.1",
        answer: "C",
        correctAnswer: "B",
        status: "WRONG",
      },
      {
        questionNo: 3,
        branch: "Türkçe",
        outcomeCode: "TUR.8.2.1",
        answer: "",
        correctAnswer: "C",
        status: "BLANK",
      },
    ]);
    expect(scoreExam([...answers], [...answerKeyWithOutcomes], config)).toEqual(result);
  });

  it("cevap listesinde eksik soruları boş sayar ve fazla cevapları yok sayar", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 99, answer: "E" },
      ],
      [...answerKey],
      config,
    );

    expect(result.total).toMatchObject({
      correct: 1,
      wrong: 0,
      blank: 3,
      net: 1,
      rawScore: 1,
      standardScore: 1,
    });
  });

  it("yanlış katsayısını konfigürasyondan alır", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "B" },
        { questionNo: 2, answer: "C" },
      ],
      answerKey.slice(0, 2),
      { ...config, wrongPenalty: 0.5 },
    );

    expect(result.total.net).toBe(-1);
    expect(result.branches).toEqual([{ branch: "Matematik", correct: 0, wrong: 2, blank: 0, net: -1 }]);
  });

  it("cevap anahtarında branş boşsa sessiz boş kırılım üretmez", () => {
    expect(() =>
      scoreExam(
        [{ questionNo: 1, answer: "A" }],
        [{ questionNo: 1, correctAnswer: "A", branch: " " }],
        config,
      ),
    ).toThrow("SCORING_ANSWER_KEY_BRANCH_REQUIRED");
  });

  it("ham ve standart puanı konfigürasyondaki ölçekle hesaplar", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "C" },
        { questionNo: 3, answer: "" },
        { questionNo: 4, answer: "D" },
      ],
      [...answerKey],
      {
        ...config,
        rawScoreMultiplier: 5,
        standardScoreBase: 50,
        standardScoreMultiplier: 2,
      },
    );

    expect(result.total).toMatchObject({
      correct: 2,
      wrong: 1,
      blank: 1,
      net: 1.75,
      rawScore: 8.75,
      standardScore: 67.5,
    });
  });

  it("aynı girdiye aynı çıktıyı üretir", () => {
    const answers = [
      { questionNo: 1, answer: "A" },
      { questionNo: 2, answer: "B" },
    ] as const;
    const partialAnswerKey = answerKey.slice(0, 2);

    expect(scoreExam([...answers], partialAnswerKey, config)).toEqual(scoreExam([...answers], partialAnswerKey, config));
  });

  it("sabit katsayıyla tahmini puanı hesaplar", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "B" },
        { questionNo: 3, answer: "C" },
        { questionNo: 4, answer: "" },
      ],
      [
        { questionNo: 1, correctAnswer: "A", branch: "Türkçe" },
        { questionNo: 2, correctAnswer: "B", branch: "Matematik" },
        { questionNo: 3, correctAnswer: "C", branch: "Fen Bilimleri" },
        { questionNo: 4, correctAnswer: "D", branch: "Din Kültürü" },
      ],
      config,
    );

    expect(result.total.rawScore).toBe(3);
    expect(result.total.estimatedRawScore).toBe(13.044);
  });

  it("LGS önekli ana derslerde yüksek katsayıyı uygular", () => {
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "B" },
        { questionNo: 3, answer: "C" },
        { questionNo: 4, answer: "D" },
      ],
      [
        { questionNo: 1, correctAnswer: "A", branch: "LGS TÜRKÇE" },
        { questionNo: 2, correctAnswer: "B", branch: "LGS MATEMATİK" },
        { questionNo: 3, correctAnswer: "C", branch: "LGS FEN BİLİMLERİ" },
        { questionNo: 4, correctAnswer: "D", branch: "LGS İNGİLİZCE" },
      ],
      config,
    );

    expect(result.total.rawScore).toBe(4);
    expect(result.total.estimatedRawScore).toBe(14.124);
  });
});
