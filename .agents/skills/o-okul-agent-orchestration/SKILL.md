---
name: o-okul-agent-orchestration
description: Use when planning or running Codex expert/subagent work in the O-Okul repo, including agent selection, delegation prompts, validation routing, and multi-agent handoff summaries.
---

# O-Okul Agent Orchestration

Use this skill when the user asks for expert agents, subagents, parallel review, large feature planning, production gate triage, or coordinated development in this repo.

## Workflow

1. Read `AGENTS.md` and `docs/codex-agent-architecture.md` if they are relevant to the task.
2. Decide whether subagents are actually useful. Prefer single-agent work for small edits.
3. If delegating, choose 1-4 agents with disjoint responsibilities.
4. Prefer read-only agents for discovery, security, docs research, QA strategy, and PR review.
5. Use only one write-capable agent per file area. Give explicit owned paths and forbidden paths.
6. Keep the main agent responsible for integration, conflict resolution, final verification, and user-facing summary.

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

## Recommended Agent Routing

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
