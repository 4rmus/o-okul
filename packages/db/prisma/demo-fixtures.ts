import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

export const DEMO_TENANT_ID = "tenant-demo";
export const DEMO_CLASS_START_DATE = "2026-06-01";
export const DEMO_TEACHER_USER_ID = "user-demo-teacher";
export const DEMO_STUDENT_USER_ID = "user-demo-student";
export const DEMO_GUARDIAN_USER_ID = "user-demo-guardian";

export type DemoCourse = {
  id: string;
  code: string;
  name: string;
};

export const STANDARD_COURSES: DemoCourse[] = [
  { id: "course-demo-turkce", code: "TUR", name: "Türkçe" },
  { id: "course-demo-matematik", code: "MAT", name: "Matematik" },
  { id: "course-demo-fen-bilimleri", code: "FEN", name: "Fen Bilimleri" },
  { id: "course-demo-inkilap", code: "INK", name: "T.C. İnkılap Tarihi ve Atatürkçülük" },
  { id: "course-demo-din-kulturu", code: "DIN", name: "Din Kültürü ve Ahlak Bilgisi" },
  { id: "course-demo-ingilizce", code: "ING", name: "İngilizce" },
];

export type DemoGradeLevel = {
  id: string;
  code: string;
  name: string;
};

export type DemoAlan = {
  id: string;
  code: string;
  gradeLevelId?: string;
  name: string;
};

export type DemoGradeLevelCourse = {
  id: string;
  alanId?: string;
  courseId: string;
  gradeLevelId: string;
  isDefault?: boolean;
  sortOrder: number;
};

export const CANONICAL_GRADE_LEVELS: DemoGradeLevel[] = [
  { id: "grade-demo-5", code: "5", name: "5. Sınıf" },
  { id: "grade-demo-6", code: "6", name: "6. Sınıf" },
  { id: "grade-demo-7", code: "7", name: "7. Sınıf" },
  { id: "grade-demo-lgs", code: "LGS", name: "LGS" },
  { id: "grade-demo-9", code: "9", name: "9. Sınıf" },
  { id: "grade-demo-10", code: "10", name: "10. Sınıf" },
  { id: "grade-demo-11", code: "11", name: "11. Sınıf" },
  { id: "grade-demo-tyt-ayt", code: "TYT-AYT", name: "TYT/AYT" },
  { id: "grade-demo-kpss", code: "KPSS", name: "KPSS" },
];

