# CSS consolidation W10 (2026-11)

Scope: DEC-20261102-08, last bullet ("CSS konsolidasyonu ... piksel aynı, karne bölgesi hariç"). Base commit
`3f9105607` (head of `feat/ui-ux-dalga-3`). The change is pixel-identical by construction: it only removes rules
that cannot match any rendered element and cuts `20-application-base.css` into contiguous slices imported at the
original position. No rule was reordered and no golden was regenerated.

## 1. Inventory on the base commit

| File | Lines before | Lines after |
|---|---:|---:|
| `00-foundation.css` | 77 | 77 |
| `01-theme-dark.css` | 74 | 74 |
| `10-marketing-base.css` | 1386 | 988 |
| `20-application-base.css` | 8314 | split, see §3 (7586 in 12 slices incl. one header line each) |
| `30-primitives.css` | 384 | 384 |
| `35-attendance-teacher.css` | 218 | 218 |
| `70-almanac-foundation.css` | 259 | 258 |
| `71-almanac-shell.css` | 413 | 413 |
| `72-almanac-portal.css` | 411 | 381 |
| `73-almanac-report.css` | 94 | 94 |
| `74-almanac-marketing.css` | 665 | 612 |
| `79-almanac-responsive.css` | 682 | 678 |
| `85-print.css` | 104 | 104 |
| `86-data-table-selection.css` | 114 | 114 |
| `globals.css` | 41 | 52 (11 extra `@import` lines) |
| Total | 13236 | 12033 |

Files 70-79 are the active Berrak Hallmark layer (`check-web-design-tokens.mjs` reads its BEGIN/END markers);
they were not treated as dead and only lost selectors listed below.

## 2. Dead selectors

