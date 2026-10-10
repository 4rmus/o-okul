import { describe, expect, it } from "vitest";
import { assertNoUnfinishedFreshReset } from "./device-restore.service.js";

// Evaluates the status predicate of the gate query against fixture rows, so a predicate regression fails here.
function fakeDb(statuses: string[]) {
  return {
    async query(sql: string) {
      const excluded = sql.match(/status NOT IN \(([^)]*)\)/)?.[1]?.match(/'([A-Z]+)'/g)?.map((value) => value.slice(1, -1))
        ?? [...sql.matchAll(/status<>'([A-Z]+)'/g)].map((match) => match[1]!);
      return { rows: statuses.filter((status) => !excluded.includes(status)).map((status) => ({ id: status })) };
    },
  };
}

describe("device restore reset gate", () => {
  it("a cancelled purge/reset no longer blocks; completed is finished too", async () => {
    await expect(assertNoUnfinishedFreshReset(fakeDb(["CANCELLED"]), "tenant-a")).resolves.toBeUndefined();
    await expect(assertNoUnfinishedFreshReset(fakeDb(["COMPLETED", "CANCELLED"]), "tenant-a")).resolves.toBeUndefined();
  });
  it.each(["QUEUED", "RUNNING", "BLOCKED", "FAILED"])("an unfinished %s operation still blocks with 409", async (status) => {
    await expect(assertNoUnfinishedFreshReset(fakeDb([status]), "tenant-a")).rejects.toMatchObject({ status: 409, message: "DEVICE_RESTORE_RESET_IN_PROGRESS" });
  });
});
