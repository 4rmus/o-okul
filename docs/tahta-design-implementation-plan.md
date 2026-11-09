# Tahta design implementation

Decision: DEC-20261109-01. Approved on 2026-11-09 after the interactive prototype review.
Base: `a7c85a3d8382fbb515f57d10cc782947f907a979` (Campus PR #240).
Integration branch: `feat/tahta-design`.

## Outcome

The product uses a simple o-o glasses mark and the approved coral/ink/teal identity.
Customers can select Sade, Beyaz tahta or Kara tahta. Whiteboard is the default;
stored legacy dark preferences remain dark. The handwritten treatment is screen-only.
The existing authorized navigation, customer workflows and report-card output remain intact.

The institution student overview places stored Net / Soru and a valid previous-result
delta next to the identity. Small trend/subject charts and a chronological attendance
strip use existing authorized data. Missing or incompatible data stays explicitly missing.
Public pages use the approved headline, with real CTA destinations and the existing
marketing capability boundaries. No prototype fixture is shipped as a real school record.

## Ownership and boundaries

One write owner: the main agent. Review agents are read-only.
Owned paths: `apps/web`, relevant shared chart-theme code in `packages/ui`,
`design.md`, `docs/DECISIONS.md`, this plan, the UI/marketing contracts, `status.md`,
and their directly coupled checkers, visual fixtures and measurement baseline.
Forbidden mutations: API/DB/domain contracts, optical/report calculations, worker PDF,
published grades, unrelated worktrees and user files, provider/configuration/secrets,
deployment and live data. Fonts are vendored with source and license records.

## Gates

### TAHTA-1 — Appearance and identity

- Add one persisted appearance selector and first-paint restoration shared by public,
  authentication and application surfaces; retain `data-theme` compatibility.
- Add local handwriting fonts, screen-only appearance tokens and the glasses mark.
- Keep Berrak report-card/print tokens and IBM Plex fixed; update checks for the new
  screen contract rather than weakening existing isolation or print checks.
- Verify: web/UI typecheck, design-token checks, targeted theme/logo accessibility and
  persistence tests, and print/report-card checks. Commit the gate locally.

### TAHTA-2 — Student overview

- Use the stored latest report total; match subject data by snapshot identity.
- Compare only equivalent exam/course scope, scoring context and active question
  distribution. Use the last two eligible results for the previous-result delta.
- Keep negative nets, no result, partial loading/error and incompatible-result states.
- Place recent authorized attendance below identity; preserve day aggregation and
  distinguish no record, present, absent, late and excused without guessed holidays.
- Verify: targeted profile tests, data/geometry cases, keyboard and 320–1440px layouts;
  preserve finance, PII, report-version and subject permissions. Commit locally.

### TAHTA-3 — Public presentation and integrated evidence

- Apply the approved headline "İyi bir okul, her öğrenciyi görür." and the new identity
  to existing public pages while preserving demo/contact/pricing flows and claim limits.
- Review all affected route families in each appearance. Update only changed visual
  fixtures; do not regenerate report-card golden images to conceal drift.
- Run the relevant architecture, route, UX, accessibility, release-candidate and complete
  repository checks. Refresh Gate B once after the final UI source is stable.
- Record evidence and SHA/PR in `status.md`; deliver one branch and one PR.

## Acceptance

- Three appearances work on keyboard/touch, persist across reload, and agree between
  desktop/mobile controls. Storage denial does not break rendering.
- The new mark is consistent across application/public/auth/installable surfaces;
  uploaded institution logos remain institution-owned.
- Same-count net comparisons are visibly separate from school grades and broader
  success-rate comparisons. No percentage-to-net reconstruction replaces stored totals.
- Attendance selection works without a separate overview tab; future dates and missing
  records do not become absences. Existing detailed attendance views remain available.
- Print/PDF and report-card contracts are unchanged.
- LOCAL_STATIC/LOCAL_TEST and CI are reported independently of staging/production.
  Deployment and real-user task-time improvement remain unproven until separately tested.

## Evidence log

- 2026-11-09 / TAHTA-1 / LOCAL_STATIC: agent contract, web architecture, design-token,
  display-storage and route-manifest checks passed. New handwriting font assets were
  subset locally from verified upstream blobs and include Turkish glyph/license checks.
- 2026-11-09 / TAHTA-1 / LOCAL_TEST: production web build passed. Twelve targeted browser
  checks passed on private port 3037: all customer roles at 320/375px, three appearances,
  persistence/legacy migration/storage denial, and the existing 320–1440px report-workspace
  test including its unchanged report-card golden and print geometry.
- These are local tests with synthetic API responses; no deployment or live-data smoke ran.
