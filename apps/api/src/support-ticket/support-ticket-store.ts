import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type {
  SupportTicketAttachmentRecord,
  SupportTicketCommentRecord,
  SupportTicketRecord,
} from "./support-ticket.service.js";

export interface SupportTicketStore {
  list(): Promise<SupportTicketRecord[]>;
  findById(id: string): Promise<SupportTicketRecord | undefined>;
  create(input: Omit<SupportTicketRecord, "id">): Promise<SupportTicketRecord>;
  update(
    id: string,
    input: Pick<SupportTicketRecord, "priority" | "status">,
  ): Promise<SupportTicketRecord | undefined>;
  listAttachments(ticketId: string): Promise<SupportTicketAttachmentRecord[]>;
  findAttachmentById(id: string): Promise<SupportTicketAttachmentRecord | undefined>;
  createAttachment(input: Omit<SupportTicketAttachmentRecord, "id">): Promise<SupportTicketAttachmentRecord>;
  listComments(ticketId: string): Promise<SupportTicketCommentRecord[]>;
  createComment(input: Omit<SupportTicketCommentRecord, "id">): Promise<SupportTicketCommentRecord>;
}

export const supportTicketStoreToken = Symbol("SupportTicketStore");

const demoTickets: SupportTicketRecord[] = [
  {
    id: "support-ticket-a",
    tenantId: "tenant-a",
    requesterId: "user-tenant-a",
    studentId: "student-a",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    subject: "Optik dosya yüklenemiyor",
    message: "TXT dosyası yüklenirken hata alıyoruz.",
    priority: "NORMAL",
    status: "OPEN",
    createdAt: "2026-06-08T09:00:00.000Z",
  },
  {
    id: "support-ticket-b",
    tenantId: "tenant-b",
    requesterId: "user-tenant-b",
    subject: "Tenant B destek talebi",
    message: "Tenant B mesajı",
    priority: "LOW",
    status: "OPEN",
    createdAt: "2026-06-08T09:00:00.000Z",
  },
];

const demoAttachments: SupportTicketAttachmentRecord[] = [
  {
    id: "support-attachment-a",
    tenantId: "tenant-a",
    ticketId: "support-ticket-a",
    uploadedById: "user-tenant-a",
    fileName: "hata-ekrani.txt",
    contentType: "text/plain",
    byteSize: 11,
    sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
    contentBase64: "aGVsbG8gd29ybGQ=",
    createdAt: "2026-06-08T09:10:00.000Z",
  },
  {
    id: "support-attachment-b",
    tenantId: "tenant-b",
    ticketId: "support-ticket-b",
    uploadedById: "user-tenant-b",
    fileName: "tenant-b.txt",
    contentType: "text/plain",
    byteSize: 8,
    sha256: "f2f66cde996a5f060a22979f9c35a9d4a43aca5c7e94cbb08b5a89e58e6684c8",
    contentBase64: "dGVuYW50LWI=",
    createdAt: "2026-06-08T09:10:00.000Z",
  },
];

const demoComments: SupportTicketCommentRecord[] = [
  {
    id: "support-comment-a",
    tenantId: "tenant-a",
    ticketId: "support-ticket-a",
    authorId: "user-tenant-a",
    body: "Ekran görüntüsünü ekledim.",
    createdAt: "2026-06-08T09:20:00.000Z",
  },
  {
    id: "support-comment-b",
    tenantId: "tenant-b",
    ticketId: "support-ticket-b",
    authorId: "user-tenant-b",
    body: "Tenant B yorumu",
    createdAt: "2026-06-08T09:20:00.000Z",
  },
];

export class InMemorySupportTicketStore implements SupportTicketStore {
  private readonly tickets = demoTickets.map((record) => ({ ...record }));
  private readonly attachments = demoAttachments.map((record) => ({ ...record }));
  private readonly comments = demoComments.map((record) => ({ ...record }));

  async list(): Promise<SupportTicketRecord[]> {
    return this.tickets;
  }

