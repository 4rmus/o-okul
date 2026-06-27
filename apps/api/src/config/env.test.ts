import { describe, expect, it } from "vitest";
import { isSmsEnabled } from "./env.js";

describe("isSmsEnabled", () => {
  it("SMS_ENABLED sadece true ise SMS'i açar", () => {
    expect(isSmsEnabled({})).toBe(false);
    expect(isSmsEnabled({ SMS_ENABLED: "false" })).toBe(false);
    expect(isSmsEnabled({ SMS_ENABLED: "true" })).toBe(true);
  });
});