const ADDITIONAL_CANONICAL_COURSES: DemoCourse[] = [
  { id: "course-demo-sosyal-bilimler", code: "SOS", name: "Sosyal Bilimler" },
  { id: "course-demo-edebiyat", code: "EDB", name: "Edebiyat" },
  { id: "course-demo-fizik", code: "FIZ", name: "Fizik" },
  { id: "course-demo-kimya", code: "KIM", name: "Kimya" },
  { id: "course-demo-biyoloji", code: "BIO", name: "Biyoloji" },
  { id: "course-demo-tarih-cografya", code: "TCOG", name: "Tarih Coğrafya" },
  { id: "course-demo-geometri", code: "GEO", name: "Geometri" },
  { id: "course-demo-turk-dili-edebiyati", code: "TDE", name: "Türk Dili ve Edebiyatı" },
  { id: "course-demo-tarih", code: "TAR", name: "Tarih" },
  { id: "course-demo-cografya", code: "COG", name: "Coğrafya" },
  { id: "course-demo-tarih-1", code: "TAR1", name: "Tarih-1" },
  { id: "course-demo-tarih-2", code: "TAR2", name: "Tarih-2" },
  { id: "course-demo-cografya-1", code: "COG1", name: "Coğrafya-1" },
  { id: "course-demo-cografya-2", code: "COG2", name: "Coğrafya-2" },
  { id: "course-demo-felsefe", code: "FEL", name: "Felsefe" },
  { id: "course-demo-anayasa-vatandaslik", code: "VTD", name: "Anayasa/Vatandaşlık" },
  { id: "course-demo-guncel-bilgiler", code: "GNC", name: "Güncel Bilgiler" },
  { id: "course-demo-gelisim-psikolojisi", code: "GPS", name: "Gelişim Psikolojisi" },
  { id: "course-demo-ogrenme-psikolojisi", code: "OPS", name: "Öğrenme Psikolojisi" },
  { id: "course-demo-ogretim-ilke-teknikleri", code: "OIT", name: "Öğretim İlke ve Teknikleri" },
  { id: "course-demo-olcme-degerlendirme", code: "OLD", name: "Ölçme ve Değerlendirme" },
  { id: "course-demo-program-gelistirme", code: "PRG", name: "Program Geliştirme" },
  { id: "course-demo-rehberlik-ozel-egitim", code: "ROE", name: "Rehberlik ve Özel Eğitim" },
  { id: "course-demo-hukuk", code: "HUK", name: "Hukuk" },
  { id: "course-demo-iktisat", code: "IKT", name: "İktisat" },
  { id: "course-demo-maliye", code: "MLY", name: "Maliye" },
  { id: "course-demo-isletme", code: "ISL", name: "İşletme" },
  { id: "course-demo-muhasebe", code: "MUH", name: "Muhasebe" },
  { id: "course-demo-kamu-yonetimi", code: "KMY", name: "Kamu Yönetimi" },
  { id: "course-demo-uluslararasi-iliskiler", code: "UIL", name: "Uluslararası İlişkiler" },
  { id: "course-demo-ceko", code: "CEK", name: "ÇEKO" },
  { id: "course-demo-istatistik", code: "IST", name: "İstatistik" },
];

export const CANONICAL_COURSES: DemoCourse[] = [...STANDARD_COURSES, ...ADDITIONAL_CANONICAL_COURSES];

export const CANONICAL_ALANLAR: DemoAlan[] = [
  { id: "alan-demo-11-sayisal", code: "11-SAY", gradeLevelId: "grade-demo-11", name: "Sayısal" },
  { id: "alan-demo-11-ea", code: "11-EA", gradeLevelId: "grade-demo-11", name: "Eşit Ağırlık" },
  { id: "alan-demo-11-sozel", code: "11-SOZ", gradeLevelId: "grade-demo-11", name: "Sözel" },
  { id: "alan-demo-tyt-ayt-sayisal", code: "TYTAYT-SAY", gradeLevelId: "grade-demo-tyt-ayt", name: "Sayısal" },
  { id: "alan-demo-tyt-ayt-ea", code: "TYTAYT-EA", gradeLevelId: "grade-demo-tyt-ayt", name: "Eşit Ağırlık" },
  { id: "alan-demo-tyt-ayt-sozel", code: "TYTAYT-SOZ", gradeLevelId: "grade-demo-tyt-ayt", name: "Sözel" },
  { id: "alan-demo-kpss-genel-yetenek", code: "KPSS-GY", gradeLevelId: "grade-demo-kpss", name: "Genel Yetenek" },
  { id: "alan-demo-kpss-genel-kultur", code: "KPSS-GK", gradeLevelId: "grade-demo-kpss", name: "Genel Kültür" },
  { id: "alan-demo-kpss-oabt", code: "KPSS-OABT", gradeLevelId: "grade-demo-kpss", name: "ÖABT" },
  { id: "alan-demo-kpss-a-grubu", code: "KPSS-A", gradeLevelId: "grade-demo-kpss", name: "A Grubu Kadrolar" },
];

const MIDDLE_SCHOOL_COURSES = [
  "course-demo-turkce",
  "course-demo-matematik",
  "course-demo-fen-bilimleri",
  "course-demo-sosyal-bilimler",
  "course-demo-ingilizce",
  "course-demo-din-kulturu",
];

const LGS_COURSES = [
  "course-demo-turkce",
  "course-demo-matematik",
  "course-demo-fen-bilimleri",
  "course-demo-inkilap",
  "course-demo-ingilizce",
  "course-demo-din-kulturu",
];

