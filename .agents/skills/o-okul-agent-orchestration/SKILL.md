---
name: o-okul-agent-orchestration
description: Use when coordinating O-Okul Codex expert/subagent work, choosing between the repo skills, routing agent ownership, writing delegation prompts, or summarizing multi-agent handoffs for planning, implementation, release evidence, or PR review.
---

# O-Okul Agent Orchestration

Use this as the router for O-Okul agent work. Prefer the narrower skill when the task matches it.

## Skill Routing

- Planning, roadmap, production analysis, UAT/DEC alignment, or smallest safe PR -> `o-okul-planning`.
- Scoped implementation, bug fix, contract update, or test/evidence script change -> `o-okul-implementation-slice`.
- Deploy, staging/prod truth, GitHub parity, running image, env/secrets, or go-live evidence -> `o-okul-release-evidence`.
- PR, branch, commit, working-tree, or final gate review -> `o-okul-pr-review`.

## Delegation Rules

1. Read `AGENTS.md` and `docs/codex-agent-architecture.md` when relevant.
2. Decide whether subagents are useful. Prefer single-agent work for small edits.
3. With `max_threads = 4`, the main agent and at most three subagents may participate concurrently.
4. Each active gate may have only one write-capable participant. Give explicit owned paths and forbidden paths.
5. If the main agent writes, every subagent must remain read-only.
6. If a subagent writes, the main agent may change files only for integration.
7. Use no more than three parallel read-only reviewers for discovery, security review, docs research, QA strategy, and PR review.
8. Keep the main agent responsible for integration, conflict resolution, final verification, and user-facing summary.

## Delegation Prompt Template

```text
Task: <specific outcome>
Role: <agent name>
Owned paths: <files/modules agent may inspect or edit>
Forbidden paths: <unrelated files or active user changes>
Constraints: do not revert unrelated edits; preserve tenant isolation/RBAC/PII/evidence contracts.
Expected output: findings or changed file list, tests run, residual risk.
Validation: <targeted commands>
```

## Agent Routing

- Product scope or UAT: `product_scope_planner`
- RLS/RBAC/tenant isolation: `tenant_security_reviewer`
- Auth/MFA/session/rate-limit: `auth_session_engineer`
- KVKK/PII/retention/upload privacy: `privacy_governance_reviewer`
- API implementation: `backend_api_engineer`
- Web/UI implementation: `frontend_ux_engineer`
- Exam/report/worker implementation: `exam_reporting_engineer`
- Prisma/RLS/migrations: `data_platform_engineer`
- Release/evidence/go-live captain: `ops_release_engineer`
- Docker/Traefik/backup/DR: `infra_dr_engineer`
- Observability/alerting/Sentry: `observability_sre_engineer`
- SMS/notification provider integration: `messaging_integrations_engineer`
- Tests/e2e/flakes: `qa_verification_engineer`
- Official documentation verification: `docs_researcher`
- Final review: `pr_gate_reviewer`

## Handoff Contract

Every subagent summary should contain:

- Result: done, blocked, or findings-only.
- Files changed, if any.
- Key findings with file references.
- Tests or commands run.
- Residual risks and follow-up owner.

Do not paste long raw logs into the main thread unless the exact error text is needed for debugging.
