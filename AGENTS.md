# AGENTS.md

## Repository Expectations

- Use Node >= 22 and pnpm 11.5.0.
- Treat this as a production-bound multi-tenant education SaaS. Tenant isolation, RBAC, PII safety, report reproducibility, and release evidence are product requirements, not cleanup work.
- The primary segment is private K12 schools with dershane secondary (`docs/ozel-k12-strateji-ve-yol-haritasi-plan.md`). A scope change needs a new DEC record in `docs/DECISIONS.md` before implementation.
- Keep dirty-worktree boundaries strict. Do not revert, overwrite, stage, or commit unrelated user changes.
- Prefer existing monorepo patterns over new abstractions: Next.js app router in `apps/web`, NestJS-style API modules in `apps/api`, BullMQ workers in `apps/worker`, BullMQ visibility in `apps/queue-board`, the edge hook surface in `apps/hooks-worker`, Prisma/RLS in `packages/db`, shared Zod/types in `packages/shared-types`, and shared UI in `packages/ui`.
- When API contracts change, update `packages/shared-types` and relevant OpenAPI checks with the implementation.
- When DB schema or tenant tables change, update migrations, RLS checks, seed impact, and DB evidence gates together.
- When production evidence behavior changes, update the scripts, templates, and plan docs in the same scoped change.
- The optical pipeline and `ReportSnapshot` contract stay frozen; published grade rows are never updated in place (ADR-0011); `Basari %` is the cross-exam metric for the deneme series only.
- The design source of truth is the Berrak system in `design.md`, `tokens.css`, and `docs/ui-ux-professionalization-contract.md`.

## Subagent Orchestration

- Project custom agents live in `.codex/agents`.
- Project repo skills live in `.agents/skills`; Codex is the canonical agent/skill source for this repo.
- Use the narrowest repo skill first: `o-okul-planning`, `o-okul-implementation-slice`, `o-okul-release-evidence`, or `o-okul-pr-review`.
- `.claude/agents`, `.claude/skills`, and `.mcp.json` are generated adapter surfaces. Run `pnpm agents:generate` after editing any agent, skill, or MCP definition and never edit them by hand; `pnpm agents:check` fails on drift.
- Cursor reads `.agents/skills`, `.codex/agents`, and `.claude/agents` natively; `.cursor/skills` holds only vendored third-party skills and is not a source of truth.
- Use subagents only when the user asks for agents, delegation, parallel review, or a large task that benefits from isolated exploration.
- `.codex/config.toml` sets `agents.max_concurrent_threads_per_session = 3`; it limits subagents and excludes the main agent, so the main agent and at most three subagents may participate concurrently.
- Keep `agents.max_depth = 1`; the main agent is the sole scope and integration owner and retains conflict resolution and final delivery. Subagents never spawn subagents.
- Each active gate may have only one write-capable participant.
- If the main agent writes, no subagent may write.
- If a subagent writes, the main agent changes no files except for integration.
- Use no more than three subagents total. If one subagent writes, at most two read-only subagents may remain.
- Before every gate starts, define its objective, owned paths, forbidden paths, acceptance criteria, and validation commands.
- When a gate completes, report its result and stop; do not automatically continue to the next gate.
- Report `LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN` as separate evidence classes.
- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.
- Every delegated task needs: objective, owned paths, forbidden paths, expected output, and validation commands.
- Subagent summaries should return findings and changed files, not raw logs.
- When a plan slice closes, record it in `status.md` "Açık İşler" with date, slice id, evidence class, and SHA/PR.

## Agent Roster

