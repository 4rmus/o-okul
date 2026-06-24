export function parseRedisUrl(redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379") {
  const url = new URL(redisUrl);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL_INVALID");
  }

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: parseRedisDb(url.pathname),
    tls: url.protocol === "rediss:" ? {} : undefined,
  };
}

export function parsePostgresUrl(
  databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
  };
}

function parseRedisDb(pathname: string): number | undefined {
  if (!pathname || pathname === "/") {
    return undefined;
  }

  const db = Number(pathname.slice(1));
  if (!Number.isInteger(db) || db < 0) {
    throw new Error("REDIS_URL_DB_INVALID");
  }
  return db;
}
