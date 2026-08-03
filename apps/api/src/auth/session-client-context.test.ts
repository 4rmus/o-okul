import { describe, expect, it } from "vitest";
import { clientIpPrefix, deviceLabel } from "./session-client-context.js";

describe("session client context", () => {
  it("ham IP ve user-agent yerine sınırlı cihaz etiketi ile ağ prefix'i üretir", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari/605.1.15")).toBe("Safari · macOS");
    expect(clientIpPrefix("::ffff:203.0.113.42")).toBe("203.0.113.0/24");
    expect(clientIpPrefix("2001:db8::1")).toBe("IPv6 /64");
  });

  it("geçersiz veya eksik kaynağı saklamaz", () => {
    expect(deviceLabel(undefined)).toBeUndefined();
    expect(clientIpPrefix("not-an-ip")).toBeUndefined();
  });
});
