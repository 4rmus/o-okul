import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSnapshotWorkbook } from "../apps/api/dist/report/report-generation.service.js";
import {
  createExamResultSummarySnapshot,
  examResultSummaryReportType,
} from "../apps/worker/dist/jobs/report-generation-job.js";
import { processReportPdfRenderJob } from "../apps/worker/dist/jobs/report-pdf-render-job.js";
import {
  lgsScoringProfileId,
  scoreExam,
  scoringEngineVersion,
  yksScoringProfileId,
} from "../apps/worker/dist/jobs/scoring-engine.js";

const generatedAt = "2026-07-27T09:00:00.000Z";
const exampleMarker = "ÖRNEK — RESMÎ PUAN DEĞİLDİR";
const outputDirectory = resolve("docs/examples/2026-nosd-report-package");
const answerChoices = ["A", "B", "C", "D", "E"];
const students = Array.from({ length: 12 }, (_value, index) => ({
  id: `example-student-${String(index + 1).padStart(2, "0")}`,
  displayName: `Örnek Öğrenci ${String(index + 1).padStart(2, "0")}`,
  studentNo: `S-${String(index + 1).padStart(3, "0")}`,
  participantNo: `ÖR-${String(index + 1).padStart(3, "0")}`,
  bookletType: index % 2 === 0 ? "A" : "B",
  classId: index < 6 ? "example-class-8a" : "example-class-8b",
  className: index < 6 ? "8-A Örnek" : "8-B Örnek",
}));
const performanceLevels = [1, 0.88, 0.88, 0.76, 0.68, 0.59, 0.51, 0.42, 0.3, 0.16, 0, 0.72];

const examDefinitions = {
  LGS: {
    id: "example-lgs-2026",
    title: "Örnek LGS Denemesi 2026",
    startsAt: "2026-06-14T06:30:00.000Z",
    profileId: lgsScoringProfileId,
    penalty: 1 / 3,
    sections: [
      ["LGS_TURKCE", "Türkçe", 20],
      ["LGS_MATEMATIK", "Matematik", 20],
      ["LGS_FEN", "Fen Bilimleri", 20],
      ["LGS_INKILAP", "T.C. İnkılap Tarihi", 10],
      ["LGS_DIN", "Din Kültürü", 10],
      ["LGS_YABANCI_DIL", "Yabancı Dil", 10],
    ],
  },
  TYT: {
    id: "example-tyt-2026",
    title: "Örnek TYT Denemesi 2026",
    startsAt: "2026-06-20T07:15:00.000Z",
    profileId: yksScoringProfileId,
    penalty: 1 / 4,
    sections: [
      ["TYT_TURKCE", "Türkçe", 40],
      ["TYT_SOSYAL", "Sosyal Bilimler", 20],
      ["TYT_MATEMATIK", "Temel Matematik", 40],
      ["TYT_FEN", "Fen Bilimleri", 20],
    ],
  },
  AYT: {
    id: "example-ayt-2026",
    title: "Örnek AYT Denemesi 2026",
    startsAt: "2026-06-21T07:15:00.000Z",
    profileId: yksScoringProfileId,
    penalty: 1 / 4,
    sections: [
      ["AYT_MATEMATIK", "AYT Matematik", 40],
      ["AYT_FIZIK", "Fizik", 14],
      ["AYT_KIMYA", "Kimya", 13],
      ["AYT_BIYOLOJI", "Biyoloji", 13],
      ["AYT_EDEBIYAT", "Türk Dili ve Edebiyatı", 24],
      ["AYT_TARIH_1", "Tarih-1", 10],
      ["AYT_COGRAFYA_1", "Coğrafya-1", 6],
      ["AYT_TARIH_2", "Tarih-2", 11],
      ["AYT_COGRAFYA_2", "Coğrafya-2", 11],
      ["AYT_FELSEFE", "Felsefe Grubu", 12],
      ["AYT_DIN", "Din Kültürü/İlave Felsefe", 6],
    ],
  },
};

await mkdir(outputDirectory, { recursive: true });
configureChromium();

