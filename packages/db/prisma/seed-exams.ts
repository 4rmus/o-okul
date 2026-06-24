import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import ExcelJS from "exceljs";
import pg from "pg";
import { alignAnswersToMaster } from "../../../apps/worker/src/jobs/booklet-alignment.ts";
import { OpticalAnswerParser, type UnmatchedParsedAnswer } from "../../../apps/worker/src/jobs/optical-answer-parser.ts";
import {
  scoreExam,
  scoringEngineVersion,
  type AnswerKeyItem,
  type Choice,
  type ScoringResult,
  type StudentAnswer,
} from "../../../apps/worker/src/jobs/scoring-engine.ts";
import { getParserConfigPresetSuggestion } from "../../../packages/shared-types/src/format-analyzer.ts";
import { DEMO_TENANT_ID, type DemoFixtures, type DemoStudent, fixturePath, loadDemoFixtures, normalizeCourseName } from "./demo-fixtures.ts";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://migration:migration@localhost:5432/o_okul";

const TENANT_ID = DEMO_TENANT_ID;
const ANSWER_KEY_VERSION = "v1";
const PARSER_CONFIG_VERSION = "optik-7108-lgs-v1";
const WRONG_PENALTY = 1 / 3;
const COMPUTED_AT = "2026-06-02T00:00:00.000Z";

type ExamSource = {
  id: string;
  title: string;
  answerKeyId: string;
  rawImportId: string;
  txtPath: string;
  answerKeyPath: string;
};

type BookletVariant = {
  code: string;
  permutation: number[];
};

export type SeedExam = ExamSource & {
  sha256: string;
  rawContent: string;
  questions: AnswerKeyItem[];
  bookletVariants: BookletVariant[];
  matchedEntries: SeedExamEntry[];
  unmatchedEntries: SeedExamUnmatchedEntry[];
  unmatchedCount: number;
};

type SeedExamEntry = {
  studentId: string;
  studentNo: string;
  participantId: string;
  parsedAnswerId: string;
  bookletType: string;
  rowNumber: number;
  answers: StudentAnswer[];
  score: ScoringResult;
};

type SeedExamUnmatchedEntry = {
  id: string;
  rowNumber: number;
  rawRow: UnmatchedParsedAnswer["rawRow"];
  reason: UnmatchedParsedAnswer["reason"];
};

type WorkbookRow = {
  section: string;
  globalQuestionNo: number;
  localQuestionNo: number;
  bEquivalent: number;
  correctAnswer: Exclude<Choice, "">;
  branch: string;
  outcomeCode?: string;
  topic?: string;
};

const examSources: ExamSource[] = [
  {
    id: "exam-demo-isem-lgs-1",
    title: "İSEM - LGS - 1",
    answerKeyId: "exam-demo-isem-lgs-1-ak-v1",
    rawImportId: "exam-demo-isem-lgs-1-raw-import",
    txtPath: fixturePath("iSEM .txt"),
    answerKeyPath: fixturePath("iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx"),
  },
  {
    id: "exam-demo-muba-lgs-3",
    title: "MUBA - LGS - 3",
    answerKeyId: "exam-demo-muba-lgs-3-ak-v1",
    rawImportId: "exam-demo-muba-lgs-3-raw-import",
    txtPath: fixturePath("MUBA.txt"),
    answerKeyPath: fixturePath("MUBA - LGS - 3 Detaylı Cevap Anahtarı.xlsx"),
  },
  {
    id: "exam-demo-3d-lgs-2",
    title: "3D - PROVA LGS - 2",
    answerKeyId: "exam-demo-3d-lgs-2-ak-v1",
    rawImportId: "exam-demo-3d-lgs-2-raw-import",
    txtPath: fixturePath("3D.txt"),
    answerKeyPath: fixturePath("3D - PROVA LGS - 2 Detaylı Cevap Anahtarı.xlsx"),
  },
];

