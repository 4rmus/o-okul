import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { AnnouncementRecord } from "./announcement.service.js";

export interface AnnouncementStore {
  list(): Promise<AnnouncementRecord[]>;
  findById(id: string): Promise<AnnouncementRecord | undefined>;
  create(input: Omit<AnnouncementRecord, "id">): Promise<AnnouncementRecord>;
}

export const announcementStoreToken = Symbol("AnnouncementStore");

const demoAnnouncements: AnnouncementRecord[] = [
  {
    id: "announcement-a",
    tenantId: "tenant-a",
    title: "Veli toplantısı",
    body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
    audience: "SCHOOL",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    publishedAt: "2026-06-08T09:00:00.000Z",
  },
  {
    id: "announcement-b",
    tenantId: "tenant-b",
    title: "Deneme sınavı",
    body: "Tenant B duyurusu",
    audience: "SCHOOL",
    publishedAt: "2026-06-08T09:00:00.000Z",
  },
];

export class InMemoryAnnouncementStore implements AnnouncementStore {
  private readonly announcements = demoAnnouncements.map((record) => ({ ...record }));

  async list(): Promise<AnnouncementRecord[]> {
    return this.announcements;
  }

  async findById(id: string): Promise<AnnouncementRecord | undefined> {
    return this.announcements.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<AnnouncementRecord, "id">): Promise<AnnouncementRecord> {
    const record = {
      id: `announcement-${this.announcements.length + 1}`,
      ...input,
    };
    this.announcements.push(record);
    return record;
  }
}

export class PostgresAnnouncementStore implements AnnouncementStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async list(): Promise<AnnouncementRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementRow>(
        `SELECT * FROM "Announcement"
         ORDER BY "publishedAt" DESC, "createdAt" DESC`,
      );
      return result.rows.map(toAnnouncementRecord);
    });
  }

  async findById(id: string): Promise<AnnouncementRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementRow>(`SELECT * FROM "Announcement" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toAnnouncementRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<AnnouncementRecord, "id">): Promise<AnnouncementRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnnouncementRow>(
        `INSERT INTO "Announcement" ("id", "tenantId", "title", "body", "audience", "campusId", "gradeLevelId", "classId", "courseId", "termId", "publishedAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.title,
          input.body,
          input.audience,
          input.campusId ?? null,
          input.gradeLevelId ?? null,
          input.classId ?? null,
          input.courseId ?? null,
          input.termId ?? null,
          input.publishedAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("ANNOUNCEMENT_CREATE_FAILED");
      }
      return toAnnouncementRecord(record);
    });
  }
}

export function createAnnouncementStore(): AnnouncementStore {
  return resolvePersistenceDriver(process.env.ANNOUNCEMENT_STORE) === "postgres"
    ? new PostgresAnnouncementStore()
    : new InMemoryAnnouncementStore();
}

interface AnnouncementRow {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: AnnouncementRecord["audience"];
  campusId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  courseId: string | null;
  termId: string | null;
  publishedAt: Date | string;
  deletedAt: Date | string | null;
}

function toAnnouncementRecord(record: AnnouncementRow): AnnouncementRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    title: record.title,
    body: record.body,
    audience: record.audience,
    campusId: record.campusId ?? undefined,
    gradeLevelId: record.gradeLevelId ?? undefined,
    classId: record.classId ?? undefined,
    courseId: record.courseId ?? undefined,
    termId: record.termId ?? undefined,
    publishedAt: toIsoString(record.publishedAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
