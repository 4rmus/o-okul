---
name: o-okul-planning
description: Use when turning O-Okul product, private K12 roadmap, architecture, production-readiness, modernization, UI/UX, security, or operations requests into repo-grounded plans; trigger for "analiz et", "planla", "production", "prod seviyesine getir", roadmap, UAT/DEC alignment, H1-H3 slice sizing, risk slicing, or smallest safe first PR before coding.
---
# O-Okul Planning

Use this skill to produce a plan, not implementation.

## Workflow

1. Read `AGENTS.md` and `docs/agent-architecture.md`.
2. Read only the task-relevant truth files, in the truth order from `docs/llm-wiki/README.md`:
   - Product scope and decisions: `docs/DECISIONS.md`, `docs/product-journeys-v1.md`, `docs/marketing-claims.md`, `status.md`.
   - Roadmap and slices: `docs/ozel-k12-strateji-ve-yol-haritasi-plan.md` (approved H1-H3 cut order, slice ids `KF-*`, `KV-*`, `AK-*`, `PO-*`) and `docs/ozel-k12-strateji-ekleri.md`.
   - Accounts, identity, license: `docs/account-management-architecture-plan.md`, `docs/tenant-subdomain-login-architecture-plan.md`.
   - Production readiness: `docs/phase-6-production-readiness.md`, `docs/phase-6-ops-runbook.md`.
   - UI/UX: `docs/ui-ux-professionalization-contract.md`, `design.md`, `tokens.css`.
   - Architecture: `docs/ADR-*.md`, `docs/llm-wiki/README.md`, `docs/agent-architecture.md`.
3. State assumptions, unknowns, and product decisions separately from implementation gaps. A scope change needs a new DEC record before implementation.
4. Protect the plan constants: the optical pipeline and `ReportSnapshot` contract do not change; published grade rows are never updated in place (ADR-0011); e-Okul is import and export-list only; `Basari %` is the cross-exam metric for the deneme series only.
5. Map the request to modules, UAT ids, DEC records, slice ids, owner agents, validation commands, acceptance criteria, and the evidence class each step can reach.
6. Split large work into small, reversible slices. End with the smallest safe first PR.

## Agent Routing

- Use `product_scope_planner` for scope, UAT, DEC, roadmap, and backlog slicing.
- Use read-only reviewers for security, privacy, docs, or PR risk discovery.
- Use implementation agents only after the plan selects a concrete write slice.
- Keep depth at one and use at most three subagents, only when parallel discovery materially helps.

## Output

Return:

- Assumptions and uncertainties.
- Current repo state with file references.
- P0/P1 risks.
- Phased plan with owner agents and slice ids.
- Test and evidence commands with the evidence class they produce.
- Smallest safe first PR.

Always separate local/static PASS evidence from real CI, staging, or production evidence.
