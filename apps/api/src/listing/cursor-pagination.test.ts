import { describe, expect, it } from "vitest";
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

  it("sıralama değerini cursor'da taşır ve bağlamı doğrular", () => {
    const cursor = encodeListCursor(context, { key: "cem", id: "row-2" });
    expect(decodeListCursor(cursor, context, "TEST_CURSOR_INVALID")).toEqual({ key: "cem", id: "row-2" });
    const otherTenant = listCursorContext("test", "tenant-b", { q: "", sort: "name" });
    expect(() => decodeListCursor(cursor, otherTenant, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");
    // Cursors of the earlier id-only format (v1) no longer decode; the web drops them and reloads the first page.
    const legacy = Buffer.from(JSON.stringify({ v: 1, c: context, id: "row-2" }), "utf8").toString("base64url");
    expect(() => decodeListCursor(legacy, context, "TEST_CURSOR_INVALID")).toThrow("TEST_CURSOR_INVALID");
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