export async function buildSeedExams(): Promise<SeedExam[]> {
  const fixtures = await loadDemoFixtures();
  return buildSeedExamsForStudents(fixtures.students);
}

async function buildSeedExamsForStudents(students: DemoStudent[]): Promise<SeedExam[]> {
  return Promise.all(examSources.map((source) => buildSeedExam(source, students)));
}

async function buildSeedExam(source: ExamSource, students: DemoStudent[]): Promise<SeedExam> {
  const rawContent = readFileSync(source.txtPath, "utf8");
  const answerKey = await readAnswerKey(source.answerKeyPath);
  const rowMetaByNumber = readOptikRowMeta(rawContent);
  const studentByNo = new Map(students.map((student) => [student.studentNo, student]));
  const participants = students.map((student) => ({
    participantId: participantId(source.id, student.studentNo),
    studentNo: student.studentNo,
    participantNo: student.studentNo,
  }));

  const parserConfig = getParserConfigPresetSuggestion("OPTIK_7108_LGS");
  const parsed = new OpticalAnswerParser().parse({
    tenantId: TENANT_ID,
    examId: source.id,
    rawImportId: source.rawImportId,
    parserConfigVersion: PARSER_CONFIG_VERSION,
    content: rawContent,
    parserConfig,
    participants,
  });

  const matchedEntries = parsed.matched
    .map((row): SeedExamEntry => {
      const rowMeta = rowMetaByNumber.get(row.rowNumber);
      const student = rowMeta ? studentByNo.get(rowMeta.studentNo) : undefined;
      if (!rowMeta || !student) {
        throw new Error("SEED_EXAM_MATCHED_ROW_INVALID");
      }

      const alignedAnswers = alignAnswersToMaster(row.answers, rowMeta.bookletType, answerKey.bookletVariants);
      return {
        studentId: student.id,
        studentNo: student.studentNo,
        participantId: row.participantId,
        parsedAnswerId: parsedAnswerId(source.id, student.studentNo),
        bookletType: rowMeta.bookletType,
        rowNumber: row.rowNumber,
        answers: row.answers,
        score: scoreExam(alignedAnswers, answerKey.questions, createScoringConfig()),
      };
    })
    .sort((left, right) => Number(left.studentNo) - Number(right.studentNo));

  return {
    ...source,
    sha256: createHash("sha256").update(rawContent).digest("hex"),
    rawContent,
    questions: answerKey.questions,
    bookletVariants: answerKey.bookletVariants,
    matchedEntries,
    unmatchedEntries: parsed.unmatched.map((row) => ({
      id: importQuarantineId(source.id, row.rowNumber),
      rowNumber: row.rowNumber,
      rawRow: row.rawRow,
      reason: row.reason,
    })),
    unmatchedCount: parsed.unmatched.length,
  };
}

async function readAnswerKey(path: string): Promise<{ questions: AnswerKeyItem[]; bookletVariants: BookletVariant[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("ANSWER_KEY_WORKSHEET_MISSING");

  const headers = readHeaders(worksheet.getRow(1));
  const rows: WorkbookRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const questionNoText = cellText(row.getCell(headers.questionNo).value);
    if (!questionNoText) return;

    const correctAnswer = cellText(row.getCell(headers.correctAnswer).value).toUpperCase();
    if (!isChoice(correctAnswer)) {
      throw new Error("ANSWER_KEY_CORRECT_ANSWER_INVALID");
    }

    const section = cellText(row.getCell(headers.section).value);
    const branch = normalizeCourseName(cellText(row.getCell(headers.branch).value) || section);
    if (!section || !branch) {
      throw new Error("ANSWER_KEY_BRANCH_INVALID");
    }

    rows.push({
      section,
      globalQuestionNo: rows.length + 1,
      localQuestionNo: readPositiveInteger(questionNoText),
      bEquivalent: readPositiveInteger(cellText(row.getCell(headers.bEquivalent).value)),
      correctAnswer,
      branch,
      outcomeCode: cellText(row.getCell(headers.outcomeCode).value),
      topic: cellText(row.getCell(headers.topic).value),
    });
  });

  if (rows.length !== 90) {
    throw new Error("ANSWER_KEY_QUESTION_COUNT_INVALID");
  }

  const bPermutation = createGlobalBPermutation(rows);
  assertPermutation(bPermutation);

  return {
    questions: rows.map((row) => ({
      questionNo: row.globalQuestionNo,
      correctAnswer: row.correctAnswer,
      branch: row.branch,
      ...(row.outcomeCode ? { outcomeCode: row.outcomeCode } : {}),
      ...(row.topic ? { topic: row.topic } : {}),
    })),
    bookletVariants: [{ code: "B", permutation: bPermutation }],
  };
}