const lgsKey = createAnswerKey(examDefinitions.LGS);
const tytKey = createAnswerKey(examDefinitions.TYT);
const aytKey = createAnswerKey(examDefinitions.AYT, { correctedQuestion: 23, cancelledSection: "AYT_EDEBIYAT", cancelledLocalQuestion: 20 });

const lgsResults = students.map((student, index) =>
  createResult(student, index, examDefinitions.LGS, lgsKey, performanceLevels[index]));
const tytResults = students.slice(0, 11).map((student, index) =>
  createResult(student, index, examDefinitions.TYT, tytKey, index === 10 ? 0 : performanceLevels[index]));
const tytByStudent = new Map(tytResults.map((result) => [result.studentId, result]));
const aytResults = students.map((student, index) => {
  const linkedTytResult = index === 11 ? undefined : tytByStudent.get(student.id);
  const level = index === 9 ? 0 : performanceLevels[index];
  return createResult(student, index, examDefinitions.AYT, aytKey, level, linkedTytResult);
});

const snapshots = [
  createSnapshotRecord(examDefinitions.LGS, lgsResults),
  createSnapshotRecord(examDefinitions.TYT, tytResults),
  createSnapshotRecord(examDefinitions.AYT, aytResults),
];
assertScenarios(snapshots);

const manifest = {
  marker: exampleMarker,
  generatedAt,
  officialComparable: false,
  containsRealPersonalData: false,
  studentCount: students.length,
  classes: ["8-A Örnek", "8-B Örnek"],
  scenarios: [
    "LGS 90 soru ve 1/3 yanlış cezası",
    "TYT 120 soru ve 1/4 yanlış cezası",
    "Bağlı TYT ile AYT SAY/EA/SÖZ",
    "Eşit puanda aynı kurum ve sınıf sırası",
    "TYT hesaplama koşulu sağlanmadı",
    "AYT alan hesaplama koşulu sağlanmadı",
    "Bağlı TYT sonucu eksik",
    "2026 AYT Matematik 23 cevap düzeltmesi örneği",
    "2026 AYT TDE-SB1 20 iptal örneği",
  ],
  artifacts: [],
};

for (const snapshot of snapshots) {
  const type = snapshot.snapshotData.examType.toLowerCase();
  await writeJson(`${type}-golden-snapshot.json`, snapshot);
  manifest.artifacts.push(`${type}-golden-snapshot.json`);

  const workbook = await createSnapshotWorkbook(snapshot);
  await writeBinary(`${type}-kurum-raporu.xlsx`, workbook.fileBase64);
  manifest.artifacts.push(`${type}-kurum-raporu.xlsx`);

  const institutionPdf = await renderPdf(snapshot, "INSTITUTION_SUMMARY", `${type}-kurum-ozeti.pdf`);
  manifest.artifacts.push(`${type}-kurum-ozeti.pdf`);

  const selected = snapshot.snapshotData.students.find((student) => student.studentId === "example-student-04");
  if (!selected) throw new Error(`${type.toUpperCase()}_SELECTED_STUDENT_MISSING`);
  const studentPdf = await renderPdf(
    { ...snapshot, snapshotData: { ...snapshot.snapshotData, students: [selected] } },
    "STUDENT_CARDS",
    `${type}-ornek-ogrenci-04-karne.pdf`,
  );
  if (studentPdf.pageCount !== 2) {
    throw new Error(`${type.toUpperCase()}_STUDENT_PDF_PAGE_COUNT_${studentPdf.pageCount}`);
  }
  manifest.artifacts.push(`${type}-ornek-ogrenci-04-karne.pdf`);

  manifest[`${type}Summary`] = {
    resultCount: snapshot.snapshotData.resultCount,
    physicalQuestionCount: snapshot.snapshotData.students[0]?.questions.length,
    institutionPdfPageCount: institutionPdf.pageCount,
    studentPdfPageCount: studentPdf.pageCount,
  };
}

await writeJson("manifest.json", manifest);
process.stdout.write(`Örnek rapor paketi üretildi: ${outputDirectory}\n`);