const GRADE_9_10_COURSES = [
  "course-demo-edebiyat",
  "course-demo-fizik",
  "course-demo-kimya",
  "course-demo-biyoloji",
  "course-demo-tarih-cografya",
  "course-demo-ingilizce",
  "course-demo-din-kulturu",
];

const SAYISAL_COURSES = [
  "course-demo-matematik",
  "course-demo-geometri",
  "course-demo-fizik",
  "course-demo-kimya",
  "course-demo-biyoloji",
];

const EA_COURSES = [
  "course-demo-matematik",
  "course-demo-geometri",
  "course-demo-turk-dili-edebiyati",
  "course-demo-tarih",
  "course-demo-cografya",
];

const SOZEL_COURSES = [
  "course-demo-edebiyat",
  "course-demo-tarih-1",
  "course-demo-tarih-2",
  "course-demo-cografya-1",
  "course-demo-cografya-2",
  "course-demo-felsefe",
  "course-demo-din-kulturu",
];

function buildGradeLevelCourses(gradeLevelId: string, courseIds: string[], alanId?: string): DemoGradeLevelCourse[] {
  const gradeKey = gradeLevelId.replace(/^grade-demo-/, "");
  const alanKey = alanId?.replace(/^alan-demo-/, "");
  return courseIds.map((courseId, index) => ({
    id: ["grade-course", gradeKey, alanKey, courseId.replace(/^course-demo-/, "")].filter(Boolean).join("-"),
    alanId,
    courseId,
    gradeLevelId,
    isDefault: true,
    sortOrder: (index + 1) * 10,
  }));
}

export const CANONICAL_GRADE_LEVEL_COURSES: DemoGradeLevelCourse[] = [
  ...buildGradeLevelCourses("grade-demo-5", MIDDLE_SCHOOL_COURSES),
  ...buildGradeLevelCourses("grade-demo-6", MIDDLE_SCHOOL_COURSES),
  ...buildGradeLevelCourses("grade-demo-7", MIDDLE_SCHOOL_COURSES),
  ...buildGradeLevelCourses("grade-demo-lgs", LGS_COURSES),
  ...buildGradeLevelCourses("grade-demo-9", GRADE_9_10_COURSES),
  ...buildGradeLevelCourses("grade-demo-10", GRADE_9_10_COURSES),
  ...buildGradeLevelCourses("grade-demo-11", SAYISAL_COURSES, "alan-demo-11-sayisal"),
  ...buildGradeLevelCourses("grade-demo-11", EA_COURSES, "alan-demo-11-ea"),
  ...buildGradeLevelCourses("grade-demo-11", SOZEL_COURSES, "alan-demo-11-sozel"),
  ...buildGradeLevelCourses("grade-demo-tyt-ayt", SAYISAL_COURSES, "alan-demo-tyt-ayt-sayisal"),
  ...buildGradeLevelCourses("grade-demo-tyt-ayt", EA_COURSES, "alan-demo-tyt-ayt-ea"),
  ...buildGradeLevelCourses("grade-demo-tyt-ayt", SOZEL_COURSES, "alan-demo-tyt-ayt-sozel"),
  ...buildGradeLevelCourses("grade-demo-kpss", ["course-demo-turkce", "course-demo-matematik"], "alan-demo-kpss-genel-yetenek"),
  ...buildGradeLevelCourses("grade-demo-kpss", [
    "course-demo-tarih",
    "course-demo-cografya",
    "course-demo-anayasa-vatandaslik",
    "course-demo-guncel-bilgiler",
  ], "alan-demo-kpss-genel-kultur"),
  ...buildGradeLevelCourses("grade-demo-kpss", [
    "course-demo-gelisim-psikolojisi",
    "course-demo-ogrenme-psikolojisi",
    "course-demo-ogretim-ilke-teknikleri",
    "course-demo-olcme-degerlendirme",
    "course-demo-program-gelistirme",
    "course-demo-rehberlik-ozel-egitim",
  ], "alan-demo-kpss-oabt"),
  ...buildGradeLevelCourses("grade-demo-kpss", [
    "course-demo-hukuk",
    "course-demo-iktisat",
    "course-demo-maliye",
    "course-demo-isletme",
    "course-demo-muhasebe",
    "course-demo-kamu-yonetimi",
    "course-demo-uluslararasi-iliskiler",
    "course-demo-ceko",
    "course-demo-istatistik",
  ], "alan-demo-kpss-a-grubu"),
];