function readHeaders(row: ExcelJS.Row): {
  section: number;
  questionNo: number;
  bEquivalent: number;
  correctAnswer: number;
  outcomeCode: number;
  topic: number;
  branch: number;
} {
  const headers = new Map<string, number>();
  row.eachCell((cell, colNumber) => headers.set(normalizeHeader(cellText(cell.value)), colNumber));
  return {
    section: requiredHeader(headers, "BÖLÜM"),
    questionNo: requiredHeader(headers, "SORU NO"),
    bEquivalent: requiredHeader(headers, "B KARŞILIĞI"),
    correctAnswer: requiredHeader(headers, "CEVAP"),
    outcomeCode: requiredHeader(headers, "KAZANIM"),
    topic: requiredHeader(headers, "KONU"),
    branch: requiredHeader(headers, "BRANŞ"),
  };
}

function createGlobalBPermutation(rows: WorkbookRow[]): number[] {
  const sectionStats = new Map<string, { start: number; count: number }>();
  for (const row of rows) {
    const current = sectionStats.get(row.section);
    sectionStats.set(row.section, {
      start: current?.start ?? row.globalQuestionNo,
      count: (current?.count ?? 0) + 1,
    });
  }

  return rows.map((row) => {
    const section = sectionStats.get(row.section);
    if (!section || row.localQuestionNo > section.count || row.bEquivalent > section.count) {
      throw new Error("ANSWER_KEY_B_EQUIVALENT_INVALID");
    }
    return section.start + row.bEquivalent - 1;
  });
}

function assertPermutation(permutation: number[]): void {
  const seen = new Set<number>();
  for (const questionNo of permutation) {
    if (!Number.isInteger(questionNo) || questionNo <= 0 || questionNo > 90 || seen.has(questionNo)) {
      throw new Error("ANSWER_KEY_B_PERMUTATION_INVALID");
    }
    seen.add(questionNo);
  }
}

function readOptikRowMeta(content: string): Map<number, { studentNo: string; bookletType: string }> {
  const rows = new Map<number, { studentNo: string; bookletType: string }>();
  content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (line.trim().length === 0) return;
      rows.set(index + 1, {
        studentNo: line.slice(11, 15).trim(),
        bookletType: line.slice(50, 51).trim(),
      });
    });
  return rows;
}

function createScoringConfig() {
  return {
    answerKeyVersion: ANSWER_KEY_VERSION,
    computedAt: COMPUTED_AT,
    engineVersion: scoringEngineVersion,
    wrongPenalty: WRONG_PENALTY,
  };
}

function participantId(examId: string, studentNo: string): string {
  return `participant-${examId}-${studentNo}`;
}

function parsedAnswerId(examId: string, studentNo: string): string {
  return `parsed-${examId}-${studentNo}`;
}

function importQuarantineId(examId: string, rowNumber: number): string {
  return `quarantine-${examId}-${rowNumber}`;
}

function resultId(participantIdValue: string): string {
  return `result-${participantIdValue}`;
}

function resultKey(participantIdValue: string): string {
  return [participantIdValue, ANSWER_KEY_VERSION, PARSER_CONFIG_VERSION, scoringEngineVersion].join("_");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result);
    return "";
  }
  return String(value).trim();
}

