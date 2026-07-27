import { describe, expect, it } from "vitest";
import {
  calculateAytScoreViews,
  lgsScoringProfileId,
  scoreExam,
  scoringEngineVersion,
  yksScoringProfileId,
  type ScoreSection,
} from "./scoring-engine.js";

describe("ScoringEngine", () => {
  const answerKey = [
    { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
    { questionNo: 2, correctAnswer: "B", branch: "Matematik" },
    { questionNo: 3, correctAnswer: "C", branch: "Türkçe" },
    { questionNo: 4, correctAnswer: "D", branch: "Türkçe" },
  ] as const;
  const config = {
    examType: "SCHOOL" as const,
    answerKeyVersion: "answer-key-v3",
    computedAt: "2026-05-30T00:00:00.000Z",
    engineVersion: scoringEngineVersion,
    wrongPenalty: 0.25,
  };
  const lgsProfile = { ...config, examType: "LGS" as const, examYear: 2026, scoringProfileId: lgsScoringProfileId, wrongPenalty: 1 / 3 };
  const yksProfile = { ...config, examType: "TYT" as const, examYear: 2026, scoringProfileId: yksScoringProfileId };

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

  it("LGS Deneme Puanını 100-500 aralığında 4/4/4/1/1/1 ağırlıklarıyla hesaplar", () => {
    const keys = lgsKeys();
    const result = scoreExam(
      keys.map(({ questionNo }) => ({ questionNo, answer: "A" })),
      keys,
      lgsProfile,
    );

    expect(result.scoreViews).toEqual([{
      type: "LGS",
      status: "CALCULATED",
      metrics: { correct: 90, wrong: 0, blank: 0, net: 90, questionCount: 90, successRate: 100 },
      practiceScore: 500,
      profileId: lgsScoringProfileId,
      officialComparable: false,
    }]);
    expect(result.total).not.toHaveProperty("standardScore");
    expect(result.total).not.toHaveProperty("estimatedRawScore");
    expect(result._meta).toMatchObject({
      examType: "LGS",
      examYear: 2026,
      scoringProfileId: lgsScoringProfileId,
      physicalQuestionCount: 90,
      activeQuestionCount: 90,
    });
  });

  it("LGS tamamen boşsa 100, negatif net oluşursa alt sınır 100 üretir", () => {
    const keys = lgsKeys();
    const blank = scoreExam([], keys, lgsProfile);
    const wrong = scoreExam(keys.map(({ questionNo }) => ({ questionNo, answer: "E" })), keys, {
      ...lgsProfile,
    });

    expect(blank.scoreViews?.[0]?.practiceScore).toBe(100);
    expect(wrong.total.net).toBe(-30);
    expect(wrong.scoreViews?.[0]?.metrics.successRate).toBe(0);
    expect(wrong.scoreViews?.[0]?.practiceScore).toBe(100);
  });

  it("LGS ağırlıklı puanı ara neti yuvarlamadan hesaplar", () => {
    const keys = lgsKeys().map((item, index) => ({
      ...item,
      ...(index >= 20 ? { evaluationStatus: "CANCELLED" as const } : {}),
    }));
    const result = scoreExam(keys.map((item, index) => ({
      questionNo: item.questionNo,
      answer: index === 19 ? "B" : "A",
    })), keys, lgsProfile);

    expect(result.scoreViews?.[0]).toMatchObject({
      metrics: { net: 18.67 },
      practiceScore: 473.33,
    });
  });

  it("iptal soruyu fiziksel sayıda tutar, aktif metrik ve puandan çıkarır", () => {
    const keys = lgsKeys().map((item, index) => ({
      ...item,
      ...(index > 0 ? { evaluationStatus: "CANCELLED" as const } : {}),
    }));
    const result = scoreExam(
      [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "C" },
      ],
      keys,
      lgsProfile,
    );

    expect(result.scoreViews?.[0]?.metrics).toEqual({
      correct: 1,
      wrong: 0,
      blank: 0,
      net: 1,
      questionCount: 1,
      successRate: 100,
    });
    expect(result.scoreViews?.[0]?.practiceScore).toBe(500);
    expect(result.questions[1]?.status).toBe("CANCELLED");
    expect(result._meta).toMatchObject({ physicalQuestionCount: 90, activeQuestionCount: 1 });
  });

  it("TYT 0,5 net uygunluk sınırını ve 33/17/33/17 ağırlıklarını uygular", () => {
    const boundaryKeys = tytKeys().map((item, index) => ({
      ...item,
      ...(index >= 13 ? { evaluationStatus: "CANCELLED" as const } : {}),
    }));
    const below = scoreExam(boundaryKeys.slice(0, 9).map((item, index) => ({
      questionNo: item.questionNo,
      answer: index < 2 ? "A" : "B",
    })), boundaryKeys, yksProfile);
    const boundary = scoreExam(boundaryKeys.slice(0, 13).map((item, index) => ({
      questionNo: item.questionNo,
      answer: index < 3 ? "A" : "B",
    })), boundaryKeys, yksProfile);

    expect(below.scoreViews?.[0]).toMatchObject({ status: "NOT_ELIGIBLE", profileId: yksScoringProfileId });
    expect(below.scoreViews?.[0]).not.toHaveProperty("practiceScore");
    expect(below.branches[0]?.net).toBe(0.25);
    expect(boundary.branches[0]?.net).toBe(0.5);
    expect(boundary.scoreViews?.[0]).toMatchObject({ status: "CALCULATED", profileId: yksScoringProfileId });
    expect(boundary.total).not.toHaveProperty("standardScore");
  });

  it("examType taşımayan legacy configte önceki LGS tahmin davranışını korur", () => {
    const { examType: _examType, ...legacyConfig } = config;
    const result = scoreExam(
      [{ questionNo: 1, answer: "A" }],
      [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
      legacyConfig,
    );

    expect(result.total.estimatedRawScore).toBe(4.348);
  });

  it("profileId boş legacy LGS davranışını korur, uyumsuz profile fail-closed reddeder", () => {
    const legacy = scoreExam(
      [{ questionNo: 1, answer: "A" }],
      [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
      { ...config, examType: "LGS", examYear: 2026 },
    );
    expect(legacy.scoreViews).toBeUndefined();
    expect(legacy.total.standardScore).toBe(1);
    expect(() => scoreExam(
      [{ questionNo: 1, answer: "A" }],
      [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
      { ...config, examType: "LGS", examYear: 2025, scoringProfileId: lgsScoringProfileId },
    )).toThrow("SCORING_PROFILE_MISMATCH");
  });

  it("resmî profil cezası ve fiziksel section dağılımı uyumsuzluğunu fail-closed reddeder", () => {
    expect(() => scoreExam([], lgsKeys(), { ...lgsProfile, wrongPenalty: 0.25 }))
      .toThrow("SCORING_PROFILE_WRONG_PENALTY_MISMATCH");
    expect(() => scoreExam([], lgsKeys().slice(0, 89), lgsProfile))
      .toThrow("SCORING_PROFILE_SECTION_DISTRIBUTION_INVALID");
    expect(() => scoreExam([], lgsKeys().map((item, index) =>
      index === 0 ? { ...item, scoreSection: "TYT_TURKCE" as const } : item), lgsProfile))
      .toThrow("SCORING_PROFILE_SECTION_DISTRIBUTION_INVALID");
  });

  it("AYT alan puanında bağlı TYT yoksa MISSING_TYT, alan testi uygun değilse NOT_ELIGIBLE üretir", () => {
    const sections = [
      { section: "AYT_MATEMATIK" as const, correct: 0, wrong: 0, blank: 1, net: 0, questionCount: 1, successRate: 0 },
      { section: "AYT_EDEBIYAT" as const, correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, successRate: 100 },
    ];

    expect(calculateAytScoreViews(sections).every((view) => view.status === "MISSING_TYT")).toBe(true);
    const linked = calculateAytScoreViews(sections, { status: "CALCULATED", practiceScore: 300 });
    expect(linked.find((view) => view.type === "SAY")?.status).toBe("NOT_ELIGIBLE");
    expect(linked.find((view) => view.type === "EA")).toMatchObject({
      status: "CALCULATED",
      practiceScore: 270,
      officialComparable: false,
    });
    expect(linked.find((view) => view.type === "SOZ")?.status).toBe("CALCULATED");
  });

  it("160 soruluk AYT dağılımında tam doğruyu 500 hesaplar, tümü iptal bölümü paydadan çıkarır", () => {
    const configAyt = {
      ...yksProfile,
      examType: "AYT" as const,
      linkedTytScore: { status: "CALCULATED" as const, practiceScore: 500 },
    };
    const keys = aytKeys();
    const full = scoreExam(keys.map(({ questionNo }) => ({ questionNo, answer: "A" })), keys, configAyt);
    const cancelledMathKeys = keys.map((item) => ({
      ...item,
      ...(item.scoreSection === "AYT_MATEMATIK" ? { evaluationStatus: "CANCELLED" as const } : {}),
    }));
    const cancelledMath = scoreExam(
      cancelledMathKeys.map(({ questionNo }) => ({ questionNo, answer: "A" })),
      cancelledMathKeys,
      configAyt,
    );

    expect(full.scoreViews?.map((view) => view.practiceScore)).toEqual([500, 500, 500]);
    expect(cancelledMath.scoreViews?.map((view) => view.practiceScore)).toEqual([500, 500, 500]);
    expect(cancelledMath._meta).toMatchObject({ physicalQuestionCount: 160, activeQuestionCount: 120 });
  });
});

function key(
  questionNo: number,
  scoreSection: ScoreSection,
  correctAnswer: "A" | "B" | "C" | "D" | "E",
) {
  return { questionNo, correctAnswer, branch: scoreSection, scoreSection };
}

function lgsKeys() {
  return profileKeys([
    ["LGS_TURKCE", 20],
    ["LGS_MATEMATIK", 20],
    ["LGS_FEN", 20],
    ["LGS_INKILAP", 10],
    ["LGS_DIN", 10],
    ["LGS_YABANCI_DIL", 10],
  ]);
}

function tytKeys() {
  return profileKeys([
    ["TYT_TURKCE", 40],
    ["TYT_SOSYAL", 20],
    ["TYT_MATEMATIK", 40],
    ["TYT_FEN", 20],
  ]);
}

function aytKeys() {
  return profileKeys([
    ["AYT_MATEMATIK", 40],
    ["AYT_FIZIK", 14],
    ["AYT_KIMYA", 13],
    ["AYT_BIYOLOJI", 13],
    ["AYT_EDEBIYAT", 24],
    ["AYT_TARIH_1", 10],
    ["AYT_COGRAFYA_1", 6],
    ["AYT_TARIH_2", 11],
    ["AYT_COGRAFYA_2", 11],
    ["AYT_FELSEFE", 12],
    ["AYT_DIN", 6],
  ]);
}

function profileKeys(sections: Array<[ScoreSection, number]>) {
  let questionNo = 0;
  return sections.flatMap(([section, count]) =>
    Array.from({ length: count }, () => key(++questionNo, section, "A")));
}
