# Campus dashboard implementation

Approved: 2026-11-07, DEC-20261107-01. Base: `69eeb8cc9cee1ce718707e2337d04ef7f10b9dc3` (main, PR #239). The original working checkout and its untracked user documents remain untouched.

## Outcome and boundaries

Implement the approved Campus prototype with real existing data: warm neutral surfaces, petrol actions, Manrope body text, Fraunces dashboard headings, desktop top navigation, and distinct task-focused home screens. This is a customer-workspace milestone, not a public-site, auth, control-plane, or report redesign.

Keep all existing routes, navigation manifest/capabilities, search, breadcrumbs, persona switching, mobile drawer accessibility, unsaved-change guards, loading/error/partial/empty states, and permissions. Retain all useful actions and details when removing repeated summary cards. Prototype menu labels and numbers are references, not new routes or production fixtures.

Finance stays on `/kurum/finans`; collection remains attached to the selected installment. Summary amounts are explicitly limited to the fetched page. Mixed currencies must not be added together; use installment counts with an explanation if necessary. No new monthly aggregate or payment-provider integration is required.

Teacher queries retain assigned scope. Student queries retain self scope. Guardian data remains child-keyed; fresh permission checks precede finance rendering and requests. Internal teacher notes remain private. Deneme progress uses valid Başarı % values with Net/Soru context; missing values are not zero. Existing order-based charts must say exam order rather than imply proportional calendar time. School grades remain separate.

## Shared implementation contract

- Customer shell class: `.next-campus-shell`, on the existing `.next-app-shell` for institution/teacher/student/guardian workspaces only. System pages stay outside the scope.
- Campus theme: `apps/web/app/_styles/80-campus-shell.css`, screen-only; rebind semantic aliases at the same scoped root. Existing `html[data-theme]` controls light/dark mode.
- Body font variable: `--font-manrope`; display variable: `--font-campus-display` using `--font-fraunces`. Both fonts are local with licenses. Root Berrak tokens and IBM Plex remain available.
- Dashboard heading hook: `.campus-dashboard-title`. Section headings remain readable sans-serif.
- Gate B styles: `91-campus-institution.css`; Gate C styles: `92-campus-portals.css`. Gate A owns their imports in `globals.css`.
- Charts read tokens from their own canvas/container, falling back to the existing root when needed. Report-card/print styles must retain their existing font and palette.
- Existing shared UI primitives, Lucide, and Chart.js are reused. No new UI dependency.

## Parallel gates

All three gates start from the same plan commit and own separate paths. Each owner commits locally, never pushes or merges. At most three heavy validation processes run concurrently; each gate uses its assigned port. The main agent integrates only while gate writers are active.

| Gate | Owner and owned paths | Forbidden paths | Acceptance and checks |
|---|---|---|---|
| CAMPUS-A: shell/theme | Frontend owner A: `app-shell.tsx`, `_shell/top-bar.tsx`, new `_shell/campus-navigation.tsx`, `app/layout.tsx`, local font assets/licenses, `80-campus-shell.css`, `globals.css`, `design.md`, UI/UX contract, design-token/UX-baseline checks, dedicated campus-shell test; existing shared shell visual/a11y expectations only as needed | Dashboard/portal content, providers/auth, capability/route manifest, API/DB, public/system pages, worker/PDF, B/C CSS, measurement baseline | Customer-only theme; authorized grouped top nav; keyboard/Escape/focus; existing mobile drawer and guards; local fonts; unchanged public/auth/system/karne. Port 3021. Web/UI typecheck as applicable, token/architecture/route/UX checks, targeted shell/persona/guard tests. |
| CAMPUS-B: institution/finance | Frontend owner B: `kurum/kurum-dashboard.tsx`, `kurum/finans/finance-page.tsx`, `91-campus-institution.css`, `finance-student-label-next.spec.ts`, dedicated campus-institution test if needed | Shell/shared styles/imports, tokens/design docs, portals, packages/ui/shared-types, API/DB, shared visual QA and golden files | Role-aware task list, consolidated latest-exam summary, existing academic counts, honest page/currency finance summaries, existing collection/filters preserved. Port 3022. Web typecheck, targeted finance permission/summary/filter tests and institution behavior tests. |
| CAMPUS-C: portals/charts | Frontend owner C: `portals/teacher-today-page.tsx`, `student-portal-page.tsx`, `guardian-portal-page.tsx`, `_shared/portal-shell.tsx`, `_shared/progress-series-panel.tsx`, `92-campus-portals.css`, `packages/ui/src/components/charts.tsx` and directly relevant chart tests, portal-specific tests/new campus-portals test | Shell/imports, base tokens/fonts, institution/finance pages, API/DB/shared-types, worker/PDF, shared visual QA and golden files | Teacher timeline and next action; student/guardian clear daily priority; no duplicate metrics; fresh guardian permission; no stale-child finance; honest accessible progress chart; chart colors scoped without changing report semantics. Port 3023. UI/Web typecheck, teacher-today, student progression, guardian contract, panel-isolation and report-panel tests. |

## Traceability

- Institution/operations: UAT-KURUM-04/08 and DEC-20261102-04.
- Finance: UAT-KURUM-07 and existing finance access tests.
- Teacher: UAT-TEACHER-01/02/03.
- Student: UAT-STUDENT-01/03.
- Guardian: UAT-GUARDIAN-01/03, KV-4, DEC-20261003-01 and DEC-20261103-01.
- Navigation: ADR-0005; published grades: ADR-0011.

## Integration and release evidence

1. Merge the three local gate branches into the milestone branch; resolve coupled CSS/import/test expectations without weakening permission or integrity assertions.
2. Inspect all six customer roles at 320/375/414/768/1024/1440; retain old public/auth/system/report baselines unless an unintended change is fixed. Update only intentional customer visual baselines.
3. Run the required web checks: `pnpm --filter @o-okul/web typecheck`, `pnpm web:a11y:check`, `pnpm web:design-tokens:check`, `pnpm web:architecture:check`, `pnpm route-manifest:check`, `pnpm web:ux-baseline:check`, relevant role/permission/guard tests, `pnpm web:ux-rc:check`, report-card visual contract and route-family visual checks. Run `pnpm agents:check` for the design-source instruction update.
4. Refresh Gate B once on the integrated source using `pnpm web:measurement-baseline:collect`, then `pnpm web:measurement-baseline:check`. Record command results, not assumed passes.
5. Run up to three read-only reviews of the integrated diff. Fix findings on the same milestone branch, then update `status.md` with date, slice IDs, evidence classes and commit/PR references.
6. Push once and open one PR after the milestone is reviewable. No deployment, provider operation, secret/config change or live-data mutation is included in this authorization.

## Evidence ledger

- LOCAL_STATIC: UI/Web typechecks, design-token, architecture, route-manifest, agent-contract and diff checks passed. The UX baseline checker awaits the Linux top-navigation golden only.
- LOCAL_TEST: integrated focused suite 79/79; full UI contract suite 408/408; Chromium/WebKit release-candidate suite 86/86. Visual QA satisfied all 32 scenarios after the targeted optical-layout rerun; the 21-test accessibility suite passed. Full route-family/auth scans and the Gate B collection are being recorded before final review readiness.
- CI: tracked on the milestone PR; a draft is used while the existing Linux golden workflow prepares the matching screenshots.
- STAGING: not run.
- PRODUCTION: not run.
- EXTERNAL_NOT_RUN: live accounts, providers and real-device UAT.
- UNPROVEN: real-user usability improvement and staging acceptance.

## Integration review

Three independent read-only reviews found four P2 issues, all fixed with behavior tests or existing regression coverage: the portal bottom-menu opener must be a button (not a click event); failed persona changes need a visible alert; the guardian homework action must preserve the selected child; the teacher focus action must target the lesson named by the card. No new P0/P1 was identified in those source reviews.

The Campus font exposed a narrow optical-layout/button overflow. The scoped grid and 320px panel spacing were corrected without changing optical processing. The frozen report-card screenshot is captured after fonts settle and its test-only position is aligned to whole pixels; no report-card golden, paper style, dimensions, data or tolerance was changed. The temporary alignment is removed before print checks.

Gate commits: CAMPUS-A `f1172589cd1363d60459fdef22824d522b2d5dc1`, CAMPUS-B `6cd9e08acfbebfe17c0a49a804064d7e52b05811`, CAMPUS-C `5fff10a9a567cbf247fc4166aca760ded626b851`. Integration and regression fixes: `4ed9f1f43371c084a2014cc22b619e14b09526e5`.
