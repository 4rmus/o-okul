# Agent Architecture for o-okul

This document defines the project-scoped agent system for building o-okul professionally, securely, and with controlled scope. Claude Code is the canonical surface; Cursor reads the same files natively.

Last documentation check: 2026-10-10. The Codex surfaces (`.codex/`, `.agents/skills`, the adapter generator, and the OpenAI docs MCP server) were removed on 2026-10-10 by product-owner decision because development continues in Claude Code.

## Canonical Surfaces

| Surface | Edited by | Read by |
|---|---|---|
| `.claude/agents/<file>.md` | hand, 15 project subagents | Claude Code; Cursor (Claude compatibility) |
| `.claude/skills/<name>/SKILL.md` | hand, 5 repo skills | Claude Code; Cursor (Claude compatibility) |
| `.claude/settings.json` | hand, shared subagent policy | Claude Code (committed, team-wide; `.claude/settings.local.json` overrides per person) |
| `AGENTS.md` | hand, governance contract | Claude Code as project instructions; Cursor and other tools that read `AGENTS.md` |
| `.mcp.json` | hand, only when a trusted MCP server is needed | Claude Code project MCP servers (approval prompted per server); none configured today |
| `.cursor/skills/ui-ux-pro-max` | vendored third-party skill | Cursor only; reasoning aid, never a design source of truth |

`pnpm agents:check` (part of `pnpm run ci`) verifies the roster, skill frontmatter, ownership paths, gate commands, the settings caps, the absence of duplicate surfaces, and `.cursor` hygiene. `.gitignore` keeps `.claude/*` local except `agents/`, `skills/`, and `settings.json`.

### Project instructions

Claude Code reads `AGENTS.md` as project instructions only when there is no `CLAUDE.md`, `.claude/CLAUDE.md`, or `CLAUDE.local.md` in the working directory or above it (Claude Code 2.1.277 or later; the default **Project instructions** setting is `claude-md-or-agents-md`). Adding any of those files silently replaces `AGENTS.md`, so the checker fails when one exists. `AGENTS.override.md` and anything under `.agents/` are never read by Claude Code.

### Subagent policy

`.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "3",
    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1"
  }
}
```

- `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` caps running subagents per session (default 20); the Agent tool refuses the fourth spawn. The cap limits subagents and excludes the main agent, so concurrent participation is limited to the main agent and at most three subagents.
- `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` turns nesting off (default 3 since Claude Code 2.1.219); the Agent tool is withheld from subagents, so depth 1 is enforced by the tool, not only by prose.
- Both variables require Claude Code 2.1.217 or later. The settings reference states that only telemetry export variables are ignored in a project `env` block, so these caps apply once each teammate trusts the folder. The runtime effect in this repo is `UNPROVEN` until a session with four spawn attempts is observed.
- The governance rules stay in force regardless of the caps: the total subagent count may not exceed three, the main agent is the sole scope and integration owner, each active gate has one write-capable participant, and if one subagent writes, at most two read-only subagents may remain.

### Agent file format

Each `.claude/agents/<file>.md` uses YAML frontmatter followed by the system prompt body:

- `name` (identity; underscores, matches the file stem) and `description` (when to delegate) are required.
- `model: inherit` keeps the parent model; `effort` is `medium` or `high` per agent.
- Read-only agents set `permissionMode: plan` and `disallowedTools: Write, Edit, NotebookEdit`. They still carry Bash, so their prompt says "Stay read-only" and they must not run state-changing commands. `permissionMode` is ignored when the main conversation runs in `bypassPermissions`, `acceptEdits`, or auto mode; `disallowedTools` still applies.
- Write-scoped agents inherit the full tool set and carry "If no write scope is given", "Default ownership", "Useful gates", and "Final response" sections.
- Ownership bullets are real repository paths or globs; gate bullets are real `pnpm` scripts. `pnpm agents:check` verifies both.
- Skills use `name` and `description` frontmatter per the Agent Skills specification (name 1-64 lowercase characters matching the directory, description up to 1024 characters, file under 500 lines).

## Research Basis

All sources checked 2026-10-10:

