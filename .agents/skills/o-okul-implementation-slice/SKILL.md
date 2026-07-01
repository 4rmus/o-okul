---
name: o-okul-implementation-slice
description: Use when implementing a scoped O-Okul code, test, contract, documentation, or evidence-check change; trigger for "implement", "fix", "inşa et", "tamamla", "uygula", or a planned slice that needs one write owner, dirty-worktree safety, contract updates, and targeted verification.
---

# O-Okul Implementation Slice

Use this skill to land one bounded change.

## Workflow

1. Inspect `git status --short` and relevant files before editing.
2. Choose a single write owner:
   - API/contracts: `backend_api_engineer`.
   - Auth/session: `auth_session_engineer`.
   - Web/UI: `frontend_ux_engineer`.
   - Exam/report/worker: `exam_reporting_engineer`.
   - DB/RLS/migrations: `data_platform_engineer`.
   - Ops/evidence: `ops_release_engineer`.
3. Define owned paths and forbidden paths before delegation or edits.
4. Make the smallest diff that satisfies the request. Reuse existing repo patterns.
5. Update coupled contracts in the same slice:
   - API shape -> `packages/shared-types` and OpenAPI checks.
   - DB/tenant table -> migration, RLS checks, seed impact, DB evidence gates.
   - Production evidence behavior -> scripts, templates, and plan docs.
6. Run the narrowest meaningful verification, then broaden only if the touched surface requires it.

## Guardrails

- Do not stage, revert, overwrite, or format unrelated user changes.
- Use at most one write-capable implementation agent per file area.
- Prefer read-only reviewers for security, privacy, docs, and final review.
- Keep local/static checks separate from staging/prod evidence.

## Output

Return:

- Changed files.
- Behavior changed.
- Tests and commands run.
- Unverified surfaces.
- Residual risk and next owner.
