import { describe, expect, it } from "vitest";
import { assertPersistenceConfig, resolvePersistenceDriver } from "./persistence.js";

describe("resolvePersistenceDriver", () => {
  it("production'da her zaman postgres döner ve override'ları yok sayar", () => {
    expect(resolvePersistenceDriver(undefined, { NODE_ENV: "production" })).toBe("postgres");
    expect(resolvePersistenceDriver("in-memory", { NODE_ENV: "production", PERSISTENCE_DRIVER: "memory" })).toBe(
      "postgres",
    );
  });

  it("production dışında varsayılan olarak memory döner", () => {
    expect(resolvePersistenceDriver(undefined, { NODE_ENV: "development" })).toBe("memory");
    expect(resolvePersistenceDriver(undefined, {})).toBe("memory");
  });

  it("global PERSISTENCE_DRIVER=postgres ile dev'de postgres seçilir", () => {
    expect(resolvePersistenceDriver(undefined, { NODE_ENV: "development", PERSISTENCE_DRIVER: "postgres" })).toBe(
      "postgres",
    );
  });

  it("per-store override global ayarı geçersiz kılar (dev)", () => {
    expect(resolvePersistenceDriver("postgres", { NODE_ENV: "development", PERSISTENCE_DRIVER: "memory" })).toBe(
      "postgres",
    );
    expect(resolvePersistenceDriver("memory", { NODE_ENV: "test", PERSISTENCE_DRIVER: "postgres" })).toBe("memory");
  });
});

describe("assertPersistenceConfig", () => {
  it("production dışında hiçbir kontrol yapmaz", () => {
    expect(() => assertPersistenceConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertPersistenceConfig({ NODE_ENV: "test", PERSISTENCE_DRIVER: "memory" })).not.toThrow();
  });

  it("production'da postgres + DATABASE_URL varsa geçer", () => {
    expect(() =>
      assertPersistenceConfig({
        NODE_ENV: "production",
        PERSISTENCE_DRIVER: "postgres",
        DATABASE_URL: "postgresql://app:app@db:5432/uzman_hocam",
      }),
    ).not.toThrow();
  });

  it("production'da PERSISTENCE_DRIVER tanımsız ama DATABASE_URL varsa geçer", () => {
    expect(() =>
      assertPersistenceConfig({ NODE_ENV: "production", DATABASE_URL: "postgresql://app:app@db:5432/uzman_hocam" }),
    ).not.toThrow();
  });

  it("production'da PERSISTENCE_DRIVER postgres değilse patlar", () => {
    expect(() =>
      assertPersistenceConfig({
        NODE_ENV: "production",
        PERSISTENCE_DRIVER: "memory",
        DATABASE_URL: "postgresql://app:app@db:5432/uzman_hocam",
      }),
    ).toThrow(/PERSISTENCE_DRIVER/);
  });

  it("production'da DATABASE_URL yoksa patlar", () => {
    expect(() => assertPersistenceConfig({ NODE_ENV: "production", PERSISTENCE_DRIVER: "postgres" })).toThrow(
      /DATABASE_URL/,
    );
  });
});
