# Codex Agent Architecture for o-okul

This document defines the project-scoped Codex agent system for building o-okul professionally, securely, and with controlled scope.

## Research Basis

The configuration follows current agent-system patterns from primary sources:

- OpenAI Codex subagents: custom agents live under `.codex/agents`, subagents are explicitly triggered, and parallel work is best for read-heavy exploration, tests, triage, and summarization. Source: https://developers.openai.com/codex/subagents and https://developers.openai.com/codex/concepts/subagents
- OpenAI `AGENTS.md`: repository guidance is loaded from project roots and nested directories, with closer files overriding broader guidance. Source: https://developers.openai.com/codex/guides/agents-md.md
- OpenAI skills: reusable workflows should live in `.agents/skills`, use concise trigger descriptions, and rely on progressive disclosure. Source: https://developers.openai.com/codex/skills.md
- OpenAI Agents SDK guidance: use orchestration, handoffs, guardrails, tracing, and sandbox execution when building agentic systems rather than relying only on prompts. Source: https://developers.openai.com/api/docs/libraries#use-the-agents-sdk
- Google ADK guidance: grow from a monolithic agent to modular workflows when instructions, context, or complexity exceed single-agent reliability; use deterministic sequential, parallel, or loop workflows where possible. Source: https://google.github.io/adk-docs/agents/ and https://google.github.io/adk-docs/agents/workflow-agents/
- Anthropic Claude Code docs: subagents are useful when side tasks would flood the main context, and each subagent should have its own prompt, tool access, and permission boundary. Source: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Microsoft Agent Framework guidance: enterprise agent systems need state, type safety, filters, telemetry, and multi-agent orchestration. Source: https://learn.microsoft.com/en-us/agent-framework/overview/

## Repo Risk Map

o-okul is not a generic CRUD app. The agent split follows the highest-risk seams in the current repo:

- Multi-tenancy and security: PostgreSQL RLS, Prisma tenant context, RBAC, auth/session rotation, MFA, PII/KVKK, upload safety.
- Auth and session hardening: refresh token family rotation, CSRF, admin MFA, rate limits, web token storage, production fail-closed behavior.
- Education domain and product scope: v1 is centered on TXT/DAT optical import, report/karne, portals, payment tracking, communication, and production evidence.
- Exam/report pipeline: RawImport archive, parser config, quarantine, deterministic scoring, ReportSnapshot, worker-driven PDF/Excel/report generation.
- Frontend operational UX: role-aware app screens, portal flows, dense SaaS workflows, accessibility, report visuals, mobile/tablet stability.
- Data platform: Prisma schema, migrations, tenant tables, RLS checks, audit partitioning, seed/live DB behavior.
- Ops/release: CI, production evidence, live-status, UAT, pilot, go-live.
- Infrastructure and DR: Docker Compose, Traefik, off-host backup, WAL archive, restore drill, deployment rollback, region proof.
- Observability and incident readiness: metrics, Sentry, Grafana, Prometheus, Loki, Alloy, alert webhooks, external monitoring.
- Privacy and providers: KVKK inventory, PII minimization, upload AV, retention, SMS/notification provider evidence.
- Verification: focused unit/integration tests, smoke contracts, Playwright reliability, karne visual checks, production-readiness gates.

## Agent Roster

| Agent | Mode | Use When | Owns / Inspects | Key Gates |
|---|---:|---|---|---|
| `product_scope_planner` | read-only | Turning a user goal into phases, UAT, DEC impacts, backlog slices | `docs/MASTER_PLAN.md`, `docs/product-journeys-v1.md`, `docs/DECISIONS.md` | Product/UAT acceptance criteria |
| `tenant_security_reviewer` | read-only | Any auth, RBAC, tenant isolation, PII, evidence safety, or production gate change | `packages/db`, `apps/api/src/auth`, `apps/api/src/rbac`, evidence scripts/docs | `pnpm db:rls:check`, `pnpm web:token-storage:check`, `pnpm prod:evidence:templates:check` |
| `auth_session_engineer` | write-scoped | Refresh/session/MFA/CSRF/rate-limit implementation | `apps/api/src/auth`, `apps/api/src/security`, `apps/web/src/api-client.ts` | Auth vitest, `pnpm web:token-storage:check`, `pnpm admin-mfa:check`, `pnpm rate-limit:check` |
| `backend_api_engineer` | write-scoped | Scoped API, DTO, OpenAPI, adapter, idempotency work | `apps/api/src`, `packages/shared-types`, adapters | API typecheck/tests, `pnpm openapi:generate` |
| `frontend_ux_engineer` | write-scoped | Role-aware screens, list flows, portals, app UX, a11y | `apps/web`, `packages/ui` | Web typecheck, a11y, ux baseline, targeted e2e |
| `exam_reporting_engineer` | write-scoped | Optical import, parser, scoring, report snapshots, worker/PDF/Excel/report charts | `apps/api/src/exam`, `apps/api/src/report`, `apps/worker/src/jobs`, `packages/ui/src/charts.ts` | Worker/API tests, raw/report smokes, karne visual contract |
| `data_platform_engineer` | write-scoped | Prisma schema, migrations, RLS, Postgres stores, audit partitions | `packages/db`, Postgres store adapters | DB tests, RLS checks, tenant DB checks |
| `ops_release_engineer` | write-scoped | Release captain, CI/CD, evidence chain, live-status, UAT, pilot, go-live | `.github`, `scripts/check-*.mjs`, `docs/evidence-templates`, phase-6 docs | ops/prod/evidence gates, live status, go-live checks |
| `infra_dr_engineer` | write-scoped | Docker, Traefik, backup/restore, WAL/off-host backup, rollback, region proof | `docker-compose*.yml`, `docker`, backup/rollback/region scripts | Docker, backup, restore, rollback, region gates |
| `observability_sre_engineer` | write-scoped | Metrics, Sentry, dashboards, alerting, external monitoring, incident readiness | observability app modules, `docker/grafana`, `docker/prometheus`, `docker/loki`, alert/Sentry scripts | observability, external-monitoring, alert, Sentry gates |
| `privacy_governance_reviewer` | read-only | KVKK, PII minimization, retention, upload AV/privacy, privacy evidence | privacy/upload/support/homework/audit modules, privacy evidence scripts | privacy, upload AV, financial retention, security audit gates |
| `messaging_integrations_engineer` | write-scoped | SMS/notification adapters, provider smoke, delivery jobs, templates | SMS/notification packages, announcement/SMS jobs, provider smokes | SMS/notification smoke, env/evidence gates |
| `qa_verification_engineer` | write-scoped tests | Targeted regression design, test gaps, e2e flakes, evidence checkers | tests, Playwright specs, smoke/check scripts | Targeted tests, typecheck, visual/evidence checks |
| `docs_researcher` | read-only | Official framework/API behavior, current docs, version-specific uncertainty | Official docs and local package versions | Cited source summary |
| `pr_gate_reviewer` | read-only | Final branch or working-tree review | Diff, nearby tests, evidence docs | Findings-first review |

