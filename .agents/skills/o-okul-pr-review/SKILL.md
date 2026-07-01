---
name: o-okul-pr-review
description: Use when reviewing an O-Okul PR, branch, commit, working tree diff, or final change set for correctness, tenant isolation, RBAC, auth/session safety, PII/KVKK leakage, report correctness, idempotency, missing tests, and release-evidence drift.
---

# O-Okul PR Review

Use this skill for findings-first review.

## Workflow

1. Identify the diff scope: PR, branch against `main`, commit, or working tree.
2. Read `AGENTS.md`, `docs/codex-agent-architecture.md`, and nearby tests for changed files.
3. Prioritize P0/P1 risks:
   - Cross-tenant exposure or RLS/RBAC bypass.
   - Auth/session, CSRF, MFA, rate-limit, or token-storage regression.
   - PII/KVKK leakage in logs, URLs, reports, uploads, or evidence.
   - Data loss, broken idempotency, unsafe worker retry, wrong report/scoring output.
   - Production evidence drift or local/static PASS misreported as staging/prod proof.
4. Check whether touched contracts were updated together:
   - Shared types and OpenAPI for API changes.
   - Migration, RLS, seed, and DB checks for schema changes.
   - Evidence scripts/templates/docs for release behavior changes.
5. Ask for a targeted fix only when a concrete finding exists.

## Agent Routing

- Use `pr_gate_reviewer` for the final consolidated review.
- Add `tenant_security_reviewer` for auth, tenant, RBAC, RLS, or evidence safety changes.
- Add `privacy_governance_reviewer` for PII, retention, upload, audit, or provider data.
- Add `qa_verification_engineer` only for concrete missing regression coverage.

## Output

Return:

- Findings first, ordered by severity, with file and line references.
- Open questions.
- Test gaps.
- Brief change summary.

If no issues are found, say that clearly and list residual verification risk.
