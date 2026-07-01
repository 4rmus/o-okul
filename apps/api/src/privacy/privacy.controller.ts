import { Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import type { GuardianRecord, KvkkInventoryKind, KvkkInventoryRecord, StudentRecord, TeacherRecord } from "@o-okul/shared-types";
import { authUserStoreToken, type AuthUser, type AuthUserStore } from "../auth/auth-user-store.js";
import { AuthService, type SelfPurgeResult } from "../auth/auth.service.js";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";

@Controller("privacy")
@UseGuards(RolesGuard)
export class PrivacyController {
  constructor(
    private readonly auth: AuthService,
    private readonly school: SchoolService,
    private readonly students: StudentService,
    @Inject(authUserStoreToken) private readonly users: AuthUserStore,
  ) {}

  @Get("inventory")
  @Roles("TENANT_ADMIN", "ASSISTANT_ADMIN")
  @RequireCapability("privacy:manage")
  async inventory(): Promise<KvkkInventoryRecord[]> {
    const context = getRequestContext();
    const [students, teachers, guardians, users] = await Promise.all([
      this.students.list(context),
      this.school.listTeachers(context),
      this.school.listGuardians(context),
      this.users.listByTenant(context.tenantId ?? ""),
    ]);

    return [
      ...students.map((record, index) => studentInventoryRecord(record, index)),
      ...teachers.map((record, index) => teacherInventoryRecord(record, index)),
      ...guardians.map((record, index) => guardianInventoryRecord(record, index)),
      ...users.map((record, index) => userInventoryRecord(record, index)),
    ];
  }

  @Post("me/purge-pii")
  @HttpCode(200)
  @Roles("GUARDIAN")
  purgeMyPii(): Promise<SelfPurgeResult> {
    return this.auth.purgeCurrentUserPii(getRequestContext());
  }
}

function studentInventoryRecord(record: StudentRecord, index: number): KvkkInventoryRecord {
  const categories = purgedName(record, "Ogrenci") ? [] : ["Ad", "soyad"];
  return inventoryRecord("student", record.id, index, categories);
}

function teacherInventoryRecord(record: TeacherRecord, index: number): KvkkInventoryRecord {
  const categories = purgedName(record, "Ogretmen") ? [] : ["Ad", "soyad"];
  return inventoryRecord("teacher", record.id, index, categories);
}

function guardianInventoryRecord(record: GuardianRecord, index: number): KvkkInventoryRecord {
  const categories = purgedName(record, "Veli") ? [] : ["Ad", "soyad"];
  if (record.phone) categories.push("telefon");
  return inventoryRecord("guardian", record.id, index, categories);
}

function userInventoryRecord(record: AuthUser, index: number): KvkkInventoryRecord {
  const categories = purgedUser(record) ? [] : ["e-posta", "ad"];
  return inventoryRecord("user", `user-record-${index + 1}`, index, categories);
}

function inventoryRecord(kind: KvkkInventoryKind, id: string, index: number, piiCategories: string[]): KvkkInventoryRecord {
  return {
    displayRef: `${kindLabel(kind)} kaydı ${index + 1}`,
    id,
    kind,
    piiCategories,
    purgeAvailable: piiCategories.length > 0,
  };
}

function kindLabel(kind: KvkkInventoryKind) {
  if (kind === "student") return "Öğrenci";
  if (kind === "teacher") return "Öğretmen";
  if (kind === "user") return "Kullanıcı";
  return "Veli";
}

function purgedName(record: { firstName: string; lastName: string }, lastName: string) {
  return record.firstName === "Anonim" && record.lastName === lastName;
}

function purgedUser(record: AuthUser) {
  return record.name === "Anonim Kullanici" && record.email?.startsWith("purged-");
}