const studentWorkbookPath = fixturePath("ogrenci-aktarim-sablonu.xlsx");
const teacherWorkbookPath = fixturePath("ogretmen-aktarim-sablonu.xlsx");
const examTextFiles = ["iSEM .txt", "MUBA.txt", "3D.txt"];

export type DemoClass = {
  id: string;
  name: string;
  gradeLevelId?: string;
  alanId?: string;
};

export type DemoTeacher = {
  id: string;
  firstName: string;
  lastName: string;
  branch: string;
  assignedClassName?: string;
  assignedClassId?: string;
};

export type DemoStudent = {
  id: string;
  firstName: string;
  lastName: string;
  studentNo: string;
  email: string | null;
  phone: string | null;
  className: string;
  classId: string;
  responsibleTeacherId: string | null;
  guardianId: string;
  guardianFirstName: string;
  guardianLastName: string;
  guardianPhone: string | null;
};

export type DemoFixtures = {
  courses: DemoCourse[];
  classes: DemoClass[];
  teachers: DemoTeacher[];
  students: DemoStudent[];
  accountTeacher: DemoTeacher;
  accountStudent: DemoStudent;
};

type StudentWorkbookRow = {
  okul_no: string;
  ad: string;
  soyad: string;
  email: string;
  telefon: string;
  sinif: string;
  veli_ad: string;
  veli_soyad: string;
  veli_telefon: string;
};

type TeacherWorkbookRow = {
  ad: string;
  soyad: string;
  brans: string;
  atanacak_sinif?: string;
  ders?: string;
  email?: string;
  telefon?: string;
  not?: string;
};

