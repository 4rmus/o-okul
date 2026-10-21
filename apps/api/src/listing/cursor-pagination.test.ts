import { afterEach, describe, expect, it } from "vitest";
import {
  decodeListCursor,
  encodeListCursor,
  foldSearchText,
  foldedSearchSql,
  likeSearchPattern,
  listCursorContext,
  paginateCursorRecords,
} from "./cursor-pagination.js";

describe("cursor pagination helper", () => {
  const context = listCursorContext("test", "tenant-a", { q: "", sort: "name" });
  const rows = ["ada", "bora", "cem", "deniz", "ece"].map((name, index) => ({ id: `row-${index}`, name }));
  const positionOf = (row: { id: string; name: string }) => ({ key: row.name, id: row.id });
  const paginate = (records: typeof rows, cursor?: string, direction: "next" | "previous" = "next") =>
    paginateCursorRecords(records, { cursor, direction, limit: 2 }, context, positionOf, "ASC", "TEST_CURSOR_INVALID");

  const originalEnv = { NODE_ENV: process.env.NODE_ENV, JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET };
  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("sıralama değerini mühürlü cursor'da taşır ve bağlamı doğrular", () => {
    const cursor = encodeListCursor(context, { key: "cem", id: "row-2" });
    expect(decodeListCursor(cursor, context, "TEST_CURSOR_INVALID")).toEqual({ key: "cem", id: "row-2" });
    expect(Buffer.from(cursor, "base64url")[0]).toBe(3);
    const otherTenant = listCursorContext("test", "tenant-b", { q: "", sort: "name" });
    expect(() => decodeListCursor(cursor, otherTenant, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");
    // Earlier plain formats (v1 id-only, v2 key + id) no longer decode; the web drops them and reloads the first page.
    for (const legacy of [{ v: 1, c: context, id: "row-2" }, { v: 2, c: context, k: "cem", id: "row-2" }]) {
      const encoded = Buffer.from(JSON.stringify(legacy), "utf8").toString("base64url");
      expect(() => decodeListCursor(encoded, context, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");
    }
  });

  it("cursor sınır satırının değerlerini düz metin taşımaz ve tek bit değişikliğini reddeder", () => {
    const position = { key: "işik ayşe 1234", id: "student-secret-id-42" };
    const cursor = encodeListCursor(context, position);
    const decoded = Buffer.from(cursor, "base64url").toString("latin1");
    for (const value of [position.key, position.id, "secret", "1234"]) {
      expect(cursor).not.toContain(value);
      expect(decoded).not.toContain(Buffer.from(value, "utf8").toString("latin1"));
    }
    expect(encodeListCursor(context, position)).not.toBe(cursor);

    const sealed = Buffer.from(cursor, "base64url");
    for (const index of [0, 1, 13, 29, sealed.length - 1]) {
      const flipped = Buffer.from(sealed);
      flipped[index] = flipped[index]! ^ 0x01;
      expect(() => decodeListCursor(flipped.toString("base64url"), context, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");
    }
  });

  it("çözülen sıralama değerini biçimine göre doğrular", () => {
    const decode = (key: string, format: "text" | "timestamp-ms") =>
      () => decodeListCursor(encodeListCursor(context, { key, id: "row-1" }), context, "TEST_CURSOR_INVALID", format);
    expect(decode("2026-10-01T09:00:00.123", "timestamp-ms")()).toEqual({ key: "2026-10-01T09:00:00.123", id: "row-1" });
    for (const bad of ["x", "2026-10-01 09:00:00", "2026-02-30T09:00:00.000", "2026-10-01T09:00:00.123Z"]) {
      expect(decode(bad, "timestamp-ms"), bad).toThrow("TEST_CURSOR_INVALID");
    }
    expect(decode("ad\u0000soyad", "text")).toThrow("TEST_CURSOR_INVALID");
    expect(decode("x".repeat(513), "text")).toThrow("TEST_CURSOR_INVALID");
    expect(() => decodeListCursor(encodeListCursor(context, { key: "a", id: "row\u0000" }), context, "TEST_CURSOR_INVALID"))
      .toThrow("TEST_CURSOR_INVALID");
  });

  it("anahtarı JWT_ACCESS_SECRET'tan türetir; production'da eksik veya varsayılan sırrı reddeder", () => {
    process.env.JWT_ACCESS_SECRET = "secret-one-0123456789abcdef0123456789";
    const cursor = encodeListCursor(context, { key: "cem", id: "row-2" });
    process.env.JWT_ACCESS_SECRET = "secret-two-0123456789abcdef0123456789";
    expect(() => decodeListCursor(cursor, context, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");

    process.env.NODE_ENV = "production";
    delete process.env.JWT_ACCESS_SECRET;
    expect(() => encodeListCursor(context, { key: "cem", id: "row-2" })).toThrow("JWT_ACCESS_SECRET_REQUIRED");
    process.env.JWT_ACCESS_SECRET = "test-access-secret";
    expect(() => encodeListCursor(context, { key: "cem", id: "row-2" })).toThrow("JWT_ACCESS_SECRET_REQUIRED");
  });

  it("sınır satırı silinse, filtreden çıksa veya yeniden adlandırılsa da kaldığı yerden devam eder", () => {
    const first = paginate(rows);
    expect(first.records.map((row) => row.name)).toEqual(["ada", "bora"]);

    const withoutBoundary = rows.filter((row) => row.id !== "row-1");
    expect(paginate(withoutBoundary, first.meta.nextCursor).records.map((row) => row.name)).toEqual(["cem", "deniz"]);

    const renamed = rows.map((row) => row.id === "row-1" ? { ...row, name: "zehra" } : row);
    expect(paginate(renamed, first.meta.nextCursor).records.map((row) => row.name)).toEqual(["cem", "deniz"]);

    const second = paginate(rows, first.meta.nextCursor);
    const withoutPreviousBoundary = rows.filter((row) => row.id !== "row-2");
    const back = paginate(withoutPreviousBoundary, second.meta.previousCursor, "previous");
    expect(back.records.map((row) => row.name)).toEqual(["ada", "bora"]);
    expect(back.meta.previousCursor).toBeUndefined();
  });

  it("Türkçe I harflerini iki tarafta da i'ye katlar", () => {
    expect(foldSearchText("IŞIK")).toBe("işik");
    expect(foldSearchText("ışık")).toBe("işik");
    expect(foldSearchText("Işık")).toBe("işik");
    expect(foldSearchText("İSMAİL")).toBe("ismail");
    expect(foldSearchText("İsmail")).toBe("ismail");
    expect(foldSearchText("ÇĞÖÜ")).toBe("çğöü");
    expect(foldSearchText("İSMAİL")).not.toContain("̇");
    expect(likeSearchPattern("  İsmail_ ")).toBe("%ismail\\_%");
    expect(foldedSearchSql('t."name"')).toBe(`lower(translate(t."name", 'İIıŞĞÇÖÜ', 'iiişğçöü'))`);
  });
});