## Collaboration Rules

1. The main agent remains the architect of the turn. It decides scope, assigns agents, integrates results, resolves conflicts, and reports the final state.
2. Spawn subagents only when the user explicitly asks for agents/delegation/parallel work or when the task is large enough that isolated exploration prevents context overload.
3. Prefer read-only parallelism. Use parallel write work only with disjoint file ownership.
4. Keep `max_depth = 1`. Subagents should not create further subagent trees.
5. Use small handoffs. Each agent gets a concrete objective, owned paths, forbidden paths, expected output, and validation commands.
6. Subagent output must be a summary: findings, changed files, tests run, residual risk. Long logs stay out of the main thread unless an exact error is needed.
7. The final review should run after integration for high-risk work: security/RLS, report generation, production evidence, schema migrations, and broad UI changes.

## Standard Workflows

### Feature Slice

1. `product_scope_planner` maps the request to personas, UAT IDs, decisions, and acceptance criteria.
2. One implementation agent owns the primary write area.
3. `qa_verification_engineer` designs or updates focused tests.
4. `tenant_security_reviewer` reviews if the change touches tenant data, auth, RBAC, PII, or evidence.
5. `pr_gate_reviewer` performs final findings-first review for risky changes.

### Security or Tenant-Isolation Change

1. `tenant_security_reviewer` identifies the threat model and required gates.
2. `auth_session_engineer`, `data_platform_engineer`, or `backend_api_engineer` implements the scoped fix.
3. `qa_verification_engineer` adds negative tests.
4. Run RLS/RBAC/API gates before broad CI.

### Exam and Report Change

1. `exam_reporting_engineer` owns scoring/parser/report changes.
2. `frontend_ux_engineer` owns report UI only when presentation changes.
3. `qa_verification_engineer` runs worker/API tests and karne visual contracts.
4. Keep comparisons question-count-aware: `Basari %` is the primary cross-exam metric; `Net` and `Soru` remain context.

### Production Gate or Live-Readiness Change

1. `ops_release_engineer` maps the affected evidence contract and owns the release narrative.
2. `infra_dr_engineer`, `observability_sre_engineer`, `messaging_integrations_engineer`, or `privacy_governance_reviewer` owns the domain-specific evidence slice.
3. `tenant_security_reviewer` checks secret, PII, target-path, and placeholder handling.
4. `qa_verification_engineer` adds negative tests for the evidence template/checker.
5. Run `pnpm ops:check`, `pnpm prod:evidence:templates:check`, and `pnpm prod:plan:check`.

## Prompt Examples

```text
Use product_scope_planner and tenant_security_reviewer in parallel. Wait for both.
Goal: evaluate whether the requested guardian finance change fits v1 and preserves tenant/RBAC rules.
Return: scope decision, security risks, required files, and validation commands.
```

```text
Use backend_api_engineer for a scoped implementation.
Owned paths: apps/api/src/payment/**, packages/shared-types/src/domain.ts.
Forbidden paths: apps/web/**, packages/db/**.
Task: add the requested payment-plan status transition and targeted tests.
Validation: pnpm --filter @o-okul/api test; pnpm --filter @o-okul/shared-types typecheck.
```

```text
Use pr_gate_reviewer to review this branch against main.
Focus on tenant isolation, RBAC drift, report correctness, missing tests, and production evidence drift.
Return findings first with file references.
```

## Future Extensions

- Add project hooks only after a deterministic rule is stable enough to enforce mechanically. Good candidates: blocking temp/symlink evidence targets, warning on broad `pnpm run ci` during constrained live-server sessions, and preventing accidental `.env` reads.
- Add MCP servers only for trusted systems that remove manual copy/paste: GitHub issues/PRs, Sentry, Figma, and internal docs. Each MCP server needs a tight tool allowlist and secret policy.
- Package the `.agents/skills` workflow into a Codex plugin only if this agent system needs to be shared across multiple repos.
- Do not add an AI-report-summary product agent until `AI_REPORT_SUMMARY_PROVIDER=disabled` is changed by a new DEC and KVKK/provider review.