function requiredHeader(headers: Map<string, number>, name: string): number {
  const index = headers.get(normalizeHeader(name));
  if (!index) {
    throw new Error("ANSWER_KEY_HEADER_MISSING");
  }
  return index;
}

function normalizeHeader(value: string): string {
  return value.toLocaleUpperCase("tr-TR").replace(/\s+/g, " ").trim();
}

function readPositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("ANSWER_KEY_POSITIVE_INTEGER_INVALID");
  }
  return parsed;
}

function isChoice(value: string): value is Exclude<Choice, ""> {
  return value === "A" || value === "B" || value === "C" || value === "D" || value === "E";
}

async function seedDatabase(seedExams: SeedExam[], fixtures: DemoFixtures): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");

    await cleanupExamData(client, seedExams.map((exam) => exam.id));
    await seedClasses(client, fixtures);
    await seedStudents(client, fixtures);

    for (const exam of seedExams) {
      await seedExam(client, exam);
    }

    await client.query("COMMIT");
    console.log(`Seeded ${fixtures.students.length} students across ${seedExams.length} real exams`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function cleanupExamData(client: pg.PoolClient, examIds: string[]): Promise<void> {
  await client.query(`DELETE FROM "ReportSnapshot" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ExamResult" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ParsedAnswer" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ImportQuarantine" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ExamParticipant" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "RawImport" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "AnswerKey" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ExamBookletVariant" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
  await client.query(`DELETE FROM "ParserConfig" WHERE "tenantId" = $1 AND "examId" = ANY($2::text[])`, [TENANT_ID, examIds]);
}

async function seedClasses(client: pg.PoolClient, fixtures: DemoFixtures): Promise<void> {
  for (const demoClass of fixtures.classes) {
    await client.query(
      `
        INSERT INTO "Class" ("id", "tenantId", "name", "level", "updatedAt")
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "level" = EXCLUDED."level", "deletedAt" = NULL, "updatedAt" = now()
      `,
      [demoClass.id, TENANT_ID, demoClass.name, demoClass.level],
    );
  }
}

async function seedStudents(client: pg.PoolClient, fixtures: DemoFixtures): Promise<void> {
  for (const student of fixtures.students) {
    await client.query(
      `
        INSERT INTO "Student" ("id","tenantId","classId","responsibleTeacherId","status","firstName","lastName","studentNo","email","phone","updatedAt")
        VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9,now())
        ON CONFLICT ("id") DO UPDATE SET "firstName"=EXCLUDED."firstName","lastName"=EXCLUDED."lastName",
          "studentNo"=EXCLUDED."studentNo","email"=EXCLUDED."email","phone"=EXCLUDED."phone","classId"=EXCLUDED."classId",
          "responsibleTeacherId"=EXCLUDED."responsibleTeacherId","deletedAt"=NULL,"updatedAt"=now()
      `,
      [
        student.id,
        TENANT_ID,
        student.classId,
        student.responsibleTeacherId,
        student.firstName,
        student.lastName,
        student.studentNo,
        student.email,
        student.phone,
      ],
    );

    await client.query(
      `
        INSERT INTO "StudentClassHistory" ("id","tenantId","studentId","classId","startsAt","reason","updatedAt")
        VALUES ($1,$2,$3,$4,'2026-06-01'::date,'CREATED',now())
        ON CONFLICT ("id") DO UPDATE SET "classId"=EXCLUDED."classId","endsAt"=NULL,"updatedAt"=now()
      `,
      [`student-class-history-${student.id}`, TENANT_ID, student.id, student.classId],
    );

    await client.query(
      `
        INSERT INTO "StudentEnrollment" ("id","tenantId","studentId","classId","status","startsAt","reason","updatedAt")
        VALUES ($1,$2,$3,$4,'ACTIVE','2026-06-01'::date,'CREATED',now())
        ON CONFLICT ("id") DO UPDATE SET "classId"=EXCLUDED."classId","status"=EXCLUDED."status","endsAt"=NULL,"updatedAt"=now()
      `,
      [`student-enrollment-${student.id}`, TENANT_ID, student.id, student.classId],
    );
  }
}

async function seedExam(client: pg.PoolClient, exam: SeedExam): Promise<void> {
  const parserConfig = getParserConfigPresetSuggestion("OPTIK_7108_LGS");

  await client.query(
    `
      INSERT INTO "Exam" ("id","tenantId","title","status","updatedAt")
      VALUES ($1,$2,$3,'PUBLISHED',now())
      ON CONFLICT ("id") DO UPDATE SET "title"=EXCLUDED."title","status"=EXCLUDED."status","updatedAt"=now()
    `,
    [exam.id, TENANT_ID, exam.title],
  );

  await client.query(
    `
      INSERT INTO "ParserConfig" ("id","tenantId","examId","version","encoding","delimiter","skipHeaderLines","fieldMapping","status","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'PUBLISHED',now())
      ON CONFLICT ("tenantId","examId","version") DO UPDATE SET "fieldMapping"=EXCLUDED."fieldMapping","status"=EXCLUDED."status","updatedAt"=now()
    `,
    [
      `${exam.id}-pc`,
      TENANT_ID,
      exam.id,
      PARSER_CONFIG_VERSION,
      parserConfig.encoding,
      parserConfig.delimiter,
      parserConfig.skipHeaderLines,
      JSON.stringify(parserConfig.fieldMapping),
    ],
  );

  await client.query(
    `
      INSERT INTO "AnswerKey" ("id","tenantId","examId","version","keyData","scoringConfig","publishedAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,now(),now())
      ON CONFLICT ("tenantId","examId","version") DO UPDATE SET "keyData"=EXCLUDED."keyData","scoringConfig"=EXCLUDED."scoringConfig","publishedAt"=COALESCE("AnswerKey"."publishedAt",now()),"updatedAt"=now()
    `,
    [
      exam.answerKeyId,
      TENANT_ID,
      exam.id,
      ANSWER_KEY_VERSION,
      JSON.stringify({ questions: exam.questions }),
      JSON.stringify({ wrongPenalty: WRONG_PENALTY }),
    ],
  );

  for (const variant of exam.bookletVariants) {
    await client.query(
      `
        INSERT INTO "ExamBookletVariant" ("id","tenantId","examId","code","permutation","updatedAt")
        VALUES ($1,$2,$3,$4,$5::jsonb,now())
        ON CONFLICT ("tenantId","examId","code") DO UPDATE SET "permutation"=EXCLUDED."permutation","deletedAt"=NULL,"updatedAt"=now()
      `,
      [`${exam.id}-booklet-${variant.code.toLowerCase()}`, TENANT_ID, exam.id, variant.code, JSON.stringify(variant.permutation)],
    );
  }

  await client.query(
    `
      INSERT INTO "RawImport" ("id","tenantId","examId","sourceType","fileName","s3Key","sha256","parserConfigVersion","metadata","updatedAt")
      VALUES ($1,$2,$3,'OPTIK_TXT',$4,$5,$6,$7,$8::jsonb,now())
      ON CONFLICT ("id") DO UPDATE SET "sha256"=EXCLUDED."sha256","fileName"=EXCLUDED."fileName","s3Key"=EXCLUDED."s3Key",
        "metadata"=EXCLUDED."metadata","updatedAt"=now()
    `,
    [
      exam.rawImportId,
      TENANT_ID,
      exam.id,
      `${exam.title}.txt`,
      `seeds/${exam.id}.txt`,
      exam.sha256,
      PARSER_CONFIG_VERSION,
      JSON.stringify({
        sourceFixture: exam.txtPath,
        answerKeyFixture: exam.answerKeyPath,
        matchedDemoStudents: exam.matchedEntries.length,
        unmatchedRows: exam.unmatchedCount,
      }),
    ],
  );

  for (const unmatched of exam.unmatchedEntries) {
    await client.query(
      `
        INSERT INTO "ImportQuarantine" ("id","tenantId","examId","rawImportId","rowNumber","rawRow","reason","status","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,'OPEN',now())
        ON CONFLICT ("tenantId","rawImportId","rowNumber") DO UPDATE SET "rawRow"=EXCLUDED."rawRow","reason"=EXCLUDED."reason",
          "status"='OPEN',"resolvedStudentId"=NULL,"deletedAt"=NULL,"updatedAt"=now()
      `,
      [
        unmatched.id,
        TENANT_ID,
        exam.id,
        exam.rawImportId,
        unmatched.rowNumber,
        JSON.stringify(unmatched.rawRow),
        unmatched.reason,
      ],
    );
  }

  for (const entry of exam.matchedEntries) {
    await client.query(
      `
        INSERT INTO "ExamParticipant" ("id","tenantId","examId","studentId","participantNo","bookletType","status","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,'REGISTERED',now())
        ON CONFLICT ("tenantId","examId","studentId") DO UPDATE SET "bookletType"=EXCLUDED."bookletType","participantNo"=EXCLUDED."participantNo","updatedAt"=now()
      `,
      [entry.participantId, TENANT_ID, exam.id, entry.studentId, entry.studentNo, entry.bookletType],
    );

    await client.query(
      `
        INSERT INTO "ParsedAnswer" ("id","tenantId","examId","rawImportId","participantId","parserConfigVersion","rowNumber","answers","status","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'MATCHED',now())
        ON CONFLICT ("tenantId","rawImportId","participantId","parserConfigVersion") DO UPDATE SET "rowNumber"=EXCLUDED."rowNumber","answers"=EXCLUDED."answers","updatedAt"=now()
      `,
      [
        entry.parsedAnswerId,
        TENANT_ID,
        exam.id,
        exam.rawImportId,
        entry.participantId,
        PARSER_CONFIG_VERSION,
        entry.rowNumber,
        JSON.stringify(entry.answers),
      ],
    );

    await client.query(
      `
        INSERT INTO "ExamResult" ("id","tenantId","examId","studentId","participantId","rawImportId","answerKeyId","answerKeyVersion","parserConfigVersion","engineVersion","resultKey","scoreData","computedAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz,now())
        ON CONFLICT ("tenantId","resultKey") DO UPDATE SET "scoreData"=EXCLUDED."scoreData","computedAt"=EXCLUDED."computedAt","updatedAt"=now()
      `,
      [
        resultId(entry.participantId),
        TENANT_ID,
        exam.id,
        entry.studentId,
        entry.participantId,
        exam.rawImportId,
        exam.answerKeyId,
        ANSWER_KEY_VERSION,
        PARSER_CONFIG_VERSION,
        scoringEngineVersion,
        resultKey(entry.participantId),
        JSON.stringify(entry.score),
        COMPUTED_AT,
      ],
    );
  }
}

function printDryRun(seedExams: SeedExam[], fixtures: DemoFixtures): void {
  const summary = seedExams.map((exam) => ({
    id: exam.id,
    title: exam.title,
    questions: exam.questions.length,
    bPermutationHead: exam.bookletVariants[0]?.permutation.slice(0, 5) ?? [],
    matchedDemoStudents: exam.matchedEntries.length,
    unmatchedRows: exam.unmatchedCount,
    accountStudent: fixtures.accountStudent.studentNo,
    accountStudentScore: exam.matchedEntries.find((entry) => entry.studentNo === fixtures.accountStudent.studentNo)?.score.total,
  }));
  console.log(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const fixtures = await loadDemoFixtures();
  const seedExams = await buildSeedExamsForStudents(fixtures.students);
  if (process.argv.includes("--dry-run")) {
    printDryRun(seedExams, fixtures);
    return;
  }
  await seedDatabase(seedExams, fixtures);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
