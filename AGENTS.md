# AGENTS.md

## Repository Expectations

- Use Node >= 22 and pnpm 11.5.0.
- Treat this as a production-bound multi-tenant education SaaS. Tenant isolation, RBAC, PII safety, report reproducibility, and release evidence are product requirements, not cleanup work.
- Keep dirty-worktree boundaries strict. Do not revert, overwrite, stage, or commit unrelated user changes.
- Prefer existing monorepo patterns over new abstractions: Next.js app router in `apps/web`, NestJS-style API modules in `apps/api`, BullMQ workers in `apps/worker`, Prisma/RLS in `packages/db`, shared Zod/types in `packages/shared-types`, and shared UI in `packages/ui`.
- When API contracts change, update `packages/shared-types` and relevant OpenAPI checks with the implementation.
- When DB schema or tenant tables change, update migrations, RLS checks, seed impact, and DB evidence gates together.
- When production evidence behavior changes, update the scripts, templates, and plan docs in the same scoped change.

## Subagent Orchestration

- Project custom agents live in `.codex/agents`.
- Use subagents only when the user asks for agents, delegation, parallel review, or a large task that benefits from isolated exploration.
- Keep `agents.max_depth = 1`; the main agent owns orchestration, integration, conflict resolution, and final delivery.
- Prefer read-only parallel agents for exploration, security review, docs research, and PR review.
- Use at most one write-capable implementation agent for a given file area. Parallel write work must have disjoint ownership.
- Every delegated task needs: objective, owned paths, forbidden paths, expected output, and validation commands.
- Subagent summaries should return findings and changed files, not raw logs.

## Agent Roster

- `product_scope_planner`: scope, UAT, DEC/backlog slicing.
- `tenant_security_reviewer`: RLS, RBAC, auth/session, KVKK/PII, production security gates.
- `auth_session_engineer`: auth, refresh sessions, CSRF, MFA, rate limits, token-storage hardening.
- `backend_api_engineer`: scoped NestJS API, shared contracts, adapters, idempotency.
- `frontend_ux_engineer`: scoped Next.js/UI work, role-aware screens, a11y and report UX.
- `exam_reporting_engineer`: raw import, parser config, scoring, report snapshots, worker jobs, karne analytics.
- `data_platform_engineer`: Prisma, migrations, RLS policies, Postgres stores, audit partitioning.
- `ops_release_engineer`: release captain for CI/CD, evidence chain, live-status, UAT, pilot, go-live gates.
- `infra_dr_engineer`: Docker/Traefik infrastructure, backup/restore, WAL/off-host backup, rollback drills.
- `observability_sre_engineer`: metrics, Sentry, Grafana/Prometheus/Loki/Alloy, alerting, external monitoring.
- `privacy_governance_reviewer`: KVKK, PII minimization, retention, AV/upload privacy, privacy evidence.
- `messaging_integrations_engineer`: SMS, notification adapters, delivery jobs, provider smoke evidence.
- `qa_verification_engineer`: targeted tests, Playwright flows, flakes, evidence-backed acceptance.
- `docs_researcher`: official docs and version-specific behavior.
- `pr_gate_reviewer`: final correctness/security/test/release-gate review.

## Validation By Scope

- API: `pnpm --filter @o-okul/api typecheck`, `pnpm --filter @o-okul/api test`, `pnpm openapi:generate`.
- Web/UI: `pnpm --filter @o-okul/web typecheck`, `pnpm web:a11y:check`, `pnpm web:ux-baseline:check`.
- Worker/report: `pnpm --filter @o-okul/worker test`, `pnpm raw-import:smoke`, `pnpm report-generation:smoke`, `pnpm karne:visual-contract:check`.
- DB/RLS: `pnpm --filter @o-okul/db test`, `pnpm db:rls:check`, `pnpm audit-log-partition:check`, `pnpm tenant-db:check`.
- Auth/security: `pnpm web:token-storage:check`, `pnpm admin-mfa:check`, `pnpm rate-limit:check`, `pnpm security:audit:check`.
- Provider/privacy: `pnpm sms:smoke`, `pnpm notification:smoke`, `pnpm privacy:inventory:check`, `pnpm upload-av:check`, `pnpm financial-retention:check`.
- Ops/release: `pnpm ops:check`, `pnpm prod:evidence:templates:check`, `pnpm prod:plan:check`, `pnpm prod:env:check`.
- Full release candidate: `pnpm run ci` plus the live/staging evidence gates listed in `docs/phase-6-production-readiness.md`.

## Review Guidelines

- Lead with concrete P0/P1 findings: cross-tenant exposure, auth/session bypass, data loss, PII leakage, incorrect reports, broken idempotency, unsafe production evidence, and missing tests for changed behavior.
- Treat local/static PASS evidence as different from real staging/prod evidence.
- For report visuals across exams with different question counts, use `Basari %` / success-rate comparison as the primary metric and retain `Net`/`Soru` as context.
