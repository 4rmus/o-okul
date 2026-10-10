# Codex Agent Architecture for o-okul

This document defines the project-scoped agent system for building o-okul professionally, securely, and with controlled scope. Codex is the canonical surface; Claude Code and Cursor consume generated or natively-read adapters.

Last documentation check: 2026-10-10.

## Canonical Surfaces

Codex is the canonical agent and skill surface for this repo:

- `.codex/agents/*.toml` defines the 15 project custom agents (required fields `name`, `description`, `developer_instructions`; optional `model_reasoning_effort`, `sandbox_mode`, per-agent `[mcp_servers.<id>]`).
- `.agents/skills/**/SKILL.md` defines the five reusable repo workflows; each routed skill carries `agents/openai.yaml` UI metadata.
- `.codex/config.toml` defines the project subagent limits and MCP configuration.
- `AGENTS.md` is the governance contract Codex loads from the project root (32 KiB default `project_doc_max_bytes`).

Adapter surfaces are derived, never hand-edited:

| Surface | Produced by | Read by |
|---|---|---|
| `.claude/agents/<file>.md` | `scripts/generate-agent-adapters.mjs` from `.codex/agents/*.toml` | Claude Code project subagents; Cursor (Claude compatibility) |
| `.claude/skills/<name>/SKILL.md` | same generator from `.agents/skills/<name>/SKILL.md` | Claude Code project skills; Cursor (Claude compatibility) |
| `.mcp.json` | same generator from `[mcp_servers.*]` in `.codex/config.toml` | Claude Code project MCP servers (approval prompted per server) |
| `.agents/skills` | hand-edited canonical source | Codex and Cursor natively |
| `.codex/agents` | hand-edited canonical source | Codex and Cursor natively |
| `.cursor/skills/ui-ux-pro-max` | vendored third-party skill | Cursor only; reasoning aid, never a design source of truth |

Run `pnpm agents:generate` after editing any agent, skill, or MCP definition; `pnpm agents:check` (part of `pnpm run ci`) fails on adapter drift, missing ownership paths, unknown gate commands, roster mismatches, and compiled Python artifacts under `.cursor`.

Adapter mapping rules:

- Codex `sandbox_mode = "read-only"` becomes Claude `permissionMode: plan` plus `disallowedTools: Write, Edit, NotebookEdit`; write-scoped agents inherit the parent tool set.
- Codex `model_reasoning_effort` maps to Claude `effort`; `model` is always `inherit`.
- Only enabled streamable HTTP MCP servers are mirrored into `.mcp.json` as `type: "http"`; secrets never enter either file (`bearer_token_env_var` on the Codex side only).
- `.gitignore` keeps `.claude/*` local except the generated `agents/` and `skills/` directories.
- Claude Code does not read `.agents/skills` natively; the `claude` CLI only offers a one-time import that copies that directory into `.claude/skills` (verified against Claude Code 2.1.296 on 2026-10-10), which is why the generator commits the copies. Cursor reads both `.agents/skills` and `.claude/skills`; whether it de-duplicates the identical copies by name is `UNPROVEN`. If Cursor lists a repo skill twice, disable the `.claude/skills` entries in Cursor's skill settings instead of deleting the generated files.
- `claude plugin validate .claude/agents` and `claude plugin validate .claude/skills` (Claude Code 2.1.233 or later) validate the generated frontmatter.

## Local Safety Contract