  async findById(id: string): Promise<SupportTicketRecord | undefined> {
    return this.tickets.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<SupportTicketRecord, "id">): Promise<SupportTicketRecord> {
    const record = {
      id: `support-ticket-${this.tickets.length + 1}`,
      ...input,
    };
    this.tickets.push(record);
    return record;
  }

  async update(
    id: string,
    input: Pick<SupportTicketRecord, "priority" | "status">,
  ): Promise<SupportTicketRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.priority = input.priority;
    record.status = input.status;
    return record;
  }

  async listAttachments(ticketId: string): Promise<SupportTicketAttachmentRecord[]> {
    return this.attachments.filter((candidate) => candidate.ticketId === ticketId).map(withoutAttachmentContent);
  }

  async findAttachmentById(id: string): Promise<SupportTicketAttachmentRecord | undefined> {
    return this.attachments.find((candidate) => candidate.id === id);
  }

  async createAttachment(input: Omit<SupportTicketAttachmentRecord, "id">): Promise<SupportTicketAttachmentRecord> {
    const record = {
      id: `support-attachment-${this.attachments.length + 1}`,
      ...input,
    };
    this.attachments.push(record);
    return withoutAttachmentContent(record);
  }

  async listComments(ticketId: string): Promise<SupportTicketCommentRecord[]> {
    return this.comments.filter((candidate) => candidate.ticketId === ticketId);
  }

  async createComment(input: Omit<SupportTicketCommentRecord, "id">): Promise<SupportTicketCommentRecord> {
    const record = {
      id: `support-comment-${this.comments.length + 1}`,
      ...input,
    };
    this.comments.push(record);
    return record;
  }
}

export class PostgresSupportTicketStore implements SupportTicketStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async list(): Promise<SupportTicketRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketRow>(
        `SELECT * FROM "SupportTicket"
         ORDER BY "createdAt" DESC`,
      );
      return result.rows.map(toSupportTicketRecord);
    });
  }

  async findById(id: string): Promise<SupportTicketRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketRow>(
        `SELECT * FROM "SupportTicket" WHERE "id" = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toSupportTicketRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<SupportTicketRecord, "id">): Promise<SupportTicketRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketRow>(
        `INSERT INTO "SupportTicket" ("id", "tenantId", "requesterId", "studentId", "campusId", "gradeLevelId", "classId", "courseId", "termId", "subject", "message", "priority", "status", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.requesterId ?? null,
          input.studentId ?? null,
          input.campusId ?? null,
          input.gradeLevelId ?? null,
          input.classId ?? null,
          input.courseId ?? null,
          input.termId ?? null,
          input.subject,
          input.message,
          input.priority,
          input.status,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SUPPORT_TICKET_CREATE_FAILED");
      }
      return toSupportTicketRecord(record);
    });
  }

  async update(
    id: string,
    input: Pick<SupportTicketRecord, "priority" | "status">,
  ): Promise<SupportTicketRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketRow>(
        `UPDATE "SupportTicket"
         SET "priority" = $2,
             "status" = $3,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.priority, input.status],
      );
      return result.rows[0] ? toSupportTicketRecord(result.rows[0]) : undefined;
    });
  }

  async listAttachments(ticketId: string): Promise<SupportTicketAttachmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketAttachmentRow>(
        `SELECT * FROM "SupportTicketAttachment"
         WHERE "ticketId" = $1
         ORDER BY "createdAt" DESC`,
        [ticketId],
      );
      return result.rows.map(toSupportTicketAttachmentRecord).map(withoutAttachmentContent);
    });
  }

  async findAttachmentById(id: string): Promise<SupportTicketAttachmentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketAttachmentRow>(
        `SELECT * FROM "SupportTicketAttachment"
         WHERE "id" = $1
         LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toSupportTicketAttachmentRecord(result.rows[0]) : undefined;
    });
  }

  async createAttachment(input: Omit<SupportTicketAttachmentRecord, "id">): Promise<SupportTicketAttachmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketAttachmentRow>(
        `INSERT INTO "SupportTicketAttachment" ("id", "tenantId", "ticketId", "uploadedById", "fileName", "contentType", "byteSize", "sha256", "contentBase64", "storageKey", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.ticketId,
          input.uploadedById ?? null,
          input.fileName,
          input.contentType,
          input.byteSize,
          input.sha256,
          input.contentBase64 ?? null,
          input.storageKey ?? null,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SUPPORT_TICKET_ATTACHMENT_CREATE_FAILED");
      }
      return withoutAttachmentContent(toSupportTicketAttachmentRecord(record));
    });
  }

  async listComments(ticketId: string): Promise<SupportTicketCommentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketCommentRow>(
        `SELECT * FROM "SupportTicketComment"
         WHERE "ticketId" = $1
         ORDER BY "createdAt" ASC`,
        [ticketId],
      );
      return result.rows.map(toSupportTicketCommentRecord);
    });
  }

  async createComment(input: Omit<SupportTicketCommentRecord, "id">): Promise<SupportTicketCommentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<SupportTicketCommentRow>(
        `INSERT INTO "SupportTicketComment" ("id", "tenantId", "ticketId", "authorId", "body", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.ticketId,
          input.authorId ?? null,
          input.body,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SUPPORT_TICKET_COMMENT_CREATE_FAILED");
      }
      return toSupportTicketCommentRecord(record);
    });
  }
}

