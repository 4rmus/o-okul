---
name: o-okul-implementation-slice
description: Use when implementing a scoped O-Okul code, test, contract, documentation, agent/skill, or evidence-check change; trigger for "implement", "fix", "inşa et", "tamamla", "uygula", a slice id such as KF-9 or KV-8, or a planned slice that needs one write owner, dirty-worktree safety, contract updates, and targeted verification.
---
# O-Okul Implementation Slice

Use this skill to land one bounded change.

## Workflow

1. Inspect `git status --short` and relevant files before editing.
2. Confirm the slice is backed by an approved DEC or plan entry; if it changes scope, stop and route to `o-okul-planning`.
3. Choose a single write owner:
   - API/contracts/domain modules: `backend_api_engineer`.
   - Auth/session/identity/license: `auth_session_engineer`.
   - Web/UI/public pages: `frontend_ux_engineer`.
   - Exam/report/gradebook/worker: `exam_reporting_engineer`.
   - DB/RLS/migrations/backfills: `data_platform_engineer`.
   - SMS/push/notification delivery: `messaging_integrations_engineer`.
   - Docker/backup/restore/DR: `infra_dr_engineer`.
   - Metrics/alerting/Sentry: `observability_sre_engineer`.
   - CI/CD, release evidence, go-live gates: `ops_release_engineer`.
   - Tests and evidence checkers only: `qa_verification_engineer`.
4. Define owned paths and forbidden paths before delegation or edits.
5. Make the smallest diff that satisfies the request. Reuse existing repo patterns.
6. Update coupled contracts in the same slice:
   - API shape -> `packages/shared-types` and OpenAPI output contract.
   - DB/tenant table -> migration, RLS checks, seed impact, tenant-models parity, DB evidence gates.
   - Production evidence behavior -> scripts, templates, and plan docs.
   - Agent, skill, settings, or MCP definition -> `pnpm agents:check`.
   - UI-affecting change -> Gate B measurement baseline refresh.
7. Run the narrowest meaningful verification, then broaden only if the touched surface requires it.
8. When a plan slice closes, add its row to `status.md` "Açık İşler" with date, slice id, evidence class, and SHA/PR.

## Guardrails

- Do not stage, revert, overwrite, or format unrelated user changes.
- Use at most one write-capable participant per gate; keep the main agent as integration owner.
- Prefer read-only reviewers for security, privacy, docs, and final review.
- Keep local/static checks separate from CI, staging, and production evidence.
- Deploys, provider actions, secret/config changes, DB/data mutations, and mutating smokes require explicit user approval.

## Output

Return:

- Changed files.
- Behavior changed.
- Tests and commands run, each with its evidence class.
- Unverified surfaces.
- Residual risk and next owner.