function createAnswerKey(exam, options = {}) {
  const questions = [];
  let questionNo = 1;
  for (const [scoreSection, branch, count] of exam.sections) {
    for (let localQuestion = 1; localQuestion <= count; localQuestion += 1) {
      const corrected = options.correctedQuestion === questionNo;
      const cancelled = options.cancelledSection === scoreSection && options.cancelledLocalQuestion === localQuestion;
      questions.push({
        questionNo,
        correctAnswer: corrected ? "A" : answerChoices[(questionNo - 1) % answerChoices.length],
        branch,
        outcomeCode: `${scoreSection}.K${Math.ceil(localQuestion / 4)}`,
        topic: corrected
          ? "2026 AYT Matematik 23 — düzeltilmiş cevap anahtarı örneği"
          : cancelled
            ? "2026 AYT TDE-SB1 20 — iptal örneği"
            : `${branch} örnek kazanımı`,
        scoreSection,
        evaluationStatus: cancelled ? "CANCELLED" : "ACTIVE",
      });
      questionNo += 1;
    }
  }
  return questions;
}

function createAnswers(answerKey, level) {
  const answers = [];
  for (const section of new Set(answerKey.map((question) => question.scoreSection))) {
    const questions = answerKey.filter((question) => question.scoreSection === section && question.evaluationStatus !== "CANCELLED");
    const correctCount = Math.floor(questions.length * level);
    const wrongCount = Math.floor((questions.length - correctCount) * 0.35);
    questions.forEach((question, index) => {
      const answer = index < correctCount
        ? question.correctAnswer
        : index < correctCount + wrongCount
          ? wrongChoice(question.correctAnswer)
          : "";
      answers.push({ questionNo: question.questionNo, answer });
    });
  }
  return answers;
}

function createResult(student, index, exam, answerKey, level, linkedTytResult) {
  const linkedTytView = linkedTytResult?.score.scoreViews?.find((view) => view.type === "TYT");
  const score = scoreExam(createAnswers(answerKey, level), answerKey, {
    examType: snapshotExamType(exam),
    examYear: 2026,
    scoringProfileId: exam.profileId,
    ...(linkedTytView ? {
      linkedTytScore: {
        status: linkedTytView.status,
        ...(linkedTytView.practiceScore !== undefined ? { practiceScore: linkedTytView.practiceScore } : {}),
      },
    } : {}),
    wrongPenalty: exam.penalty,
    answerKeyVersion: `${exam.id}-answer-key-v2`,
    engineVersion: scoringEngineVersion,
    computedAt: generatedAt,
  });
  return {
    examId: exam.id,
    examTitle: exam.title,
    examStartsAt: exam.startsAt,
    studentId: student.id,
    displayName: student.displayName,
    studentNo: student.studentNo,
    participantNo: student.participantNo,
    bookletType: student.bookletType,
    classId: student.classId,
    className: student.className,
    resultKey: `${exam.id}-result-${String(index + 1).padStart(2, "0")}`,
    answerKeyVersion: `${exam.id}-answer-key-v2`,
    parserConfigVersion: "example-parser-v1",
    engineVersion: scoringEngineVersion,
    score,
    computedAt: generatedAt,
    ...(linkedTytResult ? {
      linkedTytResult: {
        examId: linkedTytResult.examId,
        resultKey: linkedTytResult.resultKey,
        answerKeyVersion: linkedTytResult.answerKeyVersion,
        parserConfigVersion: linkedTytResult.parserConfigVersion,
        engineVersion: linkedTytResult.engineVersion,
        score: linkedTytResult.score,
        computedAt: linkedTytResult.computedAt,
      },
    } : {}),
  };
}

function createSnapshotRecord(exam, results) {
  const candidate = createExamResultSummarySnapshot({
    tenantId: "example-tenant",
    examId: exam.id,
    reportType: examResultSummaryReportType,
    contentHash: `${exam.id}-example-input-v1`,
  }, results, generatedAt);
  return {
    id: `${exam.id}-snapshot-v1`,
    ...candidate,
    snapshotData: {
      ...candidate.snapshotData,
      exampleMarker,
    },
    createdAt: generatedAt,
    updatedAt: generatedAt,
  };
}

