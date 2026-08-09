import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { ClassRecord, GlobalSearchResultRecord, GlobalSearchType, GuardianRecord, PublicStudentRecord, TeacherRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { SchoolService } from "../school/school.service.js";
import { isAssignmentActive, shouldLimitToTeacherScope } from "../school/teacher-scope.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";

interface SearchQuery {
  limit?: string;
  q: string;
  types?: string;
}

interface CampusSearchScope {
  classIds: Set<string>;
  classes: ClassRecord[];
  studentIds: Set<string>;
  students: PublicStudentRecord[];
  teacherIds: Set<string>;
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
    const campusScope = await this.resolveCampusSearchScope(context);
    const results: GlobalSearchResultRecord[] = [];

    if (selectedTypes.includes("students")) {
      results.push(...await this.searchStudents(context, query.q, searchText, canSearchPii, campusScope));
    }
    if (selectedTypes.includes("teachers")) {
      results.push(...await this.searchTeachers(context, await this.teachers.listTeachers(context), searchText, campusScope));
    }
    if (selectedTypes.includes("guardians")) {
      results.push(...await this.searchGuardians(context, await this.guardians.listGuardians(context), searchText, query.q, canSearchPii, campusScope));
    }
    if (selectedTypes.includes("classes")) {
      results.push(...this.searchClasses(context, await this.listClassesForViewer(context, campusScope), searchText));
    }

    return dedupeResults(results).slice(0, limit);
  }

  private async searchStudents(
    context: RequestContext,
    rawQuery: string,
    searchText: string,
    canSearchPii: boolean,
    campusScope: CampusSearchScope | undefined,
  ): Promise<GlobalSearchResultRecord[]> {
    const [students, classes, nationalIdMatch] = await Promise.all([
      campusScope?.students ?? this.students.listForViewer(context),
      campusScope?.classes ?? this.school.listClasses(context),
      canSearchPii && !campusScope
        ? this.students.findByNationalIdForViewer(context, rawQuery)
        : Promise.resolve(undefined),
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

  private async searchTeachers(
    context: RequestContext,
    teachers: TeacherRecord[],
    searchText: string,
    campusScope: CampusSearchScope | undefined,
  ): Promise<GlobalSearchResultRecord[]> {
    let visibleTeachers = shouldLimitToTeacherScope(context)
      ? teachers.filter((teacher) => teacher.id === context.subjectId)
      : teachers;

    visibleTeachers = visibleTeachers.filter((teacher) =>
      matchesText([
        teacher.firstName,
        teacher.lastName,
        `${teacher.firstName} ${teacher.lastName}`,
        teacher.branch,
      ], searchText),
    );
    if (campusScope) {
      const campusVisibility = await Promise.all(visibleTeachers.map(async (teacher) => {
        if (campusScope.teacherIds.has(teacher.id)) return true;
        const assignments = await this.teachers.listTeacherAssignments(context, teacher.id);
        return assignments.some((assignment) =>
          isAssignmentActive(assignment) &&
          (Boolean(assignment.classId && campusScope.classIds.has(assignment.classId)) ||
            Boolean(assignment.studentId && campusScope.studentIds.has(assignment.studentId))),
        );
      }));
      visibleTeachers = visibleTeachers.filter((_teacher, index) => campusVisibility[index]);
    }

    return visibleTeachers
      .map((teacher) => ({
        href: institutionHref(context, `/kurum/ogretmenler/${encodeURIComponent(teacher.id)}`, "/ogretmen"),
        id: teacher.id,
        subtitle: teacher.branch,
        title: `${teacher.firstName} ${teacher.lastName}`,
        type: "teachers",
      }));
  }

  private async listClassesForViewer(
    context: RequestContext,
    campusScope: CampusSearchScope | undefined,
  ): Promise<ClassRecord[]> {
    const classes = campusScope?.classes ?? await this.school.listClasses(context);
    if (!shouldLimitToTeacherScope(context)) {
      return classes;
    }

    const [students, assignments] = await Promise.all([
      this.students.listForViewer(context),
      this.teachers.listTeacherAssignments(context, context.subjectId),
    ]);
    const visibleClassIds = new Set([
      ...students.map((student) => student.classId).filter((classId): classId is string => Boolean(classId)),
      ...assignments.filter(isAssignmentActive).map((assignment) => assignment.classId).filter((classId): classId is string => Boolean(classId)),
    ]);
    return classes.filter((schoolClass) => visibleClassIds.has(schoolClass.id));
  }

  private async searchGuardians(
    context: RequestContext,
    guardians: GuardianRecord[],
    searchText: string,
    rawQuery: string,
    canSearchPii: boolean,
    campusScope: CampusSearchScope | undefined,
  ): Promise<GlobalSearchResultRecord[]> {
    const queryDigits = digitsOnly(rawQuery);
    const visibleGuardians = await this.filterCampusScopedGuardians(context, guardians, campusScope);
    return visibleGuardians.filter((guardian) =>
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

  private async resolveCampusSearchScope(context: RequestContext): Promise<CampusSearchScope | undefined> {
    if (context.roles.includes("OPERATIONS_STAFF") && !context.campusScope) {
      throw new ForbiddenException("SEARCH_CAMPUS_SCOPE_MISSING");
    }
    if (context.campusScope?.scopeMode !== "CAMPUSES") return undefined;

    const campusIds = new Set(context.campusScope.campusIds);
    const [classes, students] = await Promise.all([
      this.school.listClasses(context),
      this.students.listForViewer(context),
    ]);
    const visibleClasses = classes.filter((schoolClass) =>
      Boolean(schoolClass.campusId && campusIds.has(schoolClass.campusId)),
    );
    return {
      classIds: new Set(visibleClasses.map((schoolClass) => schoolClass.id)),
      classes: visibleClasses,
      studentIds: new Set(students.map((student) => student.id)),
      students,
      teacherIds: new Set(
        students.map((student) => student.responsibleTeacherId).filter((id): id is string => Boolean(id)),
      ),
    };
  }

  private async filterCampusScopedGuardians(
    context: RequestContext,
    guardians: GuardianRecord[],
    campusScope: CampusSearchScope | undefined,
  ): Promise<GuardianRecord[]> {
    if (!campusScope) return guardians;
    const visibleGuardianIds = await this.guardians.listGuardianIdsForStudents(context, [...campusScope.studentIds]);
    return guardians.filter((guardian) => visibleGuardianIds.has(guardian.id));
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
