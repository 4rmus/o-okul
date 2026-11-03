"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasCapabilityForRoles, type AcademicTermRecord, type AcademicYearRecord } from "@o-okul/shared-types";
import { Alert, Button, EmptyState, Panel, StatusBadge, Stepper, useConfirmDialog, type StepperStep } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import {
  activateAcademicCalendar,
  bulkRenew,
  bulkUpdateStatus,
  describeError,
  dryRunBulkRenew,
  loadAcademicTerms,
  loadAcademicYears,
  loadActiveStudents,
  loadClasses,
  loadOpenClassAssignments,
} from "./term-transition-api.js";
import {
  buildTransitionPlan,
  chunkStudents,
  exitSetFingerprint,
  isExitConfirmed,
  mergeDryRunResults,
  newRunId,
  readWizardState,
  renewRequestBodies,
  statusRequestBodies,
  stepRequestKey,
  wizardSteps,
  writeWizardState,
  type TransitionPlan,
  type WizardState,
  type WizardStepNumber,
} from "./term-transition-plan.js";
import { AssignmentStep, CalendarStep, ClassMappingStep, ExitReviewStep, PreviewStep } from "./term-transition-steps.js";

const requiredCapabilities = ["setup:manage", "student:manage", "academic:manage"] as const;

const calendarActivationDeniedMessage =
  "Kampüs yetkisiyle sınırlı hesaplar kurum takvimini etkinleştiremez. Kayıt yenileme ve mezuniyet geri alınamayacağı için geçişi kurum genelinde yetkili bir yönetici uygulamalıdır.";

type RunStepKey = "renew" | "status" | "activate";
interface RunStepResult {
  status: "running" | "done" | "error";
  message: string;
}

