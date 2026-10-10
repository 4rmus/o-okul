---
name: o-okul-pr-review
description: Use when reviewing an O-Okul PR, branch, commit, working tree diff, or final change set for correctness, tenant isolation, RBAC capabilities, auth/session and license gating, PII/KVKK and consent leakage, report and gradebook correctness, idempotency, missing tests, evidence-class honesty, and release-evidence or agent-contract drift.
---
# O-Okul PR Review

Use this skill for findings-first review.

## Workflow

1. Identify the diff scope: PR, branch against `main`, commit, or working tree.
2. Read `AGENTS.md`, `docs/agent-architecture.md`, and nearby tests for changed files.
3. Prioritize P0/P1 risks:
   - Cross-tenant exposure, RLS/RBAC bypass, tenant-host or control-plane boundary break, `withBypassRlsQuery` outside the allow-list.
   - Auth/session, CSRF, MFA, rate-limit, token-storage, identity provisioning, or license-state regression.
   - PII/KVKK leakage in logs, URLs, reports, uploads, analytics, fixtures, or evidence; consent or `canViewFinance` ignored on guardian surfaces.
   - Data loss, broken idempotency, unsafe worker retry, wrong report/scoring output, or a published grade row updated in place (ADR-0011).
   - Production evidence drift or local/static PASS misreported as CI, staging, or production proof.
   - Scope change without a DEC record, or a public claim beyond `docs/marketing-claims.md`.
4. Check whether touched contracts were updated together:
   - Shared types and OpenAPI output contract for API changes.
   - Migration, RLS, seed, tenant-models parity, and DB checks for schema changes.
   - Evidence scripts/templates/docs for release behavior changes.
   - `pnpm agents:check` for agent, skill, settings, or MCP definition changes.
   - Gate B measurement baseline for UI-affecting changes.
5. Ask for a targeted fix only when a concrete finding exists.

## Agent Routing

- Use `pr_gate_reviewer` for the final consolidated review.
- Add `tenant_security_reviewer` for auth, tenant, RBAC, RLS, identity, license, or evidence safety changes.
- Add `privacy_governance_reviewer` for PII, consent, retention, upload, audit, analytics, or provider data.
- Add `qa_verification_engineer` only for concrete missing regression coverage.

## Output

Return:

- Findings first, ordered by severity, with file and line references.
- Open questions.
- Test gaps.
- Brief change summary with the evidence class of every verification cited.

If no issues are found, say that clearly and list residual verification risk.
