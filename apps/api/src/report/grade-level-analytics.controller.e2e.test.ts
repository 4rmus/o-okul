import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { resetInMemoryAuthUsers } from "../auth/auth-user-store.js";
import {
  campusOperationsStaffEmail,
  registerExamOperationsStaff,
  tenantWideOperationsStaffEmail,
} from "../exam/exam-operations-staff.test-support.js";
import { testLoginBody } from "../test-auth.js";
import { createGradeLevelAnalyticsFixtures } from "./grade-level-analytics.test-support.js";
import { InMemoryReportSnapshotStore, reportSnapshotStoreToken } from "./report-snapshot-store.js";

describe("GET /reports/grade-level-analytics (DEC-20261102-08 G3)", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    resetInMemoryAuthUsers();
    registerExamOperationsStaff();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(reportSnapshotStoreToken)
      .useValue(new InMemoryReportSnapshotStore(createGradeLevelAnalyticsFixtures()))
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
    resetInMemoryAuthUsers();
  });

  it("tenant geneli yönetici seviye analitiğini Başarı % serileri ve yenilenmeli listesiyle okur", async () => {
    const admin = await login("admin-a@example.test");

    const response = await request(server)
      .get("/reports/grade-level-analytics?gradeLevelId=grade-8")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(response.body.tenantId).toBe("tenant-a");
    expect(response.body.gradeLevelId).toBe("grade-8");
    expect(response.body.series.map((series: { examType?: string }) => series.examType)).toEqual(["LGS", "TYT"]);
    expect(response.body.series[0].points.map((point: { successRate?: number }) => point.successRate)).toEqual([61.5, 64.25]);
    expect(response.body.needsRefresh.map((item: { snapshotId: string }) => item.snapshotId)).toEqual(["level-lgs-3-stale"]);
    expect(response.body.withoutLevelReport.map((item: { examId: string }) => item.examId)).toEqual(["exam-lgs-no-level"]);
    // The projection never carries student rows or names out of the snapshot.
    expect(JSON.stringify(response.body)).not.toContain("Ada A");
    expect(JSON.stringify(response.body)).not.toContain("student-a");
  });

  it("tenant geneli OPERATIONS_STAFF okur; kampüs kapsamlı personel 403 alır", async () => {
    const ops = await login(tenantWideOperationsStaffEmail);
    const campus = await login(campusOperationsStaffEmail);
    const path = "/reports/grade-level-analytics?gradeLevelId=grade-8&examType=LGS";

    await request(server).get(path).set("Authorization", `Bearer ${ops.accessToken}`).expect(200);
    const rejected = await request(server).get(path).set("Authorization", `Bearer ${campus.accessToken}`).expect(403);
    expect(rejected.body.error.code).toBe("REPORT_CAMPUS_SCOPE_FORBIDDEN");
  });

  it("academic:manage yetkisi olmayan öğretmen 403 alır", async () => {
    const teacher = await login("teacher-a@example.test");

    await request(server)
      .get("/reports/grade-level-analytics?gradeLevelId=grade-8")
      .set("Authorization", `Bearer ${teacher.accessToken}`)
      .expect(403);
  });

  it("seviye parametresi olmadan veya bilinmeyen parametreyle doğrulama hatası verir", async () => {
    const admin = await login("admin-a@example.test");

    for (const path of ["/reports/grade-level-analytics", "/reports/grade-level-analytics?gradeLevelId=grade-8&campusId=campus-main"]) {
      const response = await request(server).get(path).set("Authorization", `Bearer ${admin.accessToken}`).expect(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    }
  });

  async function login(email: string) {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return response.body as { accessToken: string };
  }
});
