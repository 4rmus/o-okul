import { BadRequestException, Injectable } from "@nestjs/common";
import type { ClassRecord, GlobalSearchResultRecord, GlobalSearchType, GuardianRecord, PublicStudentRecord, TeacherRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";

interface SearchQuery {
  limit?: string;
  q: string;
  types?: string;
}

const defaultLimit = 10;
const maxLimit = 20;
const minQueryLength = 2;
const searchTypes: GlobalSearchType[] = ["students", "teachers", "guardians", "classes"];

@Injectable()
export class SearchService {
  constructor(
    private readonly students: StudentService,
    private readonly school: SchoolService,
    private readonly teachers: TeacherService,
    private readonly guardians: GuardianService,
  ) {}

  async search(context: RequestContext, query: SearchQuery): Promise<GlobalSearchResultRecord[]> {
    const searchText = normalizeSearchText(query.q);
    if (searchText.length < minQueryLength) {
      throw new BadRequestException("SEARCH_QUERY_TOO_SHORT");
    }

    const selectedTypes = parseTypes(query.types);
    const limit = parseLimit(query.limit);
    const canSearchPii = hasCapability(context, "student:manage");
    const results: GlobalSearchResultRecord[] = [];

    if (selectedTypes.includes("students")) {
      results.push(...await this.searchStudents(context, query.q, searchText, canSearchPii));
    }
    if (selectedTypes.includes("teachers")) {
      results.push(...this.searchTeachers(context, await this.teachers.listTeachers(context), searchText));
    }
    if (selectedTypes.includes("guardians")) {
      results.push(...this.searchGuardians(context, await this.guardians.listGuardians(context), searchText, query.q, canSearchPii));
    }
    if (selectedTypes.includes("classes")) {
      results.push(...this.searchClasses(context, await this.school.listClasses(context), searchText));
    }

    return dedupeResults(results).slice(0, limit);
  }

  private async searchStudents(
    context: RequestContext,
    rawQuery: string,
    searchText: string,
    canSearchPii: boolean,
  ): Promise<GlobalSearchResultRecord[]> {
    const [students, classes, nationalIdMatch] = await Promise.all([
      this.students.listForViewer(context),
      this.school.listClasses(context),
      canSearchPii ? this.students.findByNationalIdForViewer(context, rawQuery) : Promise.resolve(undefined),
    ]);
    const classNameById = new Map(classes.map((schoolClass) => [schoolClass.id, schoolClass.name]));
    const matches = students.filter((student) =>
      matchesText([
        student.firstName,
        student.lastName,
        `${student.firstName} ${student.lastName}`,
        student.studentNo,
        student.classId ? classNameById.get(student.classId) : undefined,
      ], searchText),
    );

    if (nationalIdMatch && !matches.some((student) => student.id === nationalIdMatch.id)) {
      matches.unshift(nationalIdMatch);
    }

    return matches.map((student) => toStudentResult(context, student, classNameById));
  }

  private searchTeachers(context: RequestContext, teachers: TeacherRecord[], searchText: string): GlobalSearchResultRecord[] {
    return teachers
      .filter((teacher) =>
        matchesText([
          teacher.firstName,
          teacher.lastName,
          `${teacher.firstName} ${teacher.lastName}`,
          teacher.branch,
        ], searchText),
      )
      .map((teacher) => ({
        href: institutionHref(context, `/kurum/ogretmenler/${encodeURIComponent(teacher.id)}`, "/ogretmen"),
        id: teacher.id,
        subtitle: teacher.branch,
        title: `${teacher.firstName} ${teacher.lastName}`,
        type: "teachers",
      }));
  }

  private searchGuardians(
    context: RequestContext,
    guardians: GuardianRecord[],
    searchText: string,
    rawQuery: string,
    canSearchPii: boolean,
  ): GlobalSearchResultRecord[] {
    const queryDigits = digitsOnly(rawQuery);
    return guardians
      .filter((guardian) =>
        matchesText([
          guardian.firstName,
          guardian.lastName,
          `${guardian.firstName} ${guardian.lastName}`,
        ], searchText) ||
        (canSearchPii && queryDigits.length >= 4 && Boolean(guardian.phone) && digitsOnly(guardian.phone ?? "").includes(queryDigits)),
      )
      .map((guardian) => ({
        href: institutionHref(context, `/kurum/veliler/${encodeURIComponent(guardian.id)}`, "/ogretmen/ogrenci-takibi"),
        id: guardian.id,
        subtitle: "Veli",
        title: `${guardian.firstName} ${guardian.lastName}`,
        type: "guardians",
      }));
  }

  private searchClasses(context: RequestContext, classes: ClassRecord[], searchText: string): GlobalSearchResultRecord[] {
    return classes
      .filter((schoolClass) =>
        matchesText([
          schoolClass.name,
          schoolClass.section,
        ], searchText),
      )
      .map((schoolClass) => ({
        href: institutionHref(context, `/kurum/siniflar/${encodeURIComponent(schoolClass.id)}`, "/ogretmen/ders-akisi"),
        id: schoolClass.id,
        title: schoolClass.name,
        type: "classes",
      }));
  }
}

function parseTypes(value: string | undefined): GlobalSearchType[] {
  if (!value) return searchTypes;
  const parsed = value.split(",").map((type) => type.trim()).filter(Boolean);
  if (parsed.length === 0) return searchTypes;
  if (!parsed.every((type): type is GlobalSearchType => searchTypes.includes(type as GlobalSearchType))) {
    throw new BadRequestException("SEARCH_TYPES_INVALID");
  }
  return parsed;
}

function parseLimit(value: string | undefined): number {
  if (!value) return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException("SEARCH_LIMIT_INVALID");
  }
  return Math.min(parsed, maxLimit);
}

function toStudentResult(
  context: RequestContext,
  student: PublicStudentRecord,
  classNameById: ReadonlyMap<string, string>,
): GlobalSearchResultRecord {
  const className = student.classId ? classNameById.get(student.classId) : undefined;
  return {
    href: institutionHref(context, `/kurum/ogrenciler/${encodeURIComponent(student.id)}`, `/ogretmen/ogrenci-takibi?studentId=${encodeURIComponent(student.id)}`),
    id: student.id,
    subtitle: [student.studentNo ? `No ${student.studentNo}` : undefined, className].filter(Boolean).join(" · ") || undefined,
    title: `${student.firstName} ${student.lastName}`,
    type: "students",
  };
}

function institutionHref(context: RequestContext, institutionPath: string, teacherPath: string): string {
  return isTeacherOnlyContext(context) ? teacherPath : institutionPath;
}

function isTeacherOnlyContext(context: RequestContext): boolean {
  return context.roles.includes("TEACHER") &&
    context.subjectType === "TEACHER" &&
    !context.roles.includes("TENANT_ADMIN") &&
    !context.roles.includes("ASSISTANT_ADMIN");
}

function dedupeResults(results: GlobalSearchResultRecord[]): GlobalSearchResultRecord[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.type}:${result.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesText(values: Array<string | undefined>, searchText: string): boolean {
  return values.some((value) => value && normalizeSearchText(value).includes(searchText));
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}