- `product_scope_planner`: scope, private K12 roadmap slices (KF/KV/AK/PO), UAT, DEC/ADR alignment.
- `tenant_security_reviewer`: RLS, RBAC capabilities, auth/session, tenant-host, identity and license gating, KVKK/PII, production security gates.
- `auth_session_engineer`: auth, refresh sessions, CSRF, MFA, rate limits, tenant-host resolution, identity provisioning, license state, token-storage hardening.
- `backend_api_engineer`: scoped NestJS API modules, shared contracts, adapters, idempotency, read models.
- `frontend_ux_engineer`: scoped Next.js/UI work, role-aware screens, public pricing/landing pages, Berrak tokens, a11y and report UX.
- `exam_reporting_engineer`: raw import, parser config, scoring, report snapshots, gradebook publication versions, worker jobs, karne analytics.
- `data_platform_engineer`: Prisma, migrations, RLS policies, Postgres stores, backfills, audit partitioning, tenant reset drills.
- `ops_release_engineer`: release captain for CI/CD, staging workflows, evidence chain, live-status, UAT, pilot, go-live gates.
- `infra_dr_engineer`: Docker/Traefik infrastructure, nightly encrypted and off-host backup, WAL archive, restore and rollback/cutover drills.
- `observability_sre_engineer`: metrics, health, Sentry, Grafana/Prometheus/Loki/Alloy/Alertmanager, PII-safe analytics, external monitoring.
- `privacy_governance_reviewer`: KVKK, PII minimization, consent, retention and destruction, AV/upload privacy, privacy evidence.
- `messaging_integrations_engineer`: SMS, push, e-mail, guardian auto-notifications, delivery jobs, notification gateway, provider smoke evidence.
- `qa_verification_engineer`: targeted tests, Playwright flows, measurement baselines, flakes, evidence-backed acceptance.
- `docs_researcher`: official docs and version-specific behavior for frameworks and agent tooling.
- `pr_gate_reviewer`: final correctness/security/test/evidence-class/release-gate review.

## Validation By Scope

- Agents/skills/adapters: `pnpm agents:generate`, `pnpm agents:check`.
- API: `pnpm --filter @o-okul/api typecheck`, `pnpm --filter @o-okul/api test`, `pnpm openapi:generate`, `pnpm openapi:output-contract`, `pnpm idempotency:inventory:check`.
- Web/UI: `pnpm --filter @o-okul/web typecheck`, `pnpm web:a11y:check`, `pnpm web:design-tokens:check`, `pnpm web:architecture:check`, `pnpm route-manifest:check`, `pnpm web:ux-baseline:check`, `pnpm web:measurement-baseline:check`; `pnpm web:ux-rc:check` for UI-affecting release candidates.
- Worker/report: `pnpm --filter @o-okul/worker test`, `pnpm raw-import:smoke`, `pnpm report-generation:smoke`, `pnpm karne:visual-contract:check`, `pnpm isem-optical-pipeline:evidence-check`.
- DB/RLS: `pnpm --filter @o-okul/db test`, `pnpm db:rls:check`, `pnpm db:account-management:check`, `pnpm audit-log-partition:check`, `pnpm audit-log-freshness:check`, `pnpm tenant-db:check`.
- Auth/security: `pnpm web:token-storage:check`, `pnpm web:auth-contract:check`, `pnpm admin-mfa:check`, `pnpm rate-limit:check`, `pnpm tenant-subdomain:preflight`, `pnpm security:audit:check`.
- Provider/privacy: `pnpm sms:smoke`, `pnpm notification:smoke`, `pnpm notification-gateway:test`, `pnpm privacy:inventory:check`, `pnpm privacy:sample-pii:check`, `pnpm pii:contact-policy:check`, `pnpm upload-av:check`, `pnpm upload-retention:check`, `pnpm financial-retention:check`.
- Ops/release: `pnpm ops:check`, `pnpm docker:check`, `pnpm prod:evidence:templates:check`, `pnpm prod:plan:check`, `pnpm prod:env:check`, `pnpm github-ci:check`, `pnpm deployment:continuity:check`, `pnpm go-live:check`.
- Full release candidate: `pnpm run ci` plus the live/staging evidence gates listed in `docs/phase-6-production-readiness.md`.

## Review Guidelines

- Lead with concrete P0/P1 findings: cross-tenant exposure, auth/session bypass, data loss, PII leakage, incorrect reports, broken idempotency, unsafe production evidence, and missing tests for changed behavior.
- Treat local/static PASS evidence as different from real staging/prod evidence.
- For report visuals across exams with different question counts, use `Basari %` / success-rate comparison as the primary metric and retain `Net`/`Soru` as context; school grades are a separate series.
- Flag any in-place update of a published grade row, any automatic data destruction on license expiry, and any guardian-facing payload that ignores consent or `canViewFinance`.
- Flag public-page claims beyond `docs/marketing-claims.md`, including "e-Okul entegrasyonu" and TR hosting claims before the K-6 legal answer.