export async function loadDemoFixtures(): Promise<DemoFixtures> {
  const studentRows = await readWorkbookRows<StudentWorkbookRow>(studentWorkbookPath, [
    "okul_no",
    "ad",
    "soyad",
    "email",
    "telefon",
    "sinif",
    "veli_ad",
    "veli_soyad",
    "veli_telefon",
  ]);
  const teacherRows = uniqueBy(await readWorkbookRows<TeacherWorkbookRow>(teacherWorkbookPath, [
    "ad",
    "soyad",
    "brans",
  ], [
    "atanacak_sinif",
    "ders",
    "email",
    "telefon",
    "not",
  ]), (teacher) =>
    [
      teacher.ad,
      teacher.soyad,
      normalizeCourseName(teacher.ders || teacher.brans),
      teacher.atanacak_sinif || "",
    ]
      .join("|")
      .toLocaleLowerCase("tr-TR"),
  );
  const optikDirectory = readOptikStudentDirectory();
  const fallbackClassName = studentRows.at(-1)?.sinif || "8 LGS A";
  const studentRowsByNo = new Map(studentRows.map((student) => [student.okul_no, student]));

  for (const optikStudent of optikDirectory.students) {
    if (studentRowsByNo.has(optikStudent.studentNo)) continue;
    studentRows.push({
      okul_no: optikStudent.studentNo,
      ad: optikStudent.firstName,
      soyad: optikStudent.lastName,
      email: `ogrenci-${optikStudent.studentNo}@demo.local`,
      telefon: "",
      sinif: fallbackClassName,
      veli_ad: optikStudent.firstName,
      veli_soyad: "Veli",
      veli_telefon: "",
    });
  }

  const classNames = uniqueSorted([
    ...studentRows.map((student) => student.sinif),
    ...teacherRows.map((teacher) => teacher.atanacak_sinif || "").filter(Boolean),
  ]);
  const classes = classNames.map((name): DemoClass => ({
    id: classId(name),
    name,
    gradeLevelId: readClassGradeLevelId(name),
  }));
  const classByName = new Map(classes.map((item) => [item.name, item]));

  const teachers = teacherRows.map((teacher, index): DemoTeacher => {
    const assignedClass = teacher.atanacak_sinif ? requiredClass(classByName, teacher.atanacak_sinif) : undefined;
    return {
      id: index === 0 ? "teacher-demo-main" : `teacher-demo-${slugify(`${teacher.email || teacher.ad}-${index + 1}`)}`,
      firstName: teacher.ad,
      lastName: teacher.soyad,
      branch: normalizeCourseName(teacher.ders || teacher.brans),
      ...(assignedClass ? { assignedClassName: assignedClass.name, assignedClassId: assignedClass.id } : {}),
    };
  });
  const teacherByClassName = new Map<string, DemoTeacher>();
  for (const teacher of teachers) {
    if (!teacher.assignedClassName) continue;
    if (!teacherByClassName.has(teacher.assignedClassName)) {
      teacherByClassName.set(teacher.assignedClassName, teacher);
    }
  }

  const students = studentRows
    .sort((left, right) => Number(left.okul_no) - Number(right.okul_no))
    .map((student, index): DemoStudent => {
      const studentClass = requiredClass(classByName, student.sinif);
      const responsibleTeacher = teacherByClassName.get(studentClass.name) ?? teachers[0] ?? null;
      return {
        id: index === 0 ? "student-demo-main" : `student-demo-${student.okul_no}`,
        firstName: student.ad,
        lastName: student.soyad,
        studentNo: student.okul_no,
        email: student.email || null,
        phone: student.telefon || null,
        className: studentClass.name,
        classId: studentClass.id,
        responsibleTeacherId: responsibleTeacher?.id ?? null,
        guardianId: index === 0 ? "guardian-demo-main" : `guardian-demo-${student.okul_no}`,
        guardianFirstName: student.veli_ad || student.ad,
        guardianLastName: student.veli_soyad || "Veli",
        guardianPhone: student.veli_telefon || null,
      };
    });

  const accountTeacher = teachers[0];
  const accountStudent = students.find((student) => optikDirectory.scorableStudentNos.has(student.studentNo)) ?? students[0];
  if (!accountTeacher || !accountStudent) {
    throw new Error("DEMO_FIXTURE_ACCOUNT_SOURCE_MISSING");
  }

  return { courses: STANDARD_COURSES, classes, teachers, students, accountTeacher, accountStudent };
}

export function courseIdForName(name: string): string {
  const normalized = normalizeCourseName(name);
  return STANDARD_COURSES.find((course) => course.name === normalized)?.id ?? `course-demo-${slugify(normalized)}`;
}

