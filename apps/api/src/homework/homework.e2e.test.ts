import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { type UploadAvScanInput, uploadAvScannerToken } from "../upload/upload-av-scanner.js";
import {
  homeworkMaterialFileStorageToken,
  type StoreHomeworkMaterialFileInput,
} from "./homework-material-file-storage.js";

describe("Homework API", () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  let tenantAAccessToken: string;
  let teacherAAccessToken: string;
  let scanInputs: UploadAvScanInput[];
  let storageInputs: StoreHomeworkMaterialFileInput[];

  beforeAll(async () => {
    scanInputs = [];
    storageInputs = [];
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(uploadAvScannerToken)
      .useValue({
        async scan(input: UploadAvScanInput) {
          scanInputs.push(input);
        },
      })
      .overrideProvider(homeworkMaterialFileStorageToken)
      .useValue({
        async put(input: StoreHomeworkMaterialFileInput) {
          storageInputs.push(input);
          return {
            storageKey: `homework-material-files/${input.tenantId}/${input.materialId}/${input.sha256}/${input.fileName}`,
          };
        },
        async get() {
          throw new Error("NOT_USED");
        },
        async createSignedDownloadUrl(storageKey: string) {
          return {
            url: `https://storage.example.test/${encodeURIComponent(storageKey)}`,
            expiresAt: "2026-06-13T12:05:00.000Z",
            expiresInSeconds: 300,
          };
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Parameters<typeof request>[0];

    const login = await request(server)
      .post("/auth/login")
      .send({ email: "admin-a@example.test", password: "password" })
      .expect(200);
    tenantAAccessToken = (login.body as { accessToken: string }).accessToken;

    const teacherLogin = await request(server)
      .post("/auth/login")
      .send({ email: "teacher-a@example.test", password: "password" })
      .expect(200);
    teacherAAccessToken = (teacherLogin.body as { accessToken: string }).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant A sadece kendi ödevlerini listeler", async () => {
    const response = await request(server)
      .get("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "homework-a",
        tenantId: "tenant-a",
        classId: "class-a",
        title: "Kesirler",
        description: "1-20 arası sorular",
        dueAt: "2026-06-05T12:00:00.000Z",
      },
    ]);
  });

  it("ödevleri arama, sıralama ve sayfalama sorgusuyla listeler", async () => {
    const response = await request(server)
      .get("/homework?q=kesir&sort=title&page=1&limit=1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "homework-a",
        title: "Kesirler",
      }),
    ]);
  });

  it("tenant A sadece kendi ödev materyallerini listeler", async () => {
    const response = await request(server)
      .get("/homework/materials")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "material-a",
        tenantId: "tenant-a",
        title: "Kesirler Çalışma Kağıdı",
        description: "Kesirlerle dört işlem alıştırmaları",
      },
    ]);
  });

  it("ödev materyallerini arama, sıralama ve sayfalama sorgusuyla listeler", async () => {
    const response = await request(server)
      .get("/homework/materials?q=kesirler&sort=-title&page=1&limit=1")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(response.body).toEqual([
      expect.objectContaining({
        id: "material-a",
        title: "Kesirler Çalışma Kağıdı",
      }),
    ]);
  });

  it("materyal havuzu CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/homework/materials")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        title: "Problemler Föyü",
        description: "Yaş ve işçi problemleri",
      })
      .expect(201);

    const materialId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      title: "Problemler Föyü",
      description: "Yaş ve işçi problemleri",
    });

    await request(server)
      .get(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Problemler Föyü");
      });

    await request(server)
      .patch(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Problemler Tekrar Föyü" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Problemler Tekrar Föyü");
      });

    await request(server)
      .delete(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(204);
    await request(server)
      .get(`/homework/materials/${materialId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);
  });

  it("materyal dosyasını tenant içinde ekler ve listeler", async () => {
    const list = await request(server)
      .get("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(list.body).toEqual([
      {
        id: "material-file-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        uploadedById: "user-tenant-a",
        fileName: "kesirler.txt",
        contentType: "text/plain",
        byteSize: 11,
        sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
        createdAt: "2026-06-08T09:10:00.000Z",
      },
    ]);

    const downloaded = await request(server)
      .get("/homework/materials/material-a/files/material-file-a/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(downloaded.body).toEqual({
      fileName: "kesirler.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
      downloadMode: "inline",
      fileBase64: "aGVsbG8gd29ybGQ=",
    });

    const previousScanCount = scanInputs.length;
    const previousStorageCount = storageInputs.length;
    const created = await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "../kesirler-ek.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      materialId: "material-a",
      uploadedById: "user-tenant-a",
      fileName: "kesirler-ek.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(created.body.contentBase64).toBeUndefined();
    expect(created.body.storageKey).toBeUndefined();
    const createdDownload = await request(server)
      .get(`/homework/materials/material-a/files/${created.body.id}/download`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);
    expect(createdDownload.body).toMatchObject({
      fileName: "kesirler-ek.txt",
      contentType: "text/plain",
      byteSize: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      downloadMode: "signed-url",
      downloadUrlExpiresAt: "2026-06-13T12:05:00.000Z",
      downloadUrlExpiresInSeconds: 300,
    });
    expect(createdDownload.body.downloadUrl).toContain("homework-material-files%2Ftenant-a%2Fmaterial-a");
    expect(createdDownload.body.fileBase64).toBeUndefined();
    expect(scanInputs.slice(previousScanCount)).toEqual([
      expect.objectContaining({
        surface: "homework_material_file",
        tenantId: "tenant-a",
        fileName: "kesirler-ek.txt",
        contentType: "text/plain",
        sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      }),
    ]);
    expect(storageInputs.slice(previousStorageCount)).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        materialId: "material-a",
        fileName: "kesirler-ek.txt",
        contentType: "text/plain",
        sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      }),
    ]);
  });

  it("materyal dosyası yüklemeyi Idempotency-Key ile tekilleştirir", async () => {
    const key = "homework-material-file-idempotency-a";
    const body = {
      fileName: "idempotent-materyal.txt",
      contentType: "text/plain",
      fileBase64: Buffer.from("idempotent homework file").toString("base64"),
    };
    const previousScanCount = scanInputs.length;
    const previousStorageCount = storageInputs.length;

    const first = await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({
        ...body,
        fileBase64: Buffer.from("different homework file").toString("base64"),
      })
      .expect(409);

    expect(scanInputs.slice(previousScanCount)).toEqual([
      expect.objectContaining({
        surface: "homework_material_file",
        tenantId: "tenant-a",
        fileName: "idempotent-materyal.txt",
        contentType: "text/plain",
      }),
    ]);
    expect(storageInputs.slice(previousStorageCount)).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        materialId: "material-a",
        fileName: "idempotent-materyal.txt",
        contentType: "text/plain",
      }),
    ]);
    await request(server)
      .get("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: files }) => {
        expect((files as Array<{ fileName: string }>).filter((file) => file.fileName === "idempotent-materyal.txt")).toHaveLength(1);
      });
  });

  it("materyali tenant içindeki öğrenciye atar ve listeler", async () => {
    const list = await request(server)
      .get("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200);

    expect(list.body).toEqual([
      {
        id: "material-assignment-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        studentId: "student-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        assignedById: "user-tenant-a",
        note: "Bireysel tekrar",
        dueAt: "2026-06-09T12:00:00.000Z",
        createdAt: "2026-06-08T09:20:00.000Z",
      },
    ]);

    const created = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        studentId: "student-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        note: "Ek tekrar",
        dueAt: "2026-06-10T12:00:00.000Z",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      materialId: "material-a",
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      assignedById: "user-tenant-a",
      note: "Ek tekrar",
      dueAt: "2026-06-10T12:00:00.000Z",
    });
  });

  it("materyal atamasını Idempotency-Key ile tekilleştirir", async () => {
    const key = "homework-material-assignment-idempotency-a";
    const body = {
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      note: "Idempotent materyal ataması",
      dueAt: "2026-06-11T12:00:00.000Z",
    };

    const first = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const second = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);

    await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .set("Idempotency-Key", key)
      .send({ ...body, note: "Farklı materyal ataması" })
      .expect(409);

    await request(server)
      .get("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(200)
      .expect(({ body: assignments }) => {
        expect(
          (assignments as Array<{ note?: string }>).filter(
            (assignment) => assignment.note === "Idempotent materyal ataması",
          ),
        ).toHaveLength(1);
      });
  });

  it("materyal havuzu tenant ve rol kurallarını korur", async () => {
    await request(server)
      .get("/homework/materials/material-b")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    await request(server)
      .post("/homework/materials")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ tenantId: "tenant-b", title: "Başka Tenant Materyali" })
      .expect(403);

    await request(server)
      .post("/homework/materials")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ title: "Teacher Materyali" })
      .expect(403);

    await request(server)
      .patch("/homework/materials/material-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ title: "Teacher Güncelleme" })
      .expect(403);

    await request(server)
      .delete("/homework/materials/material-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(403);
  });

  it("materyal dosyası tenant ve rol kurallarını korur", async () => {
    await request(server)
      .get("/homework/materials/material-b/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/homework/materials/material-b/files/material-file-b/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    await request(server)
      .get("/homework/materials/material-a/files/material-file-b/download")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(404);

    await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({
        fileName: "teacher.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(403);

    await request(server)
      .post("/homework/materials/material-b/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "tenant-b.txt",
        contentType: "text/plain",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(403);
  });

  it("materyal ataması tenant ve rol kurallarını korur", async () => {
    await request(server)
      .get("/homework/materials/material-b/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .expect(403);

    const teacherCreated = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ studentId: "student-a", courseId: "course-math", termId: "term-2026-spring", note: "Öğretmen takibi" })
      .expect(201);
    expect(teacherCreated.body).toMatchObject({
      tenantId: "tenant-a",
      materialId: "material-a",
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      assignedById: "teacher-tenant-a",
      note: "Öğretmen takibi",
    });

    const classC = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-C", level: "9" })
      .expect(201);
    const unscopedStudent = await request(server)
      .post("/students")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ firstName: "Kapsam", lastName: "Dışı", classId: classC.body.id })
      .expect(201);
    await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ studentId: unscopedStudent.body.id })
      .expect(403);

    await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-b" })
      .expect(403);

    await request(server)
      .post("/homework/materials/material-b/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a" })
      .expect(403);
  });

  it("geçersiz materyal dosyası girdilerini reddeder", async () => {
    const invalidContentType = await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "calisma.exe",
        contentType: "application/x-msdownload",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(422);

    expect(invalidContentType.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "contentType" })],
      },
    });

    const missingFile = await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "calisma.txt",
        contentType: "text/plain",
      })
      .expect(422);

    expect(missingFile.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "fileBase64" })],
      },
    });

    await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "calisma.txt",
        contentType: "text/plain",
        fileBase64: "not-base64",
      })
      .expect(400);

    await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "calisma.txt",
        contentType: "text/plain",
        fileBase64: Buffer.alloc(64 * 1024 + 1).toString("base64"),
      })
      .expect(400);

    await request(server)
      .post("/homework/materials/material-a/files")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        fileName: "calisma.png",
        contentType: "image/png",
        fileBase64: Buffer.from("hello world").toString("base64"),
      })
      .expect(400);
  });

  it("öğrencisiz veya geçersiz tarihli materyal atamasını reddeder", async () => {
    const missingStudent = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ note: "Öğrenci yok" })
      .expect(422);

    expect(missingStudent.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "studentId" })],
      },
    });

    const invalidDueAt = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a", dueAt: "gecersiz-tarih" })
      .expect(422);

    expect(invalidDueAt.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "dueAt" })],
      },
    });

    const invalidCalendarDueAt = await request(server)
      .post("/homework/materials/material-a/assignments")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ studentId: "student-a", dueAt: "2026-02-29T12:00" })
      .expect(422);

    expect(invalidCalendarDueAt.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [
          expect.objectContaining({
            message: "HOMEWORK_DUE_DATE_INVALID",
            path: "dueAt",
          }),
        ],
      },
    });
  });

  it("başlıksız materyal oluşturmayı reddeder", async () => {
    const response = await request(server)
      .post("/homework/materials")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ description: "Başlık yok" })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "title" })],
      },
    });
  });

  it("ödev CRUD akışını tenant içinde tamamlar", async () => {
    const created = await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        title: "Denklemler",
        description: "Sayfa 42",
        dueAt: "2026-06-06T12:00:00.000Z",
      })
      .expect(201);

    const homeworkId = (created.body as { id: string }).id;
    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      classId: "class-a",
      title: "Denklemler",
      description: "Sayfa 42",
    });

    await request(server)
      .patch(`/homework/${homeworkId}`)
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Denklemler Tekrar" })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe("Denklemler Tekrar");
      });

    await request(server).delete(`/homework/${homeworkId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(204);
    await request(server).get(`/homework/${homeworkId}`).set("Authorization", `Bearer ${tenantAAccessToken}`).expect(404);
  });

  it("materyalden ödevi tenant içinde oluşturur", async () => {
    const created = await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        materialId: "material-a",
        dueAt: "2026-06-07T12:00:00.000Z",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      tenantId: "tenant-a",
      classId: "class-a",
      sourceMaterialId: "material-a",
      sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
      title: "Kesirler Çalışma Kağıdı",
      description: "Kesirlerle dört işlem alıştırmaları",
      dueAt: "2026-06-07T12:00:00.000Z",
    });
  });

  it("tenant A başka tenant class için ödev oluşturamaz", async () => {
    await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-b",
        title: "Gizli Ödev",
        dueAt: "2026-06-06T12:00:00.000Z",
      })
      .expect(403);
  });

  it("tenant A başka tenantId ile ödev oluşturamaz", async () => {
    await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        tenantId: "tenant-b",
        classId: "class-a",
        title: "Gizli Tenant",
      })
      .expect(403);
  });

  it("tenant A başka tenant materyalinden ödev oluşturamaz", async () => {
    await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        materialId: "material-b",
      })
      .expect(403);
  });

  it("tenant A başka tenant class için materyalden ödev oluşturamaz", async () => {
    await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-b",
        materialId: "material-a",
      })
      .expect(403);
  });

  it("classId olmadan ödev oluşturmayı reddeder", async () => {
    const response = await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ title: "Sınıfsız Ödev" })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "classId" })],
      },
    });
  });

  it("materialId olmadan materyalden ödev oluşturmayı reddeder", async () => {
    const response = await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-a" })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "materialId" })],
      },
    });
  });

  it("geçersiz teslim tarihiyle materyalden ödev oluşturmayı reddeder", async () => {
    const response = await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: "class-a",
        materialId: "material-a",
        dueAt: "gecersiz-tarih",
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "dueAt" })],
      },
    });
  });

  it("ödev güncelleme gövdesini Zod ile doğrular", async () => {
    const response = await request(server)
      .patch("/homework/homework-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({
        classId: 123,
        dueAt: "gecersiz-tarih",
        title: " ",
      })
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: expect.arrayContaining([
          expect.objectContaining({ path: "classId" }),
          expect.objectContaining({ path: "dueAt" }),
          expect.objectContaining({ path: "title" }),
        ]),
      },
    });
  });

  it("ödev başka tenant class kaydına taşınamaz", async () => {
    await request(server)
      .patch("/homework/homework-a")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: "class-b" })
      .expect(403);
  });

  it("tenant A tenant B ödev kaydına erişemez", async () => {
    await request(server).get("/homework/homework-b").set("Authorization", `Bearer ${tenantAAccessToken}`).expect(403);
  });

  it("ödev kontrol durumunu tenant içinde kalıcı olarak işaretler", async () => {
    const checked = await request(server)
      .patch("/homework/homework-a/check-status")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ checked: true })
      .expect(200);

    expect(checked.body).toMatchObject({
      id: "homework-a",
      checkedBy: "teacher-tenant-a",
    });
    expect(typeof (checked.body as { checkedAt?: unknown }).checkedAt).toBe("string");

    const list = await request(server).get("/homework").set("Authorization", `Bearer ${tenantAAccessToken}`).expect(200);
    expect(list.body[0]).toMatchObject({
      id: "homework-a",
      checkedBy: "teacher-tenant-a",
    });

    const unchecked = await request(server)
      .patch("/homework/homework-a/check-status")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ checked: false })
      .expect(200);
    expect(unchecked.body.checkedAt).toBeUndefined();
    expect(unchecked.body.checkedBy).toBeUndefined();
  });

  it("tenant A başka tenant ödevinin kontrol durumunu değiştiremez", async () => {
    await request(server)
      .patch("/homework/homework-b/check-status")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ checked: true })
      .expect(403);
  });

  it("kontrol durumu olmadan ödev kontrol isteğini reddeder", async () => {
    const response = await request(server)
      .patch("/homework/homework-a/check-status")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({})
      .expect(422);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: {
        fields: [expect.objectContaining({ path: "checked" })],
      },
    });
  });

  it("teacher ödevleri okuyabilir ama yazamaz", async () => {
    const classC = await request(server)
      .post("/classes")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ name: "9-C", level: "9" })
      .expect(201);
    const unscoped = await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${tenantAAccessToken}`)
      .send({ classId: classC.body.id, title: "Kapsam Dışı Ödev" })
      .expect(201);

    await request(server)
      .get("/homework")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain("homework-a");
        expect(JSON.stringify(body)).not.toContain(unscoped.body.id);
      });
    await request(server).get("/homework/homework-a").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(200);
    await request(server).get("/homework/homework-b").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);
    await request(server).get(`/homework/${unscoped.body.id}`).set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);
    await request(server)
      .patch(`/homework/${unscoped.body.id}/check-status`)
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ checked: true })
      .expect(403);

    await request(server)
      .post("/homework")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ classId: "class-a", title: "Teacher Ödevi" })
      .expect(403);

    await request(server)
      .post("/homework/from-material")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ classId: "class-a", materialId: "material-a" })
      .expect(403);

    await request(server)
      .patch("/homework/homework-a")
      .set("Authorization", `Bearer ${teacherAAccessToken}`)
      .send({ title: "Teacher Güncelleme" })
      .expect(403);

    await request(server).delete("/homework/homework-a").set("Authorization", `Bearer ${teacherAAccessToken}`).expect(403);
  });

  it("yetkisiz request ödev endpointine erişemez", async () => {
    await request(server).get("/homework").expect(401);
  });
});
