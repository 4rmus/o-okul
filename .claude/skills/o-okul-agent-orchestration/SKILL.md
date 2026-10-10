---
name: o-okul-agent-orchestration
description: Use when coordinating O-Okul Claude Code or Cursor subagent work, choosing between the repo skills, routing agent ownership, writing delegation prompts, or summarizing multi-agent handoffs for planning, implementation, release evidence, or PR review.
---

# O-Okul Agent Orchestration

Use this as the router for O-Okul agent work. Prefer the narrower skill when the task matches it.

## Skill Routing

- Planning, roadmap, production analysis, UAT/DEC alignment, or smallest safe PR -> `o-okul-planning`.
- Scoped implementation, bug fix, contract update, or test/evidence script change -> `o-okul-implementation-slice`.
- Deploy, staging/prod truth, GitHub parity, running image, env/secrets, or go-live evidence -> `o-okul-release-evidence`.
- PR, branch, commit, working-tree, or final gate review -> `o-okul-pr-review`.

## Canonical Surfaces

- `.claude/agents/*.md` is the hand-edited subagent roster (15 agents) and `.claude/skills/*/SKILL.md` is the hand-edited skill set (5 skills). There is no generated copy; edit them directly and run `pnpm agents:check`.
- `.claude/settings.json` carries the shared subagent policy: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`. Personal overrides go to `.claude/settings.local.json`.
- `AGENTS.md` is the governance contract. Claude Code reads it as project instructions because the repo has no `CLAUDE.md`; never add a `CLAUDE.md` or `CLAUDE.local.md`, which would replace it.
- Cursor reads `.claude/agents` and `.claude/skills` natively; `.cursor/skills` holds only vendored third-party skills. Do not recreate `.codex` or `.agents` directories; they would duplicate agent and skill names.
- Project MCP servers belong in `.mcp.json` only for trusted systems with an explicit tool allowlist; none is configured today.

## Delegation Rules

1. Read `AGENTS.md` and `docs/agent-architecture.md` when relevant.
2. Decide whether subagents are useful. Prefer single-agent work for small edits.
3. The concurrent-subagent cap in `.claude/settings.json` excludes the main agent, so the main agent and at most three subagents may participate concurrently.
4. Use no more than three subagents total. If one subagent writes, at most two read-only subagents may remain.
5. Each active gate may have only one write-capable participant. Give explicit owned paths and forbidden paths.
6. If the main agent writes, every subagent must remain read-only.
7. If a subagent writes, the main agent may change files only for integration.
8. Keep depth at one: the spawn-depth cap withholds the Agent tool from subagents, and subagents never spawn their own subagents.
9. Read-only agents run with `permissionMode: plan` and without Write/Edit tools. They still carry Bash, so their prompts say "Stay read-only" and they must not run state-changing commands.
10. Keep the main agent responsible for integration, conflict resolution, final verification, and user-facing summary.
11. Report every result with its evidence class: `LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, or `UNPROVEN`.

## Delegation Prompt Template

```text
Task: <specific outcome>
Role: <agent name>
Owned paths: <files/modules agent may inspect or edit>
Forbidden paths: <unrelated files or active user changes>
Constraints: do not revert unrelated edits; preserve tenant isolation/RBAC/PII/evidence contracts; scope changes need a DEC.
Expected output: findings or changed file list, tests run, evidence class, residual risk.
Validation: <targeted commands>
```

## Agent Routing

- Product scope, K12 roadmap slices, or UAT: `product_scope_planner`
- RLS/RBAC/tenant isolation/tenant-host/license gating review: `tenant_security_reviewer`
- Auth/MFA/session/rate-limit/identity/license implementation: `auth_session_engineer`
- KVKK/PII/consent/retention/upload privacy review: `privacy_governance_reviewer`
- API, shared contracts, domain modules: `backend_api_engineer`
- Web/UI, public pages, Berrak tokens: `frontend_ux_engineer`
- Exam/report/gradebook/worker implementation: `exam_reporting_engineer`
- Prisma/RLS/migrations/backfills: `data_platform_engineer`
- Release/evidence/go-live captain: `ops_release_engineer`
- Docker/Traefik/backup/restore/DR: `infra_dr_engineer`
- Observability/alerting/Sentry/analytics: `observability_sre_engineer`
- SMS/push/e-mail/guardian notification delivery: `messaging_integrations_engineer`
- Tests/e2e/baselines/flakes: `qa_verification_engineer`
- Official documentation verification: `docs_researcher`
- Final review: `pr_gate_reviewer`

## Handoff Contract

Every subagent summary should contain:

- Result: done, blocked, or findings-only.
- Files changed, if any.
- Key findings with file references.
- Tests or commands run, with evidence class.
- Residual risks and follow-up owner.

Do not paste long raw logs into the main thread unless the exact error text is needed for debugging.
