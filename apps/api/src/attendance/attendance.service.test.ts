import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryCourseStore } from "../school/course-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryStudentEnrollmentStore } from "../student/student-enrollment-store.js";
import { InMemoryAttendanceStore } from "./attendance-store.js";
import { AttendanceService } from "./attendance.service.js";

describe("AttendanceService", () => {
  it("devamsizlik esigi ilk kez asilinca veli duyurusu ve audit kaydi uretir", async () => {
    const announcements: unknown[] = [];
    const auditRecords: unknown[] = [];
    const service = new AttendanceService(
      new InMemoryAttendanceStore(),
      {} as never,
      {} as never,
      new InMemoryStudentStore(),
      new InMemoryStudentEnrollmentStore(),
      new InMemoryGuardianStudentStore(),
      new InMemoryTeacherAssignmentStore(),
      {
        create: async (_context: RequestContext, input: unknown) => {
          announcements.push(input);
          return { id: "announcement-threshold" };
        },
      } as never,
      {
        record: async (input: unknown) => {
          auditRecords.push(input);
        },
      } as never,
    );

    await service.create(adminContext, { studentId: "student-a", date: "2026-06-04", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-05", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-06", status: "ABSENT" });
    await service.create(adminContext, { studentId: "student-a", date: "2026-06-07", status: "ABSENT" });

    expect(announcements).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        audience: "GUARDIANS",
        classId: "class-a",
        title: "Devamsızlık eşiği uyarısı",
      }),
    ]);
    expect(auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "attendance.threshold_warned",
        entityType: "Attendance",
        entityId: "student-a",
        diff: expect.objectContaining({
          studentId: "student-a",
          previousAbsenceCount: 4,
          currentAbsenceCount: 5,
          threshold: 5,
          announcementId: "announcement-threshold",
        }),
      }),
    ]));
  });

  it("takvim dışı devamsızlık tarihini servis katmanında reddeder", async () => {
    const service = new AttendanceService(
      new InMemoryAttendanceStore(),
      {} as never,
      {} as never,
      new InMemoryStudentStore(),
      new InMemoryStudentEnrollmentStore(),
      new InMemoryGuardianStudentStore(),
      new InMemoryTeacherAssignmentStore(),
      {} as never,
    );

    await expect(
      service.create(adminContext, { studentId: "student-a", date: "2026-02-29", status: "ABSENT" }),
    ).rejects.toThrow("ATTENDANCE_DATE_INVALID");
  });

  it("sinif filtresinde transferin gecmis yoklama kaydini yeni sinifa tasimasini engeller", async () => {
    const attendanceStore = new InMemoryAttendanceStore();
    const studentStore = new InMemoryStudentStore();
    const enrollmentStore = new InMemoryStudentEnrollmentStore();
    await enrollmentStore.closeActiveForStudent("student-a", "2026-06-04");
    await enrollmentStore.create({
      tenantId: "tenant-a",
      studentId: "student-a",
      classId: "class-new",
      status: "ACTIVE",
      startsAt: "2026-06-05",
    });
    await studentStore.update("student-a", { classId: "class-new" });
    await attendanceStore.create({ tenantId: "tenant-a", studentId: "student-a", date: "2026-06-06", status: "PRESENT" });
    const service = createService(attendanceStore, studentStore, enrollmentStore);

    await expect(service.list(adminContext, { classId: "class-a" })).resolves.toEqual([
      expect.objectContaining({ id: "attendance-a", date: "2026-06-03" }),
    ]);
    await expect(service.list(adminContext, { classId: "class-new" })).resolves.toEqual([
      expect.objectContaining({ date: "2026-06-06" }),
    ]);
    await expect(service.getDailyRoster(adminContext, "class-a", "2026-06-03")).resolves.toEqual({
      classId: "class-a",
      date: "2026-06-03",
      students: [expect.objectContaining({ id: "student-a", classId: "class-a", firstName: "Ada", lastName: "A" })],
      records: [expect.objectContaining({ id: "attendance-a", studentId: "student-a", status: "ABSENT" })],
      summary: { total: 1, present: 0, absent: 1, late: 0, excused: 0, unmarked: 0 },
    });
    await expect(service.getDailyRoster(adminContext, "class-new", "2026-06-06")).resolves.toEqual({
      classId: "class-new",
      date: "2026-06-06",
      students: [expect.objectContaining({ id: "student-a", classId: "class-new" })],
      records: [expect.objectContaining({ studentId: "student-a", status: "PRESENT" })],
      summary: { total: 1, present: 1, absent: 0, late: 0, excused: 0, unmarked: 0 },
    });
  });

  it("günlük sınıf listesini atama tarihinde yetkilendirir", async () => {
    const assignmentStore = new InMemoryTeacherAssignmentStore();
    await assignmentStore.update("teacher-assignment-class-a", { endsAt: "2026-06-02" });
    const service = createService(
      new InMemoryAttendanceStore(),
      new InMemoryStudentStore(),
      new InMemoryStudentEnrollmentStore(),
      assignmentStore,
    );

    await expect(service.getDailyRoster(teacherContext, "class-a", "2026-06-03"))
      .rejects.toThrow("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
  });

  it("günlük sınıf listesini N+1 oluşturmadan getirir", async () => {
    const attendanceStore = new InMemoryAttendanceStore();
    const studentStore = new InMemoryStudentStore();
    const enrollmentStore = new InMemoryStudentEnrollmentStore();
    const assignmentStore = new InMemoryTeacherAssignmentStore();
    const studentList = vi.spyOn(studentStore, "list");
    const enrollmentList = vi.spyOn(enrollmentStore, "listByStudents");
    const assignmentList = vi.spyOn(assignmentStore, "listByTeacher");
    const attendanceList = vi.spyOn(attendanceStore, "listByStudentsDate");
    const studentFind = vi.spyOn(studentStore, "findById");
    const attendanceByStudent = vi.spyOn(attendanceStore, "listByStudent");
    const service = createService(attendanceStore, studentStore, enrollmentStore, assignmentStore);

    await expect(service.getDailyRoster(teacherContext, "class-a", "2026-06-03")).resolves.toMatchObject({
      students: [expect.objectContaining({ id: "student-a" })],
      records: [expect.objectContaining({ id: "attendance-a" })],
    });

    expect({
      studentList: studentList.mock.calls.length,
      enrollmentList: enrollmentList.mock.calls.length,
      assignmentList: assignmentList.mock.calls.length,
      attendanceList: attendanceList.mock.calls.length,
      studentFind: studentFind.mock.calls.length,
      attendanceByStudent: attendanceByStudent.mock.calls.length,
    }).toEqual({
      studentList: 1,
      enrollmentList: 1,
      assignmentList: 1,
      attendanceList: 1,
      studentFind: 0,
      attendanceByStudent: 0,
    });
  });

  it("gunluk yoklamada tarih-sinif enrollment uyusmazligini reddeder", async () => {
    const service = createService();
    await expect(service.upsertDaily(adminContext, {
      classId: "class-new",
      date: "2026-06-10",
      entries: [{ studentId: "student-a", status: "PRESENT" }],
    })).rejects.toThrow("ATTENDANCE_DAILY_STUDENT_NOT_ACTIVE_CLASS_MEMBER");
  });

  it("200 kisilik gunluk akis icin store okumalarini toplu tutar", async () => {
    const attendanceStore = new InMemoryAttendanceStore();
    const studentStore = new InMemoryStudentStore();
    const enrollmentStore = new InMemoryStudentEnrollmentStore();
    const assignmentStore = new InMemoryTeacherAssignmentStore();
    const studentList = vi.spyOn(studentStore, "list");
    const enrollmentList = vi.spyOn(enrollmentStore, "listByStudents");
    const assignmentList = vi.spyOn(assignmentStore, "listByTeacher");
    const attendanceList = vi.spyOn(attendanceStore, "list");
    const attendanceUpsert = vi.spyOn(attendanceStore, "upsertDaily");
    const studentFind = vi.spyOn(studentStore, "findById");
    const attendanceFind = vi.spyOn(attendanceStore, "findByStudentDate");
    const attendanceByStudent = vi.spyOn(attendanceStore, "listByStudent");
    const service = createService(attendanceStore, studentStore, enrollmentStore, assignmentStore);

    await service.upsertDaily(teacherContext, {
      classId: "class-a",
      date: "2026-06-10",
      entries: [{ studentId: "student-a", status: "PRESENT" }],
    });

    expect({
      studentList: studentList.mock.calls.length,
      enrollmentList: enrollmentList.mock.calls.length,
      assignmentList: assignmentList.mock.calls.length,
      attendanceList: attendanceList.mock.calls.length,
      attendanceUpsert: attendanceUpsert.mock.calls.length,
      studentFind: studentFind.mock.calls.length,
      attendanceFind: attendanceFind.mock.calls.length,
      attendanceByStudent: attendanceByStudent.mock.calls.length,
    }).toEqual({
      studentList: 1,
      enrollmentList: 1,
      assignmentList: 1,
      attendanceList: 1,
      attendanceUpsert: 1,
      studentFind: 0,
      attendanceFind: 0,
      attendanceByStudent: 0,
    });
  });
});

function createService(
  attendanceStore = new InMemoryAttendanceStore(),
  studentStore = new InMemoryStudentStore(),
  enrollmentStore = new InMemoryStudentEnrollmentStore(),
  assignmentStore = new InMemoryTeacherAssignmentStore(),
): AttendanceService {
  return new AttendanceService(
    attendanceStore,
    new InMemoryAcademicCalendarStore(),
    new InMemoryCourseStore(),
    studentStore,
    enrollmentStore,
    new InMemoryGuardianStudentStore(),
    assignmentStore,
    {} as never,
  );
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const teacherContext: RequestContext = {
  userId: "teacher-tenant-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};