export function createSupportTicketStore(): SupportTicketStore {
  return resolvePersistenceDriver(process.env.SUPPORT_TICKET_STORE) === "postgres"
    ? new PostgresSupportTicketStore()
    : new InMemorySupportTicketStore();
}

interface SupportTicketRow {
  id: string;
  tenantId: string;
  requesterId: string | null;
  studentId: string | null;
  campusId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  courseId: string | null;
  termId: string | null;
  subject: string;
  message: string;
  priority: SupportTicketRecord["priority"];
  status: SupportTicketRecord["status"];
  createdAt: Date | string;
  deletedAt: Date | string | null;
}

interface SupportTicketAttachmentRow {
  id: string;
  tenantId: string;
  ticketId: string;
  uploadedById: string | null;
  fileName: string;
  contentType: SupportTicketAttachmentRecord["contentType"];
  byteSize: number;
  sha256: string;
  contentBase64: string | null;
  storageKey: string | null;
  createdAt: Date | string;
  deletedAt: Date | string | null;
}

interface SupportTicketCommentRow {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId: string | null;
  body: string;
  createdAt: Date | string;
  deletedAt: Date | string | null;
}

function toSupportTicketRecord(record: SupportTicketRow): SupportTicketRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    requesterId: record.requesterId ?? undefined,
    studentId: record.studentId ?? undefined,
    campusId: record.campusId ?? undefined,
    gradeLevelId: record.gradeLevelId ?? undefined,
    classId: record.classId ?? undefined,
    courseId: record.courseId ?? undefined,
    termId: record.termId ?? undefined,
    subject: record.subject,
    message: record.message,
    priority: record.priority,
    status: record.status,
    createdAt: toIsoString(record.createdAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toSupportTicketAttachmentRecord(record: SupportTicketAttachmentRow): SupportTicketAttachmentRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    ticketId: record.ticketId,
    uploadedById: record.uploadedById ?? undefined,
    fileName: record.fileName,
    contentType: record.contentType,
    byteSize: record.byteSize,
    sha256: record.sha256,
    contentBase64: record.contentBase64 ?? undefined,
    storageKey: record.storageKey ?? undefined,
    createdAt: toIsoString(record.createdAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toSupportTicketCommentRecord(record: SupportTicketCommentRow): SupportTicketCommentRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    ticketId: record.ticketId,
    authorId: record.authorId ?? undefined,
    body: record.body,
    createdAt: toIsoString(record.createdAt),
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function withoutAttachmentContent(record: SupportTicketAttachmentRecord): SupportTicketAttachmentRecord {
  const { contentBase64: _contentBase64, storageKey: _storageKey, ...publicRecord } = record;
  return publicRecord;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