export function TermTransitionWizard() {
  const { auth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const state = useMemo(() => readWizardState(new URLSearchParams(searchParams.toString())), [searchParams]);
  const accessToken = auth?.accessToken ?? "";
  const tenantKey = auth?.session.tenantId ?? "anonymous";
  const canRun = Boolean(auth) && requiredCapabilities.every((capability) => hasCapabilityForRoles(auth?.session.roles ?? [], capability));
  const today = useMemo(() => istanbulToday(), []);
  const [runResults, setRunResults] = useState<Partial<Record<RunStepKey, RunStepResult>>>({});
  const [isApplying, setIsApplying] = useState(false);
  const { confirm, confirmationDialog } = useConfirmDialog();

  const yearsQuery = useQuery({
    queryKey: ["term-transition-years", tenantKey],
    queryFn: () => loadAcademicYears(accessToken),
    enabled: canRun,
    refetchOnWindowFocus: false,
  });
  const termsQuery = useQuery({
    queryKey: ["term-transition-terms", tenantKey],
    queryFn: () => loadAcademicTerms(accessToken),
    enabled: canRun,
    refetchOnWindowFocus: false,
  });
  const years = useMemo(() => (yearsQuery.data ?? []).slice().sort(compareByStart), [yearsQuery.data]);
  const terms = useMemo(() => (termsQuery.data ?? []).slice().sort(compareByStart), [termsQuery.data]);
  const year = years.find((record) => record.id === state.academicYearId);
  const term = terms.find((record) => record.id === state.termId && record.academicYearId === state.academicYearId);
  const calendarReady = Boolean(year && term);
  const needsPlan = calendarReady && state.step >= 2;

  const classesQuery = useQuery({
    queryKey: ["term-transition-classes", tenantKey],
    queryFn: () => loadClasses(accessToken),
    enabled: canRun && needsPlan,
    refetchOnWindowFocus: false,
  });
  const studentsQuery = useQuery({
    queryKey: ["term-transition-students", tenantKey],
    queryFn: () => loadActiveStudents(accessToken),
    enabled: canRun && needsPlan,
    refetchOnWindowFocus: false,
  });
  const classedStudentIds = useMemo(
    () => (studentsQuery.data ?? []).filter((student) => student.status === "ACTIVE" && student.classId).map((student) => student.id).sort(),
    [studentsQuery.data],
  );
  // Progress read back from the server: students whose open enrollment is already in the target term, and whether
  // this account may activate the calendar (the last step). Read in batches of the server's per-request bound.
  const progressQuery = useQuery({
    queryKey: ["term-transition-progress", tenantKey, state.academicYearId, state.termId, classedStudentIds],
    queryFn: async () => {
      const results = [];
      for (const studentIds of chunkStudents(classedStudentIds)) {
        results.push(await dryRunBulkRenew(accessToken, { studentIds, academicYearId: state.academicYearId, termId: state.termId }));
      }
      const merged = mergeDryRunResults(results);
      return {
        inTargetTerm: new Set((merged?.items ?? []).filter((item) => item.currentTermId === state.termId).map((item) => item.studentId)),
        canActivateCalendar: merged?.canActivateCalendar,
      };
    },
    enabled: canRun && needsPlan && studentsQuery.isSuccess,
    refetchOnWindowFocus: false,
  });
  const plan: TransitionPlan | undefined = useMemo(
    () => studentsQuery.data && progressQuery.data ? buildTransitionPlan(studentsQuery.data, state, progressQuery.data.inTargetTerm) : undefined,
    [progressQuery.data, state, studentsQuery.data],
  );
  const renewBodies = useMemo(() => plan && plan.renew.length > 0 ? renewRequestBodies(plan, state) : [], [plan, state]);
  const previewQuery = useQuery({
    queryKey: ["term-transition-preview", tenantKey, renewBodies],
    queryFn: async () => {
      const results = [];
      for (const body of renewBodies) results.push(await dryRunBulkRenew(accessToken, body));
      return mergeDryRunResults(results);
    },
    enabled: canRun && state.step >= 5 && renewBodies.length > 0,
    refetchOnWindowFocus: false,
  });
  const assignmentsQuery = useQuery({
    queryKey: ["term-transition-assignments", tenantKey, today],
    queryFn: () => loadOpenClassAssignments(accessToken, today),
    enabled: canRun && calendarReady && state.step === 4,
    refetchOnWindowFocus: false,
  });

  function navigate(patch: Partial<WizardState>, mode: "push" | "replace" = "replace") {
    const query = writeWizardState({ ...state, ...patch });
    const href = query ? `${pathname}?${query}` : pathname;
    if (mode === "push") {
      router.push(href);
      return;
    }
    // Same-step changes only rewrite the address. A soft `router.replace` on a page opened directly with these
    // parameters could restore the opened address, dropping a confirmation or an override. The state argument is null
    // on purpose: Next.js copies its own history state and updates useSearchParams only for a call without its marker.
    window.history.replaceState(null, "", href);
  }

  function stepHref(step: WizardStepNumber) {
    const query = writeWizardState({ ...state, step });
    return query ? `${pathname}?${query}` : pathname;
  }

  if (!auth) return null;
  if (!canRun) {
    return (
      <EmptyState
        description="Dönem geçişi için kurulum, öğrenci ve akademik yönetim yetkilerinin birlikte bulunması gerekir."
        title="Bu işlem için yetkiniz yok"
      />
    );
  }

  const exitCount = (plan?.graduate.length ?? 0) + (plan?.leave.length ?? 0);
  const exitConfirmed = plan ? isExitConfirmed(plan, state) : false;
  const calendarStarted = Boolean(year && term && calendarHasStarted(year, term, today));
  const calendarActive = Boolean(year?.isActive && term?.isActive);
  const preview = previewQuery.data;
  // DEC-20261102-08: renewal and graduation commit before the activation; an account that cannot activate the
  // calendar (campus-restricted staff) must not start a transition it would leave half applied.
  const calendarActivationDenied = progressQuery.data?.canActivateCalendar === false || preview?.canActivateCalendar === false;
  const isRefreshing = studentsQuery.isFetching || progressQuery.isFetching || previewQuery.isFetching || yearsQuery.isFetching || termsQuery.isFetching;
  const applyBlockers = [
    calendarActivationDenied ? calendarActivationDeniedMessage : "",
    !calendarStarted || preview?.termStarted === false ? "Başlangıç tarihi gelmemiş dönem için geçiş uygulanamaz. Dönem başladığında bu sayfaya dönebilirsiniz." : "",
    exitCount > 0 && !exitConfirmed ? "Mezun ve ayrılan öğrenciler için geri alınamaz onayı verilmedi (3. adım)." : "",
    preview && preview.conflictStudentIds.length > 0 ? "Ön izlemede çakışan öğrenciler var (5. adım)." : "",
    preview?.quota.wouldExceed ? "Lisanstaki aktif öğrenci sınırı aşılıyor (5. adım)." : "",
    renewBodies.length > 0 && previewQuery.isError ? "Ön izleme alınamadı (5. adım)." : "",
  ].filter(Boolean);

  // U14: the transition is done when this run finished every step, or when the server shows nothing left to apply
  // (every mapped student is in the target term, no exits wait and the target term is the active one).
  const runSucceeded = (["renew", "status", "activate"] as const).every((key) => runResults[key]?.status === "done");
  const nothingLeft = Boolean(plan && plan.candidates.length === 0 && calendarActive);
  // Students still wait, but every class stays out of the transition: there is nothing to apply yet.
  const nothingSelected = Boolean(plan && !nothingLeft && plan.renew.length === 0 && exitCount === 0 && calendarActive);
  const transitionDone = !isApplying && (runSucceeded || nothingLeft);

  // U9: steps that cannot open yet (no year and term chosen) are pending, not blocked; "blocked" is kept for real errors.
  const steps: StepperStep[] = wizardSteps.map((step, index) => {
    const number = (index + 1) as WizardStepNumber;
    const locked = number > 1 && !calendarReady;
    const done = number < state.step || (number === 6 && transitionDone);
    return {
      href: locked ? undefined : stepHref(number),
      key: step.key,
      label: step.label,
      status: done ? "complete" : number === state.step ? "current" : "upcoming",
    };
  });

  // DEC-20261103-01 (U13): the irreversible run starts only after an explicit confirmation that names the counts and
  // the target year and term; cancelling sends nothing. The graduation confirmation of step 3 stays as it is.
  async function requestApply() {
    if (!plan || !year || !term || isApplying || applyBlockers.length > 0 || nothingSelected) return;
    const accepted = await confirm({
      cancelLabel: "Vazgeçin",
      confirmLabel: "Onaylayın ve uygulayın",
      confirmVariant: "danger",
      description: `Hedef: ${year.name} ${term.name}`,
      message: transitionSummary(plan, `${year.name} ${term.name}`, calendarActive),
      title: "Dönem geçişini onaylayın",
    });
    if (accepted) await apply();
  }

  async function apply() {
    if (!plan || !year || !term || isApplying || applyBlockers.length > 0) return;
    const snapshot = plan;
    // Checked again on the snapshot the run uses: the confirmation must cover exactly these exits, and the term must
    // have started today (the page may have stayed open since it was rendered).
    if (!isExitConfirmed(snapshot, state) || !calendarHasStarted(year, term, istanbulToday())) {
      setRunResults({ renew: { status: "error", message: "Uygulama başlatılmadı: dönem başlamamış ya da mezun ve ayrılan öğrenci onayı güncel değil." } });
      return;
    }
    const runId = state.runId || newRunId();
    if (!state.runId) navigate({ runId });
    let current: RunStepKey = "renew";
    setRunResults({});
    setIsApplying(true);
    try {
      setRunResults((results) => ({ ...results, renew: { status: "running", message: "Kayıtlar yenileniyor." } }));
      if (snapshot.renew.length > 0) {
        let updatedCount = 0;
        for (const body of renewRequestBodies(snapshot, state)) {
          const result = await bulkRenew(accessToken, body, await stepRequestKey(runId, "yenileme", body));
          updatedCount += result.updatedCount;
        }
        setRunResults((results) => ({ ...results, renew: { status: "done", message: `${updatedCount} öğrencinin kaydı yeni döneme taşındı.` } }));
      } else {
        setRunResults((results) => ({ ...results, renew: { status: "done", message: "Yenilenecek öğrenci kalmadı." } }));
      }

      current = "status";
      setRunResults((results) => ({ ...results, status: { status: "running", message: "Öğrenci durumları güncelleniyor." } }));
      const messages: string[] = [];
      for (const [items, status, label] of [
        [snapshot.graduate, "GRADUATED", "mezun"],
        [snapshot.leave, "TRANSFERRED", "ayrılan"],
      ] as const) {
        if (items.length === 0) continue;
        let marked = 0;
        for (const body of statusRequestBodies(items, status)) {
          const result = await bulkUpdateStatus(accessToken, body, await stepRequestKey(runId, label === "mezun" ? "mezun" : "ayrilan", body));
          marked += result.updatedCount + result.unchangedCount;
        }
        messages.push(`${marked} öğrenci ${label} olarak işaretlendi.`);
      }
      setRunResults((results) => ({ ...results, status: { status: "done", message: messages.join(" ") || "Bekleyen mezun veya ayrılan öğrenci kalmadı." } }));

      current = "activate";
      setRunResults((results) => ({ ...results, activate: { status: "running", message: "Yıl ve dönem etkinleştiriliyor." } }));
      const request = { academicYearId: year.id, termId: term.id };
      const activation = await activateAcademicCalendar(accessToken, request, await stepRequestKey(runId, "aktif", request));
      setRunResults((results) => ({
        ...results,
        activate: { status: "done", message: `${activation.academicYear.name} ${activation.term.name} etkin dönem oldu.` },
      }));
    } catch (error) {
      setRunResults((results) => ({
        ...results,
        [current]: {
          status: "error",
          message: describeError(error, "Bu adım tamamlanamadı. Yeniden denediğinizde tamamlanan adımlar tekrarlanmaz."),
        },
      }));
    } finally {
      setIsApplying(false);
      for (const key of ["term-transition-years", "term-transition-terms", "term-transition-students", "term-transition-progress", "term-transition-preview"]) {
        void queryClient.invalidateQueries({ queryKey: [key, tenantKey] });
      }
    }
  }

  const loadError = yearsQuery.isError || termsQuery.isError
    ? "Akademik takvim yüklenemedi."
    : needsPlan && (studentsQuery.isError || classesQuery.isError || progressQuery.isError)
      ? describeError(studentsQuery.error ?? classesQuery.error ?? progressQuery.error, "Öğrenci ve sınıf bilgileri yüklenemedi.")
      : "";

  return (
    <div className="next-onboarding-fields">
      <Stepper currentHref={stepHref(state.step)} label="Dönem geçişi adımları" linkComponent={Link} steps={steps} />
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}
      {calendarActivationDenied ? (
        <Alert title="Bu hesapla geçiş uygulanamaz" tone="warning">{calendarActivationDeniedMessage}</Alert>
      ) : null}
      {state.step === 1 || !calendarReady ? (
        <CalendarStep
          accessToken={accessToken}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ["term-transition-years", tenantKey] });
            void queryClient.invalidateQueries({ queryKey: ["term-transition-terms", tenantKey] });
          }}
          onSelect={(academicYearId, termId) => navigate({ academicYearId, termId, confirmation: "", step: 1 })}
          loading={yearsQuery.isLoading || termsQuery.isLoading}
          state={state}
          terms={terms}
          today={today}
          years={years}
        />
      ) : null}
      {calendarReady && state.step === 2 ? (
        <ClassMappingStep
          classes={classesQuery.data ?? []}
          loading={!plan || classesQuery.isLoading}
          onChange={(classTargets) => navigate({ classTargets, confirmation: "" })}
          plan={plan}
          state={state}
          targetIsActive={calendarActive}
          targetName={year && term ? `${year.name} ${term.name}` : ""}
        />
      ) : null}
      {calendarReady && state.step === 3 ? (
        <ExitReviewStep
          classes={classesQuery.data ?? []}
          confirmed={Boolean(plan && exitCount > 0 && exitConfirmed)}
          loading={!plan}
          onConfirm={(confirmed) => navigate({ confirmation: confirmed && plan ? exitSetFingerprint(plan) : "" })}
          onOverrides={(overrides) => navigate({ overrides, confirmation: "" })}
          plan={plan}
          state={state}
        />
      ) : null}
      {calendarReady && state.step === 4 ? (
        <AssignmentStep
          classes={classesQuery.data ?? []}
          error={assignmentsQuery.isError}
          loading={assignmentsQuery.isLoading}
          rows={assignmentsQuery.data ?? []}
          targetTermId={state.termId}
          terms={terms}
        />
      ) : null}
      {calendarReady && state.step === 5 ? (
        <PreviewStep
          classes={classesQuery.data ?? []}
          error={previewQuery.isError ? describeError(previewQuery.error, "Ön izleme alınamadı.") : ""}
          loading={!plan || (renewBodies.length > 0 && previewQuery.isLoading)}
          plan={plan}
          preview={renewBodies.length > 0 ? preview : undefined}
          termStarted={calendarStarted}
        />
      ) : null}
      {calendarReady && state.step === 6 && year && term ? (
        <Panel aria-label="Geçişi uygulama" description="Adımlar sırayla uygulanır: kayıt yenileme, mezun ve ayrılanlar, yıl ve dönemin etkinleştirilmesi. Yarıda kalan bir uygulamayı yeniden başlattığınızda tamamlanan adımlar tekrarlanmaz." title="Geçişi uygulayın">
          <ol className="next-onboarding-fields" aria-label="Uygulama adımları">
            <RunStepItem
              fallback={plan ? (plan.renew.length > 0 ? `${plan.renew.length} öğrencinin kaydı yenilenecek.` : `Yenilenecek öğrenci yok. Bu dönemde ${plan.alreadyInTerm.length} öğrenci var.`) : "Hazırlanıyor."}
              label="1. Kayıt yenileme"
              nothingToDo={Boolean(plan && plan.renew.length === 0)}
              result={runResults.renew}
            />
            <RunStepItem
              fallback={plan ? (exitCount > 0 ? `${plan.graduate.length} mezun, ${plan.leave.length} ayrılan öğrenci işaretlenecek.` : "Bekleyen mezun veya ayrılan öğrenci yok.") : "Hazırlanıyor."}
              label="2. Mezun ve ayrılanlar"
              nothingToDo={Boolean(plan && exitCount === 0)}
              result={runResults.status}
            />
            <RunStepItem
              fallback={calendarActive ? `${year.name} ${term.name} etkin dönem.` : `${year.name} ${term.name} etkin dönem yapılacak; diğer yıl ve dönemler etkinliğini yitirir.`}
              label="3. Yıl ve dönem etkinleştirme"
              nothingToDo={calendarActive}
              result={runResults.activate}
            />
          </ol>
          {applyBlockers.length > 0 ? (
            <Alert title="Uygulama için eksikler" tone="warning">
              <ul>
                {applyBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </Alert>
          ) : null}
          {nothingSelected && !transitionDone ? (
            <Alert tone="info">Uygulanacak değişiklik yok. Sınıf eşleştirme adımında (2. adım) en az bir sınıfın yeni dönemdeki yerini seçin.</Alert>
          ) : null}
          {transitionDone ? (
            <>
              <Alert tone="success">Dönem geçişi tamamlandı.</Alert>
              <div className="next-onboarding-actions">
                <Link className="uh-button uh-button--secondary" href="/kurum">Kurum özetine gidin</Link>
                <Link className="uh-button" href="/kurum/ogrenciler">Öğrencileri açın</Link>
              </div>
            </>
          ) : (
            <div className="next-onboarding-actions">
              <Button
                disabled={!plan || isApplying || isRefreshing || applyBlockers.length > 0 || nothingSelected}
                onClick={() => void requestApply()}
                type="button"
              >
                {isApplying ? "Uygulanıyor…" : Object.values(runResults).some((result) => result?.status === "error") ? "Yeniden deneyin" : "Geçişi uygulayın"}
              </Button>
            </div>
          )}
        </Panel>
      ) : null}
      <div className="next-onboarding-actions">
        {state.step > 1 ? (
          <Button onClick={() => navigate({ step: (state.step - 1) as WizardStepNumber }, "push")} type="button" variant="secondary">
            Geri
          </Button>
        ) : null}
        {state.step < 6 ? (
          <Button disabled={!calendarReady} onClick={() => navigate({ step: (state.step + 1) as WizardStepNumber }, "push")} type="button">
            Devam edin
          </Button>
        ) : null}
      </div>
      {confirmationDialog}
    </div>
  );
}