Local workspace commands use the following fail-closed project defaults:

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = false
```

Writes stay inside the workspace, commands cannot use the network, and actions outside the granted boundary require approval.

## Concurrency Contract

```toml
[agents]
max_concurrent_threads_per_session = 3
max_depth = 1
job_max_runtime_seconds = 1800
```

`max_concurrent_threads_per_session` is the canonical key in the current Codex config reference; `max_threads` is the legacy alias and is rejected by `pnpm agents:check`. The limit limits subagents and excludes the main agent, so concurrent participation is limited to the main agent and at most three subagents. The total subagent count may not exceed three. The main agent is the sole scope and integration owner. Each active gate has one write-capable participant. If one subagent writes, at most two read-only subagents may remain.

`max_depth` and `job_max_runtime_seconds` are not listed in the current config reference. They stay in the file as governance declarations carried over from the `codex-cli 0.142.x` era; depth 1 and bounded runtimes are enforced procedurally by `AGENTS.md` and the delegation template, and the client-side effect of these two keys is `UNPROVEN`. If a local Codex client rejects the canonical concurrency key, report the client version before falling back to the alias.

## Research Basis

The configuration follows the current primary sources (all checked 2026-10-10; `developers.openai.com/codex/*` paths now redirect to `learn.chatgpt.com/docs/*`):

- Codex config reference: `[agents]` keys `enabled`, `max_concurrent_threads_per_session` (legacy alias `max_threads`), `default_subagent_model`, `default_subagent_reasoning_effort`; `[mcp_servers.<id>]` keys `url`, `enabled`, `required`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled_tools`, `disabled_tools`, `bearer_token_env_var`. Source: https://learn.chatgpt.com/docs/config-file/config-reference
- Codex custom agents: one TOML per agent under `.codex/agents`, `name` is the identity, `description` guides selection, `developer_instructions` is the prompt, `sandbox_mode` and `mcp_servers` inherit from the parent when omitted; built-ins `default`, `worker`, `explorer`; parallel work is best for read-heavy exploration, tests, triage, and summarization. Source: https://learn.chatgpt.com/docs/agent-configuration/subagents
- Codex skills: `.agents/skills` from the working directory up to the repo root, `name` and `description` frontmatter, optional `agents/openai.yaml` with `interface`, `policy.allow_implicit_invocation`, and `dependencies.tools`; the skills catalog is capped at 2% of the context window, so trigger words go first in descriptions. Source: https://learn.chatgpt.com/docs/build-skills
- Codex MCP: streamable HTTP servers use `url`, headers come from `http_headers`/`env_http_headers`, secrets from `bearer_token_env_var`; the OpenAI docs server endpoint `https://developers.openai.com/mcp` answers MCP `initialize` (verified 2026-10-10). Source: https://learn.chatgpt.com/docs/extend/mcp
- Codex `AGENTS.md`: loaded from the project root down to the working directory, closer files override, `AGENTS.override.md` wins per directory, 32 KiB default budget. Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- Claude Code subagents: `.claude/agents/*.md` with YAML frontmatter (`name`, `description` required; `tools`, `disallowedTools`, `model`, `permissionMode`, `effort`, `maxTurns`, `skills`, `memory`, `mcpServers`), body is the system prompt. Source: https://code.claude.com/docs/en/sub-agents
- Claude Code skills and MCP: `.claude/skills/<name>/SKILL.md`; `.mcp.json` with a single `mcpServers` object and `type: "http"` for remote servers, project servers need per-user approval. Sources: https://code.claude.com/docs/en/skills and https://code.claude.com/docs/en/mcp
- Cursor skills and subagents: Cursor reads `.agents/skills`, `.cursor/skills`, `.claude/skills`, `.codex/skills` and `.cursor/agents`, `.claude/agents`, `.codex/agents`; `name` must match the folder. Sources: https://cursor.com/docs/context/skills and https://cursor.com/docs/agent/subagents
- Agent Skills specification: `name` 1-64 lowercase characters with single hyphens matching the directory, `description` 1-1024 characters, `SKILL.md` under 500 lines, `scripts/`, `references/`, `assets/` conventions. Source: https://agentskills.io/specification

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

`o-okul-agent-orchestration` remains the compatibility router for choosing among these skills, formatting delegation prompts, and regenerating adapters.

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
| `docs_researcher` | read-only | Official framework, API, and agent-tooling behavior, current docs, version-specific uncertainty | Official docs, OpenAI docs MCP, local package versions | Cited source summary with access dates |
| `pr_gate_reviewer` | read-only | Final branch or working-tree review | Diff, nearby tests, evidence docs, generated adapters | Findings-first review with evidence-class honesty |

## Collaboration Rules

1. The main agent remains the sole scope and integration owner. It assigns agents, resolves conflicts, and reports the final state.
2. Load the narrowest repo skill before spawning agents.
3. Spawn subagents only when the user explicitly asks for agents/delegation/parallel work or when the task is large enough that isolated exploration prevents context overload.
4. Each active gate may have only one write-capable participant. If the main agent writes, no subagent may write. If a subagent writes, the main agent changes no files except for integration.
5. Use no more than three subagents total. If one subagent writes, at most two read-only subagents may remain.
6. Keep `max_depth = 1`. Subagents should not create further subagent trees.
7. Before a gate starts, record its objective, owned paths, forbidden paths, acceptance criteria, and validation commands.
8. Use small handoffs. Each agent gets a concrete objective, owned paths, forbidden paths, expected output, and validation commands.
9. Subagent output must be a summary: findings, changed files, tests run with evidence class, residual risk. Long logs stay out of the main thread unless an exact error is needed.
10. The final review should run after integration for high-risk work: security/RLS, report generation, gradebook publication, production evidence, schema migrations, and broad UI changes.
11. When a gate completes, report its result and stop; do not automatically continue to the next gate.
12. Report `LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, and `UNPROVEN` separately.
13. Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.
14. A scope change needs a DEC record first; a closed plan slice is recorded in `status.md` "Açık İşler" (plan section 10.1).
15. After editing agents, skills, or MCP settings, run `pnpm agents:generate` and `pnpm agents:check` in the same change.

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

- Add project hooks only after a deterministic rule is stable enough to enforce mechanically. Good candidates: blocking temp/symlink evidence targets, warning on broad `pnpm run ci` during constrained live-server sessions, and preventing accidental `.env` reads. Codex exposes `hooks.<Event>` (including `SubagentStart`/`SubagentStop`); Claude Code exposes per-agent `hooks` frontmatter.
- Add MCP servers only for trusted systems that remove manual copy/paste: GitHub issues/PRs, Sentry, Figma, and internal docs. Each server needs `enabled_tools` allowlists, `bearer_token_env_var` secrets, and a mirrored `.mcp.json` entry produced by the generator.
- Package the `.agents/skills` workflow into a Codex plugin only if this agent system needs to be shared across multiple repos.
- Migrate the retained `max_depth` and `job_max_runtime_seconds` keys to documented equivalents when the Codex config reference adds them, or remove them when a client version rejects unknown `[agents]` keys.