Method: every class used in a selector of `apps/web/app/_styles/*.css` and `globals.css` was searched as a whole
word in `apps/**` and `packages/**` (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.json`, `.html`; `node_modules`,
`.next`, `dist` excluded) and in `scripts/**`. Template-built names were checked by prefix: when source builds a
modifier with a template (`uh-toast--${tone}`, `uh-button--${variant}`, `uh-panel--${tone}`,
`uh-metric-card--${tone}`, `uh-status-badge--${tone}`, `uh-alert--${tone}`, `uh-toolbar--${align}`), the whole
modifier family is alive and kept. A rule was removed only when every selector in its list references a dead
class; in a mixed list only the dead selector was dropped.

Removed classes (no reference in `apps/**` or `packages/**`; script references were CSS pins only):

| Class (family) | Where | Proof / note |
|---|---|---|
| `next-demo-accounts`, `next-demo-account` | 20 (+ professional layer) | none; `requireNoTokens` on the login page already forbids "Demo hesapları (şifre: password)" |
| `next-button` | 20, 70 | only `requireNoTokens` on `(auth)/login/page.tsx` (`className="next-button"` must not appear) |
| `next-checkbox-row` | 20 | only `requireNoTokens` on three TSX files |
| `next-portal-preview-action`, `next-sidebar-recent`, `next-command-header`, `next-section-header` | 20 | none |
| `next-dashboard-overview-grid`, `next-dashboard-overview-card` | 20, 72, 79 | `requireNoTokens` on `kurum-dashboard.tsx` keeps them out of source; CSS pins retired |
| `next-portal-state__skeleton`, `next-subsection`, `next-teacher-focus__header`, `next-portal-focus__header` | 20 | none |
| `next-role-draft-status`, `next-users-page`, `next-role-checks(--dirty)`, `next-role-fieldset(__hint)`, `next-role-grid(--compact)`, `next-token-panel(__status/__actions)`, `next-users-actions`, `next-invitation-context(__badges)` | 20 | none in source; `next-role-grid*`, `next-role-fieldset__hint` CSS pins retired; `next-invitation-context` already in a `requireNoTokens` block |
| `next-student-decision-grid`, `next-student-decision-card` | 20 | no component renders them; `ui-visual-qa-next.spec.ts` lists `.next-student-decision-card` only inside a generic clipped-text sweep (zero matches tolerated) and asserts "Öğrenci karar kartları" is absent; CSS pins retired |
| `next-onboarding-check` | 20 | none; CSS pin retired |
| `next-student-dashboard-hero`, `next-detail-back`, `next-detail-header`, `next-student-relationship-fallback`, `next-relationship-list`, `next-relationship-item` | 20 | none (`next-student-dashboard-hero` only in a `requireNoTokens` block) |
| `next-preview-box`, `next-inline-header`, `next-compact-list`, `uh-summary-grid`, `next-sms-composer-grid` | 20 | none |
| `uh-toast__title`, `uh-toast__body` | 20 | none; `packages/ui` toast renders neither element class (the `uh-toast--*` tone family stays) |
| `next-exam-workspace-readiness`, `next-optical-result-header`, `next-optical-answer-key-grid`, `next-optical-answer-key-panel(--wide)` | 20 | none; answer-key CSS pins retired |
| `next-role-preview-card-header` | 20 | none |
| `next-portal-today-list` | 72 | none |
| `next-marketing-proof`, `next-marketing-nav__links`, `next-marketing-product__chrome/__image/__signal(--top/--bottom)`, `next-marketing-section__header--split/--center`, `next-marketing-showcase`, `next-marketing-capability-grid`, `next-marketing-reporting(__copy/__visual/__header/__summary/__chart)` | 10, 74, 79 | none; the landing renders none of these blocks |

Totals (flattened `globals.css`): 182 whole rules removed, 43 selector lists trimmed, 261 selectors removed.

Kept on purpose:

- Karne/report frozen area: `next-outcome-radar*`, `next-outcome-legend*`, `next-outcome-bar*`, `next-report-bars`,
  `next-report-bar-*` and `next-report-grid` have no source reference either, but the report/karne region is moved
  verbatim only (DEC-20261102-08). They now live in `20-application-06-report.css` and
  `20-application-08-report-charts.css`.
- `uh-context-bar*` (`30-primitives.css`): `packages/ui/src/components/context-bar.tsx` still renders these classes;
  the component has no app consumer since wave-2b, but removing it belongs to a component change, not to this
  pixel-identical CSS gate.
- `next-work-context`: still used by `kurum/raporlar/reports-page.tsx`.
- Template modifier families listed above.

## 3. Slices of `20-application-base.css`

Cut at top-level rule boundaries of the post-removal file, in order, imported by `globals.css` exactly where
`20-application-base.css` was. Each slice starts with one header comment.

| Slice | Contents (route family, Berrak plan §7) |
|---|---|
| `20-application-01-shell.css` | shell: error/loading surfaces, auth panel, form base, sidebar, top bar, command palette, breadcrumb |
| `20-application-02-portal.css` | portal: context strip, daily brief, action strip, portal states, teacher/portal focus, chart panel |
| `20-application-03-registry.css` | registry: button, fields, panel, metric, status badge, tabs, alert, CRUD page, list controls, empty state |
| `20-application-04-workflow.css` | workflow: dashboard onboarding/attention, setup wizard, SMS flow, loading/toast, data table, row actions |
| `20-application-05-exam.css` | workflow/exam: student/support/material detail, selected exam context, optical panels |
| `20-application-06-report.css` | report: report workspace, evidence/system reference panels, report table, frozen karne block |
| `20-application-07-role-preview.css` | control-plane: role preview panels |
| `20-application-08-report-charts.css` | report: frozen karne report bars and outcome radar |
| `20-application-09-forms.css` | control-plane forms: dialog, form modal, class picker, permission fieldsets, tenant capacity |
| `20-application-10-charts.css` | chart shells, chart table, success meter |
| `20-application-11-responsive.css` | application-base breakpoints (900/760/520 px) |
| `20-application-12-professional-layer.css` | the "Professional redesign layer", kept as its own slice at its original position |

The plan's merge of the professional layer into earlier definitions was not done: it reorders the cascade and is
not pixel-identical by construction.

## 4. Byte-neutral proof

A scratch script (not committed) flattened `globals.css` imports for three trees: base, after removal, after split.

- Split step: normalised (comments stripped, whitespace collapsed) flattened CSS is identical (226589 chars).
- Removal step: postcss walk of both trees; every rule/statement either matches unchanged (context, selectors,
  declarations) or is fully explained by removed selectors that reference a class in the dead list. Unexplained
  differences: 0.

## 5. Pins (DEC-20260930-03)

| Retired `requireTokens("apps/web/app/globals.css")` pin | Equivalent evidence |
|---|---|
| `.next-role-grid`, `.next-role-grid--compact`, `.next-role-grid .uh-checkbox`, `.next-role-grid .uh-checkbox:has(.uh-checkbox__input:checked)`, `.next-role-fieldset__hint` | new `requireNoTokens` (globals: dead selectors cannot return), unchanged route-family and ui-visual-qa goldens |
| `.next-student-decision-grid`, `.next-student-decision-card.uh-action-card`, `.next-student-decision-card .uh-action-card__value`, `.next-student-decision-card .uh-action-card__detail` | new `requireNoTokens` (globals), existing `requireNoTokens` on `student-detail-page.tsx`, ui-visual-qa assertion that "Öğrenci karar kartları" is absent |
| `.next-onboarding-check .uh-checkbox__input` | new `requireNoTokens` (globals), unchanged setup goldens |
| `.next-optical-answer-key-grid`, `.next-optical-answer-key-panel .uh-panel__body`, `... label`, `... select`, `... p` | new `requireNoTokens` (globals), unchanged exam workspace goldens |
| `.next-dashboard-overview-grid`, `.next-dashboard-overview-card`, `... .uh-metric-card__label`, `... .uh-metric-card__description` | new `requireNoTokens` (globals), existing `requireNoTokens` on `kurum-dashboard.tsx`, `faz9-dashboard-*` goldens |

The raw px ratchet in `check-web-design-tokens.mjs` dropped with the removed rules and its baseline was lowered to
the new counts (spacing 467 → 412, font-size 85 → 77, radius 27 → 21). It counts every file in `_styles`, so the
split needs no file-list change.
