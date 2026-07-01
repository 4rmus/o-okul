---
name: o-okul-planning
description: Use when turning O-Okul product, architecture, production-readiness, modernization, UI/UX, security, or operations requests into repo-grounded plans; trigger for "analiz et", "planla", "production", "prod seviyesine getir", roadmap, UAT/DEC alignment, risk slicing, or smallest safe first PR before coding.
---

# O-Okul Planning

Use this skill to produce a plan, not implementation.

## Workflow

1. Read `AGENTS.md` and `docs/codex-agent-architecture.md`.
2. Read only the task-relevant truth files:
   - Product scope: `docs/product-journeys-v1.md`, `docs/DECISIONS.md`, `docs/MASTER_PLAN.md`.
   - Production readiness: `docs/phase-6-production-readiness.md`, `docs/phase-6-ops-runbook.md`.
   - UI/UX: `docs/ui-ux-professionalization-contract.md`, `docs/ui-ux-redesign-plan.md`.
   - Modernization: `docs/production-v1-modernization-plan-2026-06-27.md`.
3. State assumptions, unknowns, and product decisions separately from implementation gaps.
4. Map the request to modules, UAT IDs, DEC records, owner agents, validation commands, and acceptance criteria.
5. Split large work into small, reversible slices. End with the smallest safe first PR.

## Agent Routing

- Use `product_scope_planner` for scope, UAT, DEC, and backlog slicing.
- Use read-only reviewers for security, privacy, docs, or PR risk discovery.
- Use implementation agents only after the plan selects a concrete write slice.
- Keep `max_depth=1`; use 1-4 agents only when parallel discovery materially helps.

## Output

Return:

- Assumptions and uncertainties.
- Current repo state with file references.
- P0/P1 risks.
- Phased plan with owner agents.
- Test and evidence commands.
- Smallest safe first PR.

Always separate local/static PASS evidence from real staging/prod evidence.
