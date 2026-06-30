import { describe, expect, it } from "vitest";
import { loadDemoFixtures } from "./demo-fixtures.js";
import { buildSeedExams } from "./seed-exams.js";

describe("seed-exams gerçek pipeline", () => {
  it("demo kişi fixture'larını Excel ve TXT kaynaklarından üretir", async () => {
    const fixtures = await loadDemoFixtures();

    expect(fixtures.courses.map((course) => course.name)).toEqual([
      "Türkçe",
      "Matematik",
      "Fen Bilimleri",
      "T.C. İnkılap Tarihi ve Atatürkçülük",
      "Din Kültürü ve Ahlak Bilgisi",
      "İngilizce",
    ]);
    expect(fixtures.classes.map((demoClass) => demoClass.name)).toEqual(["8-A", "8-B"]);
    expect(fixtures.teachers).toHaveLength(3);
    expect(fixtures.students).toHaveLength(21);
    expect(fixtures.accountTeacher).toMatchObject({
      id: "teacher-demo-main",
      firstName: "Ayse",
      lastName: "Hoca",
      branch: "Matematik",
    });
    expect(fixtures.accountStudent).toMatchObject({
      id: "student-demo-101",
      firstName: "Ali",
      lastName: "Kaya",
      studentNo: "101",
      className: "8-B",
      guardianFirstName: "Mehmet",
      guardianLastName: "Kaya",
    });
    expect(fixtures.students.slice(-2).map((student) => ({
      firstName: student.firstName,
      lastName: student.lastName,
      studentNo: student.studentNo,
      sourceClass: student.className,
    }))).toEqual([
      { firstName: "ALİ", lastName: "EREN", studentNo: "119", sourceClass: "8-B" },
      { firstName: "RONİ", lastName: "KAYA", studentNo: "120", sourceClass: "8-B" },
    ]);
  });

  it("gerçek TXT/XLSX girdilerinden deterministik seed sınav verisi üretir", async () => {
    const first = await buildSeedExams();
    const second = await buildSeedExams();

    expect(second).toEqual(first);
    expect(first.map((exam) => ({
      id: exam.id,
      questionCount: exam.questions.length,
      bPermutationHead: exam.bookletVariants[0]?.permutation.slice(0, 5),
      matchedDemoStudents: exam.matchedEntries.length,
      unmatchedRows: exam.unmatchedCount,
      hasRow100Result: exam.matchedEntries.some((entry) => entry.studentNo === "100"),
      hasTxtOnlyStudents: ["119", "120"].every((studentNo) => exam.matchedEntries.some((entry) => entry.studentNo === studentNo)),
      branches: [...new Set(exam.questions.map((question) => question.branch))],
      accountStudentScore: exam.matchedEntries.find((entry) => entry.studentNo === "101")?.score.total,
    }))).toEqual([
      {
        id: "exam-demo-isem-lgs-1",
        questionCount: 90,
        bPermutationHead: [20, 19, 18, 17, 16],
        matchedDemoStudents: 21,
        unmatchedRows: 0,
        hasRow100Result: true,
        hasTxtOnlyStudents: true,
        branches: ["Türkçe", "T.C. İnkılap Tarihi ve Atatürkçülük", "Din Kültürü ve Ahlak Bilgisi", "İngilizce", "Matematik", "Fen Bilimleri"],
        accountStudentScore: {
          correct: 44,
          wrong: 31,
          blank: 15,
          net: 33.66666666666667,
          rawScore: 33.66666666666667,
          estimatedRawScore: 101.72,
          standardScore: 33.66666666666667,
        },
      },
      {
        id: "exam-demo-muba-lgs-3",
        questionCount: 90,
        bPermutationHead: [2, 1, 4, 5, 3],
        matchedDemoStudents: 21,
        unmatchedRows: 0,
        hasRow100Result: true,
        hasTxtOnlyStudents: true,
        branches: ["Türkçe", "T.C. İnkılap Tarihi ve Atatürkçülük", "Din Kültürü ve Ahlak Bilgisi", "İngilizce", "Matematik", "Fen Bilimleri"],
        accountStudentScore: {
          correct: 43,
          wrong: 43,
          blank: 4,
          net: 28.66666666666667,
          rawScore: 28.66666666666667,
          estimatedRawScore: 78.8907,
          standardScore: 28.66666666666667,
        },
      },
      {
        id: "exam-demo-3d-lgs-2",
        questionCount: 90,
        bPermutationHead: [3, 4, 1, 2, 6],
        matchedDemoStudents: 21,
        unmatchedRows: 0,
        hasRow100Result: true,
        hasTxtOnlyStudents: true,
        branches: ["Türkçe", "T.C. İnkılap Tarihi ve Atatürkçülük", "Din Kültürü ve Ahlak Bilgisi", "İngilizce", "Matematik", "Fen Bilimleri"],
        accountStudentScore: {
          correct: 24,
          wrong: 48,
          blank: 18,
          net: 8,
          rawScore: 8,
          estimatedRawScore: 20.6227,
          standardScore: 8,
        },
      },
    ]);
  });
});