- Claude Code project instructions and `AGENTS.md` loading rules: https://code.claude.com/docs/en/memory
- Claude Code subagents: `.claude/agents/*.md` frontmatter (`name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `effort`, `maxTurns`, `skills`, `memory`, `mcpServers`, `omitClaudeMd`), nesting default of three layers, concurrent limit of 20, and `claude plugin validate`: https://code.claude.com/docs/en/sub-agents
- Claude Code environment variables `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`: https://code.claude.com/docs/en/env-vars
- Claude Code settings scopes and the `env` block: https://code.claude.com/docs/en/settings and https://code.claude.com/docs/en/settings-reference
- Claude Code skills: `.claude/skills/<name>/SKILL.md`, listing budget, `claude plugin validate .claude/skills`: https://code.claude.com/docs/en/skills
- Claude Code MCP: `.mcp.json` with a single `mcpServers` object, `type: "http"` for remote servers, `${VAR}` expansion, per-user approval: https://code.claude.com/docs/en/mcp
- Cursor skills and subagents: Cursor reads `.cursor/skills`, `.claude/skills`, `.agents/skills` and `.cursor/agents`, `.claude/agents`; `.cursor` wins on duplicate names: https://cursor.com/docs/context/skills and https://cursor.com/docs/agent/subagents
- Agent Skills specification: https://agentskills.io/specification

## Repo Risk Map

o-okul is not a generic CRUD app. The agent split follows the highest-risk seams in the current repo:

- Multi-tenancy and security: PostgreSQL RLS, Prisma tenant context, composite tenant FKs, RBAC capabilities, tenant-subdomain login, control-plane separation (ADR-0010), auth/session rotation, MFA, PII/KVKK, upload safety.
- Auth, identity, and license: refresh token family rotation, CSRF, admin MFA, rate limits, identity provisioning and invitations, license states (ACTIVE, READ_ONLY, FROZEN, EXPIRED) that gate access without deleting data.
- Education domain and product scope: private K12 primary segment, TXT/DAT optical import, report/karne, separate gradebook context with versioned publication (ADR-0011), e-Okul import and export-list only, portals, payment tracking, communication, production evidence.
- Exam/report pipeline: RawImport archive, parser config, quarantine, deterministic scoring, ReportSnapshot identity, worker-driven PDF/Excel/report generation; `Basari %` for the deneme series only.
- Frontend operational UX: role-aware app screens, portal flows, public pricing/landing pages bound to `docs/marketing-claims.md`, Berrak design tokens, accessibility, report visuals, measurement baselines.
- Data platform: Prisma schema, migrations, tenant tables, RLS checks, audit partitioning and freshness, backfills, tenant reset drills.
- Ops/release: CI, staging workflows, forward-only cutover evidence, live-status, UAT, pilot, go-live.
- Infrastructure and DR: Docker Compose, Traefik, nightly encrypted dumps, TR off-host backup, WAL archive, restore drill, deployment cutover and region proof.
- Observability and incident readiness: metrics, health, Sentry, Grafana, Prometheus, Loki, Alloy, Alertmanager, PII-safe product analytics (ADR-0009), external monitoring.
- Privacy and providers: KVKK inventory, StudentContact consent, PII minimization, upload AV and retention, approved destruction lists, SMS/push/e-mail provider evidence, automatic guardian notifications.
- Verification: focused unit/integration tests, smoke contracts, Playwright reliability, measurement baselines, karne visual checks, production-readiness gates.

## Repo Skill Router

Use the narrowest repo skill before spawning agents:

| Skill | Use When | Default Owners |
|---|---|---|
| `o-okul-planning` | Repo-grounded analysis, roadmap and slice sizing, production planning, UAT/DEC alignment, smallest safe first PR | `product_scope_planner`, read-only reviewers |
| `o-okul-implementation-slice` | One scoped implementation, bug fix, contract update, evidence checker, agent/skill change, or targeted test slice | One write-capable implementation agent |
| `o-okul-release-evidence` | Staging/prod truth, GitHub parity, running image per service, env/secrets, release evidence, go-live gates | `ops_release_engineer` plus domain owner |
| `o-okul-pr-review` | PR, branch, commit, working tree, or final gate review | `pr_gate_reviewer`, targeted read-only reviewers |

`o-okul-agent-orchestration` remains the router for choosing among these skills and formatting delegation prompts.

## Agent Roster

| Agent | Mode | Use When | Owns / Inspects | Key Gates |
|---|---:|---|---|---|
| `product_scope_planner` | read-only | Turning a user goal into slices, UAT, DEC impacts, H1-H3 placement | `status.md`, `docs/DECISIONS.md`, `docs/product-journeys-v1.md`, K12 strategy plan, ADRs | Product/UAT acceptance criteria |
| `tenant_security_reviewer` | read-only | Any auth, RBAC, tenant isolation, tenant-host, identity, license, PII, evidence safety, or production gate change | `packages/db`, `apps/api/src/{auth,security,rbac,tenant,http,identity-*,user-management,license,guardian,upload}`, shared capabilities, web access helper | `pnpm db:rls:check`, `pnpm web:token-storage:check`, `pnpm prod:evidence:templates:check` |
| `auth_session_engineer` | write-scoped | Refresh/session/MFA/CSRF/rate-limit/tenant-host/identity/license implementation | `apps/api/src/{auth,security,identity-*,user-management,license}`, http rate-limit and tenant-host files, `apps/web/src/api-client.ts` | Auth vitest, `pnpm web:token-storage:check`, `pnpm admin-mfa:check`, `pnpm rate-limit:check`, `pnpm tenant-subdomain:preflight` |
| `backend_api_engineer` | write-scoped | Scoped API, DTO, OpenAPI, adapter, idempotency, domain module work | `apps/api/src`, `packages/shared-types`, adapters | API typecheck/tests, `pnpm openapi:generate`, `pnpm openapi:output-contract`, `pnpm idempotency:inventory:check` |
| `frontend_ux_engineer` | write-scoped | Role-aware screens, list flows, portals, public pages, Berrak tokens, a11y | `apps/web`, `packages/ui`, `design.md`, `tokens.css` | Web typecheck, a11y, design tokens, architecture, route manifest, ux baseline, measurement baseline, targeted e2e |
| `exam_reporting_engineer` | write-scoped | Optical import, parser, scoring, report snapshots, gradebook versions, worker/PDF/Excel/report charts | `apps/api/src/{exam,report,gradebook}`, `apps/worker/src/jobs`, `packages/ui/src/charts.ts`, iSEM smokes | Worker/API tests, raw/report smokes, iSEM evidence, karne visual contract |
| `data_platform_engineer` | write-scoped | Prisma schema, migrations, RLS, Postgres stores, backfills, audit partitions, reset drills | `packages/db`, Postgres store adapters, backfill and drill scripts | DB tests, RLS checks, account-management contracts, audit checks, tenant DB checks |
| `ops_release_engineer` | write-scoped | Release captain, CI/CD, staging workflows, evidence chain, live-status, UAT, pilot, go-live | `.github/workflows`, `scripts/check-*.mjs`, `scripts/smoke-*.mjs`, evidence generators, `docs/evidence-templates`, phase-6 docs | ops/prod/evidence gates, staging contracts, live status, go-live checks |
| `infra_dr_engineer` | write-scoped | Docker, Traefik, nightly/off-host/WAL backup, restore, tenant reset, cutover, region proof | `docker-compose*.yml`, `Dockerfile`, `docker/postgres`, operations module, backup/restore/cutover scripts, `apps/hooks-worker` | Docker, backup, restore, cutover, continuity, region gates |
| `observability_sre_engineer` | write-scoped | Metrics, health, Sentry, dashboards, alerting, analytics schema, external monitoring, incident readiness | metrics/observability/health modules, `apps/queue-board`, `docker/{grafana,prometheus,loki,alloy,alertmanager}`, alert/Sentry scripts | observability, external-monitoring, analytics schema, alert, Sentry gates |
| `privacy_governance_reviewer` | read-only | KVKK, PII minimization, consent, retention and destruction, upload AV/privacy, analytics, privacy evidence | privacy/audit/support/homework/student/guardian/upload/license modules, privacy evidence scripts, data lifecycle docs | privacy, sample PII, contact policy, upload AV/retention, financial retention, audit null-tenant gates |
| `messaging_integrations_engineer` | write-scoped | SMS/push/e-mail adapters, announcement and guardian auto-notification jobs, notification gateway, provider smoke | SMS/notification packages, announcement/guardian-notification/message-template/whatsapp-consent modules, delivery jobs, `infra/notification-gateway` | SMS/notification/gateway tests and smokes, outbox evidence, env/evidence gates |
| `qa_verification_engineer` | write-scoped tests | Targeted regression design, test gaps, e2e flakes, measurement baselines, evidence checkers | tests, Playwright specs, fixtures, smoke/check scripts | Targeted tests, typecheck, visual/baseline/evidence checks |
| `docs_researcher` | read-only | Official framework, API, and agent-tooling behavior, current docs, version-specific uncertainty | Official docs, local package versions | Cited source summary with access dates |
| `pr_gate_reviewer` | read-only | Final branch or working-tree review | Diff, nearby tests, evidence docs, agent files | Findings-first review with evidence-class honesty |

## Collaboration Rules

1. The main agent remains the sole scope and integration owner. It assigns agents, resolves conflicts, and reports the final state.
2. Load the narrowest repo skill before spawning agents.
3. Spawn subagents only when the user explicitly asks for agents/delegation/parallel work or when the task is large enough that isolated exploration prevents context overload.
4. Each active gate may have only one write-capable participant. If the main agent writes, no subagent may write. If a subagent writes, the main agent changes no files except for integration.
5. Use no more than three subagents total. If one subagent writes, at most two read-only subagents may remain.
6. Keep spawn depth at 1. Subagents should not create further subagent trees; the settings cap withholds the Agent tool from them.
7. Before a gate starts, record its objective, owned paths, forbidden paths, acceptance criteria, and validation commands.
8. Use small handoffs. Each agent gets a concrete objective, owned paths, forbidden paths, expected output, and validation commands.
9. Subagent output must be a summary: findings, changed files, tests run with evidence class, residual risk. Long logs stay out of the main thread unless an exact error is needed.
10. The final review should run after integration for high-risk work: security/RLS, report generation, gradebook publication, production evidence, schema migrations, and broad UI changes.
11. When a gate completes, report its result and stop; do not automatically continue to the next gate.
12. Report `LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN` separately.
13. Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.
14. A scope change needs a DEC record first; a closed plan slice is recorded in `status.md` "Açık İşler" (plan section 10.1).
15. After editing agents, skills, settings, or MCP files, run `pnpm agents:check` in the same change.

## Standard Workflows

### Feature Slice

1. `product_scope_planner` maps the request to personas, UAT IDs, decisions, slice id, and acceptance criteria.
2. One implementation agent owns the primary write area.
3. `qa_verification_engineer` designs or updates focused tests.
4. `tenant_security_reviewer` reviews if the change touches tenant data, auth, RBAC, PII, license gating, or evidence.
5. `pr_gate_reviewer` performs final findings-first review for risky changes.

### Security or Tenant-Isolation Change

1. `tenant_security_reviewer` identifies the threat model and required gates.
2. `auth_session_engineer`, `data_platform_engineer`, or `backend_api_engineer` implements the scoped fix.
3. `qa_verification_engineer` adds negative tests.
4. Run RLS/RBAC/API gates before broad CI.

### Exam, Gradebook, and Report Change

1. `exam_reporting_engineer` owns scoring/parser/report/gradebook changes; the optical pipeline stays frozen and published grade rows are never updated in place.
2. `frontend_ux_engineer` owns report UI only when presentation changes.
3. `qa_verification_engineer` runs worker/API tests and karne visual contracts.
4. Keep comparisons question-count-aware: `Basari %` is the primary cross-exam metric for the deneme series; `Net` and `Soru` remain context; school grades are a separate series.

### Guardian Communication Change

1. `privacy_governance_reviewer` confirms consent, visibility, and PII rules (DEC-20261003-01, DEC-20261005-02, DEC-20261005-04).
2. `messaging_integrations_engineer` owns delivery jobs and adapters; `backend_api_engineer` owns settings endpoints.
3. `qa_verification_engineer` adds idempotency and license-gating tests.
4. Run notification, gateway, and PII gates before broad CI.

### Production Gate or Live-Readiness Change

1. `ops_release_engineer` maps the affected evidence contract and owns the release narrative.
2. `infra_dr_engineer`, `observability_sre_engineer`, `messaging_integrations_engineer`, or `privacy_governance_reviewer` owns the domain-specific evidence slice.
3. `tenant_security_reviewer` checks secret, PII, target-path, and placeholder handling.
4. `qa_verification_engineer` adds negative tests for the evidence template/checker.
5. Run `pnpm ops:check`, `pnpm prod:evidence:templates:check`, and `pnpm prod:plan:check`.

## Prompt Examples

```text
Use product_scope_planner and tenant_security_reviewer in parallel. Wait for both.
Goal: evaluate whether the requested guardian finance change fits the approved K12 plan and preserves tenant/RBAC/consent rules.
Return: scope decision, security risks, required files, validation commands, evidence classes.
```

```text
Use backend_api_engineer for a scoped implementation.
Owned paths: apps/api/src/payment/**, packages/shared-types/src/payment-due.ts.
Forbidden paths: apps/web/**, packages/db/**.
Task: add the requested payment-plan status transition and targeted tests.
Validation: pnpm --filter @o-okul/api test; pnpm --filter @o-okul/shared-types typecheck.
```

```text
Use pr_gate_reviewer to review this branch against main.
Focus on tenant isolation, RBAC drift, gradebook publication safety, report correctness, missing tests, and production evidence drift.
Return findings first with file references and the evidence class of each cited check.
```

## Future Extensions

- Enforce read-only reviewers mechanically with a `PreToolUse` hook or `permissions.deny` rules (for example `Bash(git push *)`, `Bash(rm *)`) once the rule set is stable; prose instructions are context, not enforcement.
- Add project hooks only after a deterministic rule is stable enough to enforce mechanically. Good candidates: blocking temp/symlink evidence targets, warning on broad `pnpm run ci` during constrained live-server sessions, and preventing accidental `.env` reads. Per-agent `hooks` frontmatter scopes a hook to one subagent.
- Add MCP servers to `.mcp.json` only for trusted systems that remove manual copy/paste (GitHub, Sentry, Figma, internal docs). Each server needs `type: "http"`, a `${VAR}` header for credentials, and a tool allowlist; `pnpm agents:check` rejects inline secrets.
- Move path-specific rules (for example report visuals or RLS checklists) into `.claude/rules/` with `paths` frontmatter when `AGENTS.md` grows past what every session needs.
