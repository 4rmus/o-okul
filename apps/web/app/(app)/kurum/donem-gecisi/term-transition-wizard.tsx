"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasCapabilityForRoles, type AcademicTermRecord, type AcademicYearRecord } from "@o-okul/shared-types";
import { Alert, Button, EmptyState, Panel, StatusBadge, Stepper, type StepperStep } from "@o-okul/ui";
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
  newRunId,
  readWizardState,
  renewRequestBody,
  statusRequestBody,
  stepRequestKey,
  wizardSteps,
  writeWizardState,
  type TransitionPlan,
  type WizardState,
  type WizardStepNumber,
} from "./term-transition-plan.js";
import { AssignmentStep, CalendarStep, ClassMappingStep, ExitReviewStep, PreviewStep } from "./term-transition-steps.js";

const requiredCapabilities = ["setup:manage", "student:manage", "academic:manage"] as const;

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
  // Progress read back from the server: students whose open enrollment is already in the target term.
  const progressQuery = useQuery({
    queryKey: ["term-transition-progress", tenantKey, state.academicYearId, state.termId, classedStudentIds],
    queryFn: async () => {
      if (classedStudentIds.length === 0) return new Set<string>();
      const result = await dryRunBulkRenew(accessToken, {
        studentIds: classedStudentIds,
        academicYearId: state.academicYearId,
        termId: state.termId,
      });
      return new Set(result.items.filter((item) => item.currentTermId === state.termId).map((item) => item.studentId));
    },
    enabled: canRun && needsPlan && studentsQuery.isSuccess,
    refetchOnWindowFocus: false,
  });
  const plan: TransitionPlan | undefined = useMemo(
    () => studentsQuery.data && progressQuery.data ? buildTransitionPlan(studentsQuery.data, state, progressQuery.data) : undefined,
    [progressQuery.data, state, studentsQuery.data],
  );
  const renewBody = plan && plan.renew.length > 0 ? renewRequestBody(plan, state) : undefined;
  const previewQuery = useQuery({
    queryKey: ["term-transition-preview", tenantKey, renewBody],
    queryFn: () => dryRunBulkRenew(accessToken, renewBody!),
    enabled: canRun && state.step >= 5 && Boolean(renewBody),
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
    router.replace(href);
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
  const calendarStarted = Boolean(year && term && year.startsAt.slice(0, 10) <= today && term.startsAt.slice(0, 10) <= today);
  const calendarActive = Boolean(year?.isActive && term?.isActive);
  const preview = previewQuery.data;
  const isRefreshing = studentsQuery.isFetching || progressQuery.isFetching || previewQuery.isFetching || yearsQuery.isFetching || termsQuery.isFetching;
  const applyBlockers = [
    !calendarStarted ? "Başlangıç tarihi gelmemiş dönem için geçiş uygulanamaz. Dönem başladığında bu sayfaya dönebilirsiniz." : "",
    exitCount > 0 && !state.confirmed ? "Mezun ve ayrılan öğrenciler için geri alınamaz onayı verilmedi (3. adım)." : "",
    preview && preview.conflictStudentIds.length > 0 ? "Ön izlemede çakışan öğrenciler var (5. adım)." : "",
    preview?.quota.wouldExceed ? "Lisanstaki aktif öğrenci sınırı aşılıyor (5. adım)." : "",
    renewBody && previewQuery.isError ? "Ön izleme alınamadı (5. adım)." : "",
  ].filter(Boolean);

  const steps: StepperStep[] = wizardSteps.map((step, index) => {
    const number = (index + 1) as WizardStepNumber;
    const blocked = number > 1 && !calendarReady;
    return {
      href: blocked ? undefined : stepHref(number),
      key: step.key,
      label: step.label,
      status: number === state.step ? "current" : blocked ? "blocked" : number < state.step ? "complete" : "upcoming",
    };
  });

  async function apply() {
    if (!plan || !year || !term || isApplying || applyBlockers.length > 0) return;
    const runId = state.runId || newRunId();
    if (!state.runId) navigate({ runId });
    const snapshot = plan;
    let current: RunStepKey = "renew";
    setRunResults({});
    setIsApplying(true);
    try {
      setRunResults((results) => ({ ...results, renew: { status: "running", message: "Kayıtlar yenileniyor." } }));
      if (snapshot.renew.length > 0) {
        const body = renewRequestBody(snapshot, state);
        const result = await bulkRenew(accessToken, body, await stepRequestKey(runId, "yenileme", body));
        setRunResults((results) => ({ ...results, renew: { status: "done", message: `${result.updatedCount} öğrencinin kaydı yeni döneme taşındı.` } }));
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
        const body = statusRequestBody(items, status);
        const result = await bulkUpdateStatus(accessToken, body, await stepRequestKey(runId, label === "mezun" ? "mezun" : "ayrilan", body));
        messages.push(`${result.updatedCount + result.unchangedCount} öğrenci ${label} olarak işaretlendi.`);
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
      {state.step === 1 || !calendarReady ? (
        <CalendarStep
          accessToken={accessToken}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ["term-transition-years", tenantKey] });
            void queryClient.invalidateQueries({ queryKey: ["term-transition-terms", tenantKey] });
          }}
          onSelect={(academicYearId, termId) => navigate({ academicYearId, termId, confirmed: false, step: 1 })}
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
          onChange={(classTargets) => navigate({ classTargets, confirmed: false })}
          plan={plan}
          state={state}
        />
      ) : null}
      {calendarReady && state.step === 3 ? (
        <ExitReviewStep
          classes={classesQuery.data ?? []}
          loading={!plan}
          onConfirm={(confirmed) => navigate({ confirmed })}
          onOverrides={(overrides) => navigate({ overrides, confirmed: false })}
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
          loading={!plan || (Boolean(renewBody) && previewQuery.isLoading)}
          plan={plan}
          preview={renewBody ? preview : undefined}
          termStarted={calendarStarted}
        />
      ) : null}
      {calendarReady && state.step === 6 && year && term ? (
        <Panel aria-label="Geçişi uygulama" description="Adımlar sırayla uygulanır: kayıt yenileme, mezun ve ayrılanlar, yıl ve dönemin etkinleştirilmesi. Yarıda kalan bir uygulamayı yeniden başlattığınızda tamamlanan adımlar tekrarlanmaz." title="Geçişi uygulayın">
          <ol className="next-onboarding-fields" aria-label="Uygulama adımları">
            <RunStepItem
              fallback={plan ? (plan.renew.length > 0 ? `${plan.renew.length} öğrencinin kaydı yenilenecek.` : `Yenilenecek öğrenci yok. Bu dönemde ${plan.alreadyInTerm.length} öğrenci var.`) : "Hazırlanıyor."}
              label="1. Kayıt yenileme"
              pendingDone={Boolean(plan && plan.renew.length === 0)}
              result={runResults.renew}
            />
            <RunStepItem
              fallback={plan ? (exitCount > 0 ? `${plan.graduate.length} mezun, ${plan.leave.length} ayrılan öğrenci işaretlenecek.` : "Bekleyen mezun veya ayrılan öğrenci yok.") : "Hazırlanıyor."}
              label="2. Mezun ve ayrılanlar"
              pendingDone={Boolean(plan && exitCount === 0)}
              result={runResults.status}
            />
            <RunStepItem
              fallback={calendarActive ? `${year.name} ${term.name} etkin dönem.` : `${year.name} ${term.name} etkin dönem yapılacak; diğer yıl ve dönemler etkinliğini yitirir.`}
              label="3. Yıl ve dönem etkinleştirme"
              pendingDone={calendarActive}
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
          {plan && plan.renew.length === 0 && exitCount === 0 && calendarActive && !isApplying ? (
            <Alert tone="success">Dönem geçişi tamamlandı.</Alert>
          ) : null}
          <div className="next-onboarding-actions">
            <Button
              disabled={!plan || isApplying || isRefreshing || applyBlockers.length > 0 || (plan.renew.length === 0 && exitCount === 0 && calendarActive)}
              onClick={() => void apply()}
              type="button"
            >
              {isApplying ? "Uygulanıyor…" : Object.values(runResults).some((result) => result?.status === "error") ? "Yeniden deneyin" : "Geçişi uygulayın"}
            </Button>
          </div>
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
    </div>
  );
}

function RunStepItem({ fallback, label, pendingDone, result }: { fallback: string; label: string; pendingDone: boolean; result?: RunStepResult }) {
  const status = result?.status ?? (pendingDone ? "done" : "pending");
  const badge = {
    done: { label: "Tamamlandı", tone: "success" as const },
    error: { label: "Tamamlanamadı", tone: "danger" as const },
    pending: { label: "Bekliyor", tone: "neutral" as const },
    running: { label: "Sürüyor", tone: "info" as const },
  }[status];
  return (
    <li>
      <strong>{label}</strong> <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      <p role={result?.status === "error" ? "alert" : undefined}>{result?.message ?? fallback}</p>
    </li>
  );
}

function compareByStart(left: AcademicYearRecord | AcademicTermRecord, right: AcademicYearRecord | AcademicTermRecord) {
  return right.startsAt.localeCompare(left.startsAt) || left.name.localeCompare(right.name, "tr-TR");
}

/** Today in Türkiye; the server compares term starts with the same calendar date. */
function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date());
}
