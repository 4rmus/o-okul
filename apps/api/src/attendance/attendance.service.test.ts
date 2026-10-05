import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { GuardianAutoNotificationService, InMemoryGuardianNotifyQueueProducer } from "../guardian-notification/guardian-auto-notification.service.js";
import { InMemoryGuardianNotificationSettingsStore } from "../guardian-notification/guardian-notification-settings-store.js";
import { InMemoryAcademicCalendarStore } from "../school/academic-calendar-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryStudentEnrollmentStore } from "../student/student-enrollment-store.js";
import { InMemoryAttendanceStore } from "./attendance-store.js";
import { AttendanceService } from "./attendance.service.js";

describe("AttendanceService", () => {
  it("KV-8: bugün gelmedi işaretlenen öğrenci için veli bildirim işi kuyruğa girer; geçmiş gün ve PRESENT girmez", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-05T09:00:00+03:00"));
    try {
      const producer = new InMemoryGuardianNotifyQueueProducer();
      const notifications = new GuardianAutoNotificationService(new InMemoryGuardianNotificationSettingsStore(), producer);
      const service = new AttendanceService(
        new InMemoryAttendanceStore(),
        new InMemoryAcademicCalendarStore(),
        new InMemoryStudentStore(),
        new InMemoryStudentEnrollmentStore(),
        new InMemoryGuardianStudentStore(),
        new InMemoryTeacherAssignmentStore(),
        undefined,
        notifications,
      );
      const mark = (date: string, status: "ABSENT" | "PRESENT") =>
        service.upsertDaily(adminContext, { classId: "class-a", date, entries: [{ studentId: "student-a", status }] });

      await mark("2026-06-04", "ABSENT");
      expect(producer.jobs).toEqual([]);

      const { records } = await mark("2026-06-05", "ABSENT");
      await mark("2026-06-05", "PRESENT");
      await mark("2026-06-05", "ABSENT");

      // Every same-day ABSENT save enqueues; the worker's Attendance.notifiedAt claim sends only once.
      expect(producer.jobs).toHaveLength(2);
      expect(producer.jobs[0]).toMatchObject({
        queueName: "announcement-delivery",
        payload: { mode: "GUARDIAN_NOTIFY", kind: "ABSENCE", tenantId: "tenant-a", entityId: records[0]!.id },
      });
      expect(JSON.stringify(producer.jobs)).not.toMatch(/Ada|firstName|nationalId|phone/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takvim dışı devamsızlık tarihini servis katmanında reddeder", async () => {
    const service = new AttendanceService(
      new InMemoryAttendanceStore(),
      {} as never,
      new InMemoryStudentStore(),
      new InMemoryStudentEnrollmentStore(),
      new InMemoryGuardianStudentStore(),
      new InMemoryTeacherAssignmentStore(),
      undefined,
    );

    await expect(
      service.upsertDaily(adminContext, {
        classId: "class-a",
        date: "2026-02-29",
        entries: [{ studentId: "student-a", status: "ABSENT" }],
      }),
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
    await attendanceStore.upsertDaily([{ tenantId: "tenant-a", studentId: "student-a", date: "2026-06-06", status: "PRESENT" }]);
    const service = createService(attendanceStore, studentStore, enrollmentStore);

    await expect(service.list(adminContext, { classId: "class-a" })).resolves.toEqual([
      expect.objectContaining({ id: "attendance-a", classId: "class-a", date: "2026-06-03" }),
    ]);
    await expect(service.list(adminContext, { classId: "class-new" })).resolves.toEqual([
      expect.objectContaining({ classId: "class-new", date: "2026-06-06" }),
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

  it("geçmiş tarihte mezun öğrenciyi roster ve güncelleme kapsamında tutar", async () => {
    const studentStore = new InMemoryStudentStore();
    const calendarStore = new InMemoryAcademicCalendarStore();
    await studentStore.update("student-a", { status: "GRADUATED" });
    await calendarStore.updateTerm("term-2026-spring", { isActive: false });
    const service = createService(
      new InMemoryAttendanceStore(),
      studentStore,
      new InMemoryStudentEnrollmentStore(),
      new InMemoryTeacherAssignmentStore(),
      calendarStore,
    );

    await expect(service.getDailyRoster(adminContext, "class-a", "2026-06-10")).resolves.toMatchObject({
      students: [expect.objectContaining({ id: "student-a" })],
    });
    await expect(service.upsertDaily(adminContext, {
      classId: "class-a",
      date: "2026-06-10",
      entries: [{ studentId: "student-a", status: "EXCUSED" }],
    })).resolves.toMatchObject({
      records: [expect.objectContaining({ studentId: "student-a", termId: "term-2026-spring", status: "EXCUSED" })],
    });
  });

  it("bugün ve gelecek tarih rosterında yalnız aktif öğrenciyi tutar", async () => {
    const studentStore = new InMemoryStudentStore();
    await studentStore.update("student-a", { status: "PASSIVE" });
    const service = createService(new InMemoryAttendanceStore(), studentStore);
    const today = new Date().toISOString().slice(0, 10);

    await expect(service.getDailyRoster(adminContext, "class-a", today)).resolves.toMatchObject({ students: [] });
    await studentStore.update("student-a", { status: "ACTIVE" });
    await expect(service.getDailyRoster(adminContext, "class-a", today)).resolves.toMatchObject({
      students: [expect.objectContaining({ id: "student-a" })],
    });
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
    })).rejects.toThrow("ATTENDANCE_DAILY_FULL_ROSTER_REQUIRED");
  });

  it("günlük yoklamada sınıf listesinin tamamını zorunlu tutar", async () => {
    const studentStore = new InMemoryStudentStore();
    const enrollmentStore = new InMemoryStudentEnrollmentStore();
    const secondStudent = await studentStore.create({
      tenantId: "tenant-a",
      firstName: "Ece",
      lastName: "B",
      classId: "class-a",
      status: "ACTIVE",
    });
    await enrollmentStore.create({
      tenantId: "tenant-a",
      studentId: secondStudent.id,
      classId: "class-a",
      status: "ACTIVE",
      startsAt: "2026-01-01",
    });
    const service = createService(new InMemoryAttendanceStore(), studentStore, enrollmentStore);

    await expect(service.upsertDaily(adminContext, {
      classId: "class-a",
      date: "2026-06-10",
      entries: [{ studentId: "student-a", status: "PRESENT" }],
    })).rejects.toThrow("ATTENDANCE_DAILY_FULL_ROSTER_REQUIRED");
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
      attendanceByStudent: attendanceByStudent.mock.calls.length,
    }).toEqual({
      studentList: 1,
      enrollmentList: 1,
      assignmentList: 1,
      attendanceList: 1,
      attendanceUpsert: 1,
      studentFind: 0,
      attendanceByStudent: 0,
    });
  });
});

function createService(
  attendanceStore = new InMemoryAttendanceStore(),
  studentStore = new InMemoryStudentStore(),
  enrollmentStore = new InMemoryStudentEnrollmentStore(),
  assignmentStore = new InMemoryTeacherAssignmentStore(),
  calendarStore = new InMemoryAcademicCalendarStore(),
): AttendanceService {
  return new AttendanceService(
    attendanceStore,
    calendarStore,
    studentStore,
    enrollmentStore,
    new InMemoryGuardianStudentStore(),
    assignmentStore,
    undefined,
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
