---
name: o-okul-release-evidence
description: Use when checking O-Okul staging, production, deploy, GitHub parity, running image tags, live health, release evidence, env/secrets, rollback, pilot, go-live, or "main ile senkron mu"; separates static repo gates from real staging/prod runtime evidence.
---

# O-Okul Release Evidence

Use this skill for deploy truth and production-readiness evidence.

## Workflow

1. Identify the question:
   - GitHub parity.
   - Staging deploy activation.
   - Production runtime truth.
   - Evidence/env/secret gap.
   - Rollback, pilot, or go-live gate.
2. Read `AGENTS.md`, `docs/codex-agent-architecture.md`, and `docs/phase-6-production-readiness.md`.
3. Keep evidence classes separate:
   - Static/local: repo scripts, templates, typecheck, contract checks.
   - CI/GitHub: branch, PR, workflow run, artifact.
   - Live runtime: host checkout, Docker image tag/id, public `/health`, `/health/ready`, `/login`.
4. Prefer authoritative runtime proof over green badges:
   - `git rev-list --left-right --count HEAD...origin/main`.
   - Docker compose service status and image tag/id.
   - Public endpoint checks.
   - Evidence JSON/template validators.
5. Never print secrets. Treat placeholder, temp path, local-only URL, or noop provider evidence as not production-ready.

## Agent Routing

- Release/evidence: `ops_release_engineer`.
- Docker/Traefik/backup/rollback: `infra_dr_engineer`.
- Metrics/Sentry/alerts: `observability_sre_engineer`.
- SMS/notification: `messaging_integrations_engineer`.
- RLS/auth/privacy risk: read-only reviewers first.

## Output

Return:

- Static repo status.
- CI/GitHub status.
- Live runtime status.
- Exact blockers.
- Commands run.
- Next action with owner.

Do not call a deployment complete unless the running image/runtime evidence matches the target commit.