/** Confirmation text of the apply step: counts of the run and the target year and term (DEC-20261103-01). */
function transitionSummary(plan: TransitionPlan, targetName: string, calendarActive: boolean): string {
  const parts = [
    `${plan.renew.length} öğrencinin kaydı ${targetName} için yenilenecek.`,
    `${plan.graduate.length} öğrenci mezun, ${plan.leave.length} öğrenci ayrılan olarak işaretlenecek.`,
    calendarActive ? `${targetName} zaten etkin dönem.` : `${targetName} etkin dönem olacak; diğer yıl ve dönemler etkinliğini yitirir.`,
    "Bu işlem sihirbazla geri alınamaz.",
  ];
  return parts.join(" ");
}

function RunStepItem({ fallback, label, nothingToDo, result }: { fallback: string; label: string; nothingToDo: boolean; result?: RunStepResult }) {
  // U14: a step with nothing to do before the run reads "Gerek yok", not "Tamamlandı".
  const status = result?.status ?? (nothingToDo ? "skipped" : "pending");
  const badge = {
    done: { label: "Tamamlandı", tone: "success" as const },
    error: { label: "Tamamlanamadı", tone: "danger" as const },
    pending: { label: "Bekliyor", tone: "neutral" as const },
    skipped: { label: "Gerek yok", tone: "neutral" as const },
    running: { label: "Sürüyor", tone: "info" as const },
  }[status];
  return (
    <li>
      <strong>{label}</strong> <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      <p role={result?.status === "error" ? "alert" : undefined}>{result?.message ?? fallback}</p>
    </li>
  );
}

/** The year and the term have both started on `today` (YYYY-MM-DD, Türkiye); the server applies the same date rule. */
function calendarHasStarted(year: AcademicYearRecord, term: AcademicTermRecord, today: string): boolean {
  return year.startsAt.slice(0, 10) <= today && term.startsAt.slice(0, 10) <= today;
}

function compareByStart(left: AcademicYearRecord | AcademicTermRecord, right: AcademicYearRecord | AcademicTermRecord) {
  return right.startsAt.localeCompare(left.startsAt) || left.name.localeCompare(right.name, "tr-TR");
}

/** Today in Türkiye; the server compares term starts with the same calendar date. */
function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date());
}
