import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

export const DEMO_TENANT_ID = "tenant-demo";
export const DEMO_CLASS_START_DATE = "2026-06-01";
export const DEMO_TEACHER_USER_ID = "user-demo-teacher";
export const DEMO_STUDENT_USER_ID = "user-demo-student";
export const DEMO_GUARDIAN_USER_ID = "user-demo-guardian";

const studentWorkbookPath = fixturePath("ogrenci-aktarim-sablonu.xlsx");
const teacherWorkbookPath = fixturePath("ogretmen-aktarim-sablonu.xlsx");
const examTextFiles = ["iSEM .txt", "MUBA.txt", "3D.txt"];

export type DemoClass = {
  id: string;
  name: string;
  level: string;
};

export type DemoTeacher = {
  id: string;
  firstName: string;
  lastName: string;
  branch: string;
  assignedClassName: string;
  assignedClassId: string;
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
  email: string;
  telefon: string;
  brans: string;
  atanacak_sinif: string;
  not: string;
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
  const teacherRows = await readWorkbookRows<TeacherWorkbookRow>(teacherWorkbookPath, [
    "ad",
    "soyad",
    "email",
    "telefon",
    "brans",
    "atanacak_sinif",
    "not",
  ]);
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
    ...teacherRows.map((teacher) => teacher.atanacak_sinif),
  ]);
  const classes = classNames.map((name): DemoClass => ({
    id: classId(name),
    name,
    level: readClassLevel(name),
  }));
  const classByName = new Map(classes.map((item) => [item.name, item]));

  const teachers = teacherRows.map((teacher, index): DemoTeacher => {
    const assignedClass = requiredClass(classByName, teacher.atanacak_sinif);
    return {
      id: index === 0 ? "teacher-demo-main" : `teacher-demo-${slugify(`${teacher.email || teacher.ad}-${index + 1}`)}`,
      firstName: teacher.ad,
      lastName: teacher.soyad,
      branch: teacher.brans,
      assignedClassName: assignedClass.name,
      assignedClassId: assignedClass.id,
    };
  });
  const teacherByClassName = new Map<string, DemoTeacher>();
  for (const teacher of teachers) {
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

  return { classes, teachers, students, accountTeacher, accountStudent };
}

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../../ornek-veriler/${name}`, import.meta.url));
}

async function readWorkbookRows<Row extends Record<string, string>>(path: string, requiredHeaders: string[]): Promise<Row[]> {
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
    for (const header of requiredHeaders) {
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

function classId(name: string): string {
  return `class-demo-${slugify(name)}`;
}

function readClassLevel(name: string): string {
  return name.match(/\d+/)?.[0] ?? "8";
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