export function normalizeCourseName(value: string): string {
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/^LGS\s+/i, "")
    .trim();
  const key = cleaned
    .toLocaleLowerCase("tr-TR")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (key.includes("türkçe") || key.includes("turkce")) return "Türkçe";
  if (key.includes("matematik")) return "Matematik";
  if (key.includes("fen")) return "Fen Bilimleri";
  if (key.includes("inkılap") || key.includes("inkilap") || key.includes("sosyal")) return "T.C. İnkılap Tarihi ve Atatürkçülük";
  if (key.includes("din kültürü") || key.includes("din kulturu")) return "Din Kültürü ve Ahlak Bilgisi";
  if (key.includes("ingilizce") || key.includes("i̇ngilizce")) return "İngilizce";
  return cleaned;
}

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../ornek-veriler/${name}`, import.meta.url));
}

async function readWorkbookRows<Row extends Record<string, string | undefined>>(
  path: string,
  requiredHeaders: string[],
  optionalHeaders: string[] = [],
): Promise<Row[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("DEMO_FIXTURE_WORKSHEET_MISSING");

  const headerRowNumber = findHeaderRow(worksheet, requiredHeaders);
  const headerRow = worksheet.getRow(headerRowNumber);
  const headers = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => headers.set(normalizeHeader(cellText(cell.value)), colNumber));

  const rows: Row[] = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const item: Record<string, string> = {};
    for (const header of [...requiredHeaders, ...optionalHeaders]) {
      const colNumber = headers.get(normalizeHeader(header));
      item[header] = colNumber ? cellText(row.getCell(colNumber).value) : "";
    }
    if (Object.values(item).some(Boolean)) rows.push(item as Row);
  }
  return rows;
}

function findHeaderRow(worksheet: ExcelJS.Worksheet, requiredHeaders: string[]): number {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 10); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const headers = new Set<string>();
    row.eachCell((cell) => headers.add(normalizeHeader(cellText(cell.value))));
    if (requiredHeaders.every((header) => headers.has(normalizeHeader(header)))) {
      return rowNumber;
    }
  }
  throw new Error("DEMO_FIXTURE_HEADER_MISSING");
}

function readOptikStudentDirectory(): {
  students: { studentNo: string; firstName: string; lastName: string }[];
  scorableStudentNos: Set<string>;
} {
  const students = new Map<string, { studentNo: string; firstName: string; lastName: string }>();
  const validLineCountByStudentNo = new Map<string, number>();
  for (const fileName of examTextFiles) {
    const content = readFileSync(fixturePath(fileName), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const match = line.match(/^\s*(\d+)\s+(.+?)\s+\d{10,}/u);
      if (!match) continue;
      const studentNo = match[1] ?? "";
      const name = match[2]?.replace(/\s+/g, " ").trim() ?? "";
      const parsed = splitFullName(name);
      students.set(studentNo, { studentNo, ...parsed });
      if (line.length >= 171) {
        validLineCountByStudentNo.set(studentNo, (validLineCountByStudentNo.get(studentNo) ?? 0) + 1);
      }
    }
  }
  const scorableStudentNos = new Set(
    [...validLineCountByStudentNo.entries()]
      .filter(([, count]) => count === examTextFiles.length)
      .map(([studentNo]) => studentNo),
  );
  return {
    students: [...students.values()].sort((left, right) => Number(left.studentNo) - Number(right.studentNo)),
    scorableStudentNos,
  };
}

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length <= 1) return { firstName: name, lastName: "" };
  const lastName = parts.at(-1) ?? "";
  return { firstName: parts.slice(0, -1).join(" "), lastName };
}

function requiredClass(classByName: Map<string, DemoClass>, name: string): DemoClass {
  const item = classByName.get(name);
  if (!item) throw new Error("DEMO_FIXTURE_CLASS_MISSING");
  return item;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "tr"));
}

function uniqueBy<Value>(values: Value[], keyFor: (value: Value) => string): Value[] {
  const seen = new Set<string>();
  const result: Value[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function classId(name: string): string {
  return `class-demo-${slugify(name)}`;
}

function readClassLevel(name: string): string {
  return name.match(/\d+/)?.[0] ?? "8";
}

function readClassGradeLevelId(name: string): string | undefined {
  if (name.toLocaleLowerCase("tr-TR").includes("lgs")) return "grade-demo-lgs";
  const level = readClassLevel(name);
  return level ? `grade-demo-${level}` : undefined;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value) {
      const text = value.text;
      if (typeof text === "string") return text.trim();
      if (text && typeof text === "object" && "richText" in text && Array.isArray(text.richText)) {
        return text.richText.map((part) => part.text ?? "").join("").trim();
      }
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? "").join("").trim();
    }
    if ("result" in value) return cellText(value.result);
    return "";
  }
  return String(value).trim();
}

function normalizeHeader(value: string): string {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, "_").trim();
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
