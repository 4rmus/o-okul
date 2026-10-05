import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { testLoginBody } from "../test-auth.js";
import { guardianNotifyQueueProducerToken, type InMemoryGuardianNotifyQueueProducer } from "./guardian-auto-notification.service.js";

describe("KV-8 automatic guardian notifications API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let producer: InMemoryGuardianNotifyQueueProducer;
  let admin: string;
  let teacher: string;
  let guardian: string;
  let tenantB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    server = app.getHttpServer() as Parameters<typeof request>[0];
    producer = moduleRef.get(guardianNotifyQueueProducerToken);
    admin = await login("admin-a@example.test");
    teacher = await login("teacher-a@example.test");
    guardian = await login("guardian-a@example.test");
    tenantB = await login("admin-b@example.test");
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const response = await request(server).post("/auth/login").send(testLoginBody(email)).expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  it("kurum ayarı varsayılan açık + eşik 10; yönetici değiştirir, tenant'lar ayrı, öğretmen ve veli erişemez", async () => {
    const path = "/me/tenant/guardian-notification-settings";
    await request(server).get(path).set("Authorization", `Bearer ${admin}`).expect(200, {
      absenceEnabled: true,
      paymentDueEnabled: true,
      gradePublishEnabled: true,
      absenceThreshold: 10,
    });

    await request(server)
      .patch(path)
      .set("Authorization", `Bearer ${admin}`)
      .send({ paymentDueEnabled: false, absenceThreshold: 12 })
      .expect(200, { absenceEnabled: true, paymentDueEnabled: false, gradePublishEnabled: true, absenceThreshold: 12 });
    await request(server).patch(path).set("Authorization", `Bearer ${admin}`).send({ absenceThreshold: 0 }).expect(422);
    await request(server).patch(path).set("Authorization", `Bearer ${admin}`).send({ smsEnabled: true }).expect(422);

    await request(server).get(path).set("Authorization", `Bearer ${tenantB}`).expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ paymentDueEnabled: true, absenceThreshold: 10 }));
    await request(server).get(path).set("Authorization", `Bearer ${teacher}`).expect(403);
    await request(server).patch(path).set("Authorization", `Bearer ${guardian}`).send({ absenceEnabled: false }).expect(403);
  });

  it("veli otomatik bildirimleri kendi tercihinden kapatır", async () => {
    const path = "/me/guardian/students/student-a/notification-preferences";
    await request(server).get(path).set("Authorization", `Bearer ${guardian}`).expect(200)
      .expect(({ body }) => expect(body.canReceiveAutoNotifications ?? true).toBe(true));
    await request(server).patch(path).set("Authorization", `Bearer ${guardian}`).send({ canReceiveAutoNotifications: false }).expect(200)
      .expect(({ body }) => expect(body.canReceiveAutoNotifications).toBe(false));
    await request(server).get(path).set("Authorization", `Bearer ${guardian}`).expect(200)
      .expect(({ body }) => expect(body.canReceiveAutoNotifications).toBe(false));
    // Staff permission writes do not take the guardian's own preference.
    await request(server)
      .patch("/guardians/guardian-a/students/student-a")
      .set("Authorization", `Bearer ${admin}`)
      .send({ canReceiveAutoNotifications: true })
      .expect(422);
  });

  it("not yayını gradebook'tan tek iş kuyruğa koyar; düzeltilen yayın yeni iş üretir, yalnız id taşır", async () => {
    const created = await request(server)
      .post("/grade-assessments")
      .set("Authorization", `Bearer ${admin}`)
      .send({ classId: "class-a", courseId: "course-math", termId: "term-2026-spring", kind: "WRITTEN", title: "KV-8 Yazılı", heldOn: "2026-03-11" })
      .expect(201);
    const id = (created.body as { id: string }).id;
    const publish = async (score: number, key: string) => {
      await request(server).put(`/grade-assessments/${id}/entries`).set("Authorization", `Bearer ${teacher}`)
        .send({ entries: [{ studentId: "student-a", score, absent: false }] }).expect(200);
      await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`).set("Idempotency-Key", key).expect(201);
    };
    const before = producer.jobs.length;

    await publish(70, "kv8-grade-publish-a");
    await request(server).post(`/grade-assessments/${id}/publish`).set("Authorization", `Bearer ${admin}`).set("Idempotency-Key", "kv8-grade-publish-a").expect(201);
    await publish(75, "kv8-grade-publish-b");

    const jobs = producer.jobs.slice(before);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.payload).toMatchObject({ mode: "GUARDIAN_NOTIFY", kind: "GRADE_PUBLISHED", tenantId: "tenant-a", entityId: id });
      // Ids only (the Bull producer adds lifecycleVersion at enqueue): no name, TC, phone or score.
      expect(Object.keys(job.payload).sort()).toEqual(["contentHash", "entityId", "kind", "mode", "tenantId", "userId"]);
    }
  });
});
