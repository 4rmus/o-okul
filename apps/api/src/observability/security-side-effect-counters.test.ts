import { afterEach, describe, expect, it } from "vitest";
import { MetricsService } from "../metrics/metrics.service.js";
import { recordSecuritySideEffectFailure, resetSecuritySideEffectFailureCounts } from "./security-side-effect-counters.js";

describe("security side-effect failure counters", () => {
  afterEach(() => resetSecuritySideEffectFailureCounts());

  it("renders every event at zero and counts failures with fixed labels only", async () => {
    const service = new MetricsService();
    const idle = await service.render();
    expect(idle).toContain("# TYPE o_okul_auth_security_side_effect_failures_total counter");
    expect(idle).toContain('o_okul_auth_security_side_effect_failures_total{event="mfa_notice_enqueue"} 0');
    expect(idle).toContain('o_okul_auth_security_side_effect_failures_total{event="mfa_reset_audit"} 0');

    recordSecuritySideEffectFailure("mfa_reset_audit");
    recordSecuritySideEffectFailure("mfa_reset_audit");
    recordSecuritySideEffectFailure("mfa_notice_enqueue");
    const output = await service.render();
    expect(output).toContain('o_okul_auth_security_side_effect_failures_total{event="mfa_reset_audit"} 2');
    expect(output).toContain('o_okul_auth_security_side_effect_failures_total{event="mfa_notice_enqueue"} 1');
  });
});