function assertScenarios(records) {
  const [lgs, tyt, ayt] = records;
  assertScore(lgs, "example-student-01", "LGS", "CALCULATED", 500);
  assertScore(tyt, "example-student-01", "TYT", "CALCULATED", 500);
  assertScore(tyt, "example-student-11", "TYT", "NOT_ELIGIBLE");
  assertScore(ayt, "example-student-10", "SAY", "NOT_ELIGIBLE");
  assertScore(ayt, "example-student-12", "EA", "MISSING_TYT");
  for (const type of ["SAY", "EA", "SOZ"]) assertScore(ayt, "example-student-01", type, "CALCULATED", 500);

  const firstTie = scoreView(lgs, "example-student-02", "LGS");
  const secondTie = scoreView(lgs, "example-student-03", "LGS");
  const firstRank = rankView(lgs, "example-student-02", "LGS");
  const secondRank = rankView(lgs, "example-student-03", "LGS");
  if (firstTie.practiceScore !== secondTie.practiceScore || firstRank.institution.rank !== secondRank.institution.rank) {
    throw new Error("TIED_SCORE_COMPETITION_RANK_INVALID");
  }

  const cancelled = ayt.snapshotData.students[0].questions.find((question) => question.status === "CANCELLED");
  if (!cancelled || cancelled.answer !== "" || cancelled.correctAnswer !== "") {
    throw new Error("CANCELLED_QUESTION_REDACTION_INVALID");
  }
}

function assertScore(snapshot, studentId, type, status, practiceScore) {
  const view = scoreView(snapshot, studentId, type);
  if (view.status !== status || (practiceScore !== undefined && view.practiceScore !== practiceScore)) {
    throw new Error(`${studentId}_${type}_EXPECTED_${status}_${practiceScore ?? ""}`);
  }
}

function scoreView(snapshot, studentId, type) {
  const student = snapshot.snapshotData.students.find((candidate) => candidate.studentId === studentId);
  const view = student?.scoreViews?.find((candidate) => candidate.type === type);
  if (!view) throw new Error(`${studentId}_${type}_SCORE_VIEW_MISSING`);
  return view;
}

function rankView(snapshot, studentId, type) {
  const student = snapshot.snapshotData.students.find((candidate) => candidate.studentId === studentId);
  const ranking = student?.scoreRankings?.find((candidate) => candidate.type === type);
  if (!ranking) throw new Error(`${studentId}_${type}_RANK_MISSING`);
  return ranking;
}

async function renderPdf(snapshot, pdfMode, fileName) {
  const projected = {
    ...snapshot,
    snapshotData: {
      ...snapshot.snapshotData,
      pdfMode,
    },
  };
  const result = await processReportPdfRenderJob({
    name: "report-pdf-render",
    data: {
      institution: { institutionName: "Örnek Eğitim Kurumu" },
      snapshot: projected,
    },
  });
  await writeBinary(fileName, result.fileBase64);
  return result;
}

function configureChromium() {
  if (process.env.REPORT_PDF_BROWSER_EXECUTABLE_PATH) return;
  const candidates = [
    "/Users/arair/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const executable = candidates.find(existsSync);
  if (!executable) {
    throw new Error("REPORT_PDF_BROWSER_EXECUTABLE_PATH_REQUIRED");
  }
  process.env.REPORT_PDF_BROWSER_EXECUTABLE_PATH = executable;
}

function snapshotExamType(exam) {
  if (exam.id.includes("-lgs-")) return "LGS";
  if (exam.id.includes("-tyt-")) return "TYT";
  return "AYT";
}

function wrongChoice(correctAnswer) {
  return answerChoices[(answerChoices.indexOf(correctAnswer) + 1) % answerChoices.length];
}

async function writeJson(fileName, value) {
  await writeFile(resolve(outputDirectory, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBinary(fileName, fileBase64) {
  await writeFile(resolve(outputDirectory, fileName), Buffer.from(fileBase64, "base64"));
}
