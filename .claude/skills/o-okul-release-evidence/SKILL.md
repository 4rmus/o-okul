---
name: o-okul-release-evidence
description: Use when checking O-Okul staging, production, deploy, GitHub parity, running image tags, four-service image parity, live health, release evidence, env/secrets, GitHub environment contracts, rollback or forward-only cutover, pilot, go-live, or "main ile senkron mu"; separates static repo gates from real CI, staging, and production runtime evidence.
---
<!-- GENERATED FILE - do not edit by hand. Source: .agents/skills/o-okul-release-evidence/SKILL.md. Regenerate with `pnpm agents:generate`. -->

# O-Okul Release Evidence

Use this skill for deploy truth and production-readiness evidence.

## Workflow

1. Identify the question:
   - GitHub parity.
   - Staging deploy activation.
   - Production runtime truth.
   - Evidence/env/secret gap.
   - Rollback, forward-only cutover, pilot, or go-live gate.
2. Read `AGENTS.md`, `docs/codex-agent-architecture.md`, `docs/phase-6-production-readiness.md`, and the release sections of `status.md`.
3. Keep evidence classes separate and name them explicitly:
   - `LOCAL_STATIC` / `LOCAL_TEST`: repo scripts, templates, typecheck, contract checks, local test runs.
   - `CI`: branch, PR, workflow run, artifact (`ci.yml`, `staging-deploy.yml`, `staging-role-uat.yml`, `staging-outbox-verify.yml`).
   - `STAGING` / `PRODUCTION`: host checkout, Docker image tag/id for web, API, worker, and queue-board, public `/health`, `/health/ready`, `/login`.
   - `EXTERNAL_NOT_RUN` / `UNPROVEN`: provider, pilot, or go-live steps that were not executed.
4. Prefer authoritative runtime proof over green badges:
   - `git rev-list --left-right --count HEAD...origin/main`.
   - Docker compose service status and exact-SHA image tag/id for all four services.
   - Public endpoint checks.
   - Evidence JSON/template validators and gap summaries (`pnpm staging:release-gaps:summary`, `pnpm staging:github-env:gaps:summary`).
5. Follow the forward-only readiness strategy (DEC-20260823-01): exact-SHA cutover, four-service image parity, public health/readiness, and a restore from a real backup stay mandatory; an old-product rollback rehearsal is not.
6. Never print secrets. Treat placeholder, temp path, local-only URL, or noop provider evidence as not production-ready.

## Agent Routing

- Release/evidence: `ops_release_engineer`.
- Docker/Traefik/backup/restore/cutover: `infra_dr_engineer`.
- Metrics/Sentry/alerts: `observability_sre_engineer`.
- SMS/push/notification: `messaging_integrations_engineer`.
- RLS/auth/privacy risk: read-only reviewers first.

## Output

Return:

- Static/local repo status.
- CI/GitHub status.
- Live runtime status with the running image tag per service.
- Exact blockers.
- Commands run.
- Next action with owner.

Do not call a deployment complete unless the running image/runtime evidence matches the target commit for all four services.
