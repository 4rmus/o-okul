"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AcademicYearRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  GradeLevelCourseRecord,
  GradeLevelRecord,
  LearningOutcomeImportDryRunResult,
  LearningOutcomeImportResult,
  StudentImportDryRunResult,
  StudentImportResult,
  TeacherImportDryRunResult,
  TeacherImportResult,
} from "@o-okul/shared-types";
import { Button, Field, Input, MetricCard, MetricGrid, Panel, SegmentedControl, Select, StatusBadge, TabButton, Tabs } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiListRequest, apiRequest, queryClient } from "../../../../src/api-client.js";
import { ImportTemplatePanel } from "../_shared/import-template-panel.js";
import { GuardianAutoNotificationSettings } from "./_shared/guardian-auto-notification-settings.js";
import { PageFrame } from "../_shared/page-frame.js";
import { useSetupProgress } from "./_shared/use-setup-progress.js";
import { setupFlowSteps, type SetupFlowStep } from "./_shared/wizard-steps.js";

type StepId = SetupFlowStep["id"] | "readiness";
type StageId = "7" | "8-LGS" | "10" | "11" | "12" | "TYT/AYT";
type SetupImportFileExtension = "CSV" | "XLSX";
type SetupUploadStatusState = "idle" | "ready" | "error";
type SetupCourseOption = {
  id: string;
  name: string;
  code: string;
  isDefault?: boolean;
  stageId?: StageId;
  targetStageIds?: StageId[];
};
type SetupCourseGroup = { title: string; source: string; courses: SetupCourseOption[]; stageId?: StageId };

interface SetupUploadStatus {
  badge: string;
  detail: string;
  meta: string;
  state: SetupUploadStatusState;
  title: string;
  tone: "info" | "success" | "danger";
}

interface OnboardingDraft {
  classes: {
    campusId: string;
    classCounts: Record<StageId, string>;
    classNames: Record<string, string>;
  };
  courses: {
    selectedCourseIds: string[];
  };
  general: {
    contactEmail: string;
    institutionName: string;
    institutionType: "course-center" | "school" | "study-center";
    logoUrl: string;
  };
  people: {
    kazanimImportFileName: string;
    studentImportFileName: string;
    studentModel: "manual" | "excel";
    teacherImportFileName: string;
    teacherModel: "manual" | "excel";
  };
  term: {
    academicYearName: string;
    endsAt: string;
    startsAt: string;
    termEndsAt: string;
    termName: string;
    termStartsAt: string;
  };
}

type StepErrors = Record<string, string>;

interface TenantProfileRecord {
  contactEmail?: string;
  id: string;
  institutionType?: string;
  logoUrl?: string;
  name: string;
}

const steps = setupFlowSteps;
const readinessStep = {
  id: "readiness" as const,
  path: "/kurum/kurulum/hazirlik",
  kicker: "Sonuç",
  title: "Hazırlık Kontrolü",
  description: "Sunucudaki gerçek kurum kayıtlarını doğrula ve eksik adımları gör.",
};

const initialDraft: OnboardingDraft = {
  classes: {
    campusId: "",
    classCounts: {
      "7": "0",
      "8-LGS": "2",
      "10": "0",
      "11": "0",
      "12": "0",
      "TYT/AYT": "0",
    },
    classNames: {},
  },
  courses: {
    selectedCourseIds: ["8-lgs-turkce", "8-lgs-matematik", "8-lgs-fen"],
  },
  general: {
    contactEmail: "",
    institutionName: "",
    institutionType: "course-center",
    logoUrl: "",
  },
  people: {
    kazanimImportFileName: "",
    studentImportFileName: "",
    studentModel: "excel",
    teacherImportFileName: "",
    teacherModel: "manual",
  },
  term: {
    academicYearName: "2026-2027",
    endsAt: "2027-06-19",
    startsAt: "2026-09-01",
    termEndsAt: "2027-01-16",
    termName: "1. Dönem",
    termStartsAt: "2026-09-01",
  },
};

const stageOptions: Array<{ id: StageId; label: string }> = [
  { id: "7", label: "7. sınıf" },
  { id: "8-LGS", label: "8. sınıf / LGS" },
  { id: "10", label: "10. sınıf" },
  { id: "11", label: "11. sınıf" },
  { id: "12", label: "12. sınıf" },
  { id: "TYT/AYT", label: "TYT/AYT" },
];

const fallbackCourseGroups: SetupCourseGroup[] = [
  {
    title: "7. sınıflar",
    source: "Ortaokul temel dersleri",
    stageId: "7",
    courses: [
      { id: "7-turkce", name: "Türkçe", code: "7-TUR" },
      { id: "7-matematik", name: "Matematik", code: "7-MAT" },
      { id: "7-fen", name: "Fen Bilgisi", code: "7-FEN" },
      { id: "7-sosyal", name: "Sosyal Bilgiler", code: "7-SOS" },
      { id: "7-ingilizce", name: "Yabancı Dil (İngilizce)", code: "7-ING" },
      { id: "7-din", name: "Din Kültürü", code: "7-DIN" },
    ],
  },
  {
    title: "8. sınıflar / LGS",
    source: "LGS sınavı hazırlık dersleri",
    stageId: "8-LGS",
    courses: [
      { id: "8-lgs-turkce", name: "Türkçe", code: "LGS-TUR" },
      { id: "8-lgs-matematik", name: "Matematik", code: "LGS-MAT" },
      { id: "8-lgs-fen", name: "Fen Bilgisi", code: "LGS-FEN" },
      { id: "8-lgs-inkilap", name: "Atatürk İlke ve İnkılapları", code: "LGS-INK" },
      { id: "8-lgs-ingilizce", name: "Yabancı Dil (İngilizce)", code: "LGS-ING" },
      { id: "8-lgs-din", name: "Din Kültürü", code: "LGS-DIN" },
    ],
  },
  {
    title: "10. sınıflar",
    source: "Lise ortak dersleri",
    stageId: "10",
    courses: [
      { id: "10-edebiyat", name: "Türk Dili ve Edebiyatı", code: "10-EDE" },
      { id: "10-matematik", name: "Matematik", code: "10-MAT" },
      { id: "10-fizik", name: "Fizik", code: "10-FIZ" },
      { id: "10-kimya", name: "Kimya", code: "10-KIM" },
      { id: "10-biyoloji", name: "Biyoloji", code: "10-BIY" },
      { id: "10-tarih", name: "Tarih", code: "10-TAR" },
      { id: "10-cografya", name: "Coğrafya", code: "10-COG" },
      { id: "10-felsefe", name: "Felsefe", code: "10-FEL" },
      { id: "10-din", name: "Din Kültürü ve Ahlak Bilgisi", code: "10-DIN" },
      { id: "10-ingilizce", name: "Yabancı Dil (İngilizce)", code: "10-ING" },
    ],
  },
  {
    title: "11, 12 ve TYT/AYT",
    source: "Alan gruplarına göre sınav hazırlık dersleri",
    stageId: "TYT/AYT",
    courses: [
      { id: "ayt-temel-matematik", name: "Temel Matematik", code: "AYT-TMAT" },
      { id: "ayt-geometri", name: "Geometri", code: "AYT-GEO" },
      { id: "ayt-fizik", name: "Fizik", code: "AYT-FIZ" },
      { id: "ayt-kimya", name: "Kimya", code: "AYT-KIM" },
      { id: "ayt-biyoloji", name: "Biyoloji", code: "AYT-BIY" },
      { id: "ayt-edebiyat", name: "Türk Dili ve Edebiyatı", code: "AYT-EDE" },
      { id: "ayt-tarih", name: "Tarih", code: "AYT-TAR" },
      { id: "ayt-cografya", name: "Coğrafya", code: "AYT-COG" },
      { id: "ayt-felsefe", name: "Felsefe grubu", code: "AYT-FEL" },
      { id: "ayt-sosyoloji", name: "Sosyoloji", code: "AYT-SOZ" },
      { id: "ayt-psikoloji", name: "Psikoloji", code: "AYT-PSI" },
      { id: "ayt-mantik", name: "Mantık", code: "AYT-MAN" },
      { id: "ydt-ingilizce", name: "İleri Yabancı Dil (İngilizce)", code: "YDT-ING" },
      { id: "ydt-almanca", name: "İleri Yabancı Dil (Almanca)", code: "YDT-ALM" },
    ],
  },
];

const fallbackCourseOptions = fallbackCourseGroups.flatMap((group) => group.courses);
const setupImportMaxBytes = 5 * 1024 * 1024;
const setupImportAllowedExtensions = new Set<SetupImportFileExtension>(["CSV", "XLSX"]);

export function SetupWizard({ initialStep = "general" }: { initialStep?: StepId }) {
  const { auth } = useAuth();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const draftStorageKey = `uh_onboarding_${tenantId}_draft`;
  const [activeStepId, setActiveStepId] = useState<StepId>(initialStep);
  const [draft, setDraft] = useState<OnboardingDraft>(initialDraft);
  const [errors, setErrors] = useState<StepErrors>({});
  const [isCheckingImports, setIsCheckingImports] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedSummary, setSavedSummary] = useState("");
  const [kazanimImportFileBase64, setKazanimImportFileBase64] = useState("");
  const [kazanimImportIdempotencyKey, setKazanimImportIdempotencyKey] = useState("");
  const [studentImportFileBase64, setStudentImportFileBase64] = useState("");
  const [studentImportIdempotencyKey, setStudentImportIdempotencyKey] = useState("");
  const [teacherImportFileBase64, setTeacherImportFileBase64] = useState("");
  const [teacherImportIdempotencyKey, setTeacherImportIdempotencyKey] = useState("");
  const [kazanimImportUploadStatus, setKazanimImportUploadStatus] = useState<SetupUploadStatus>(() =>
    createIdleUploadStatus(),
  );
  const [studentImportUploadStatus, setStudentImportUploadStatus] = useState<SetupUploadStatus>(() =>
    createIdleUploadStatus(),
  );
  const [teacherImportUploadStatus, setTeacherImportUploadStatus] = useState<SetupUploadStatus>(() =>
    createIdleUploadStatus(),
  );
  const [loadedDraftKey, setLoadedDraftKey] = useState("");
  const tenantProfileQuery = useQuery({
    queryKey: ["next-current-tenant", tenantId],
    queryFn: () => loadCurrentTenant(auth?.accessToken ?? ""),
    enabled: Boolean(auth?.accessToken),
  });
  const courseTemplatesQuery = useQuery({
    queryKey: ["next-setup-course-templates", tenantId],
    queryFn: () => loadCourseTemplateGroups(auth?.accessToken ?? ""),
    enabled: Boolean(auth?.accessToken),
  });
  const campusesQuery = useQuery({
    queryKey: ["next-campuses", tenantId],
    queryFn: () => apiListRequest<CampusRecord>(auth?.accessToken ?? "", `${apiBaseUrl}/campuses?limit=200`),
    enabled: Boolean(auth?.accessToken),
  });
  const setupProgressQuery = useSetupProgress(
    auth?.accessToken ?? "",
    tenantId,
    Boolean(auth?.accessToken),
  );
  const courseGroups = useMemo(
    () => mergeCourseTemplateGroups(courseTemplatesQuery.data ?? []),
    [courseTemplatesQuery.data],
  );
  const campuses = useMemo(() => campusesQuery.data?.data ?? [], [campusesQuery.data]);
  const allCourseOptions = useMemo(
    () => courseGroups.flatMap((group) => group.courses.map((course) => ({ ...course, stageId: course.stageId ?? group.stageId }))),
    [courseGroups],
  );
  const courseTemplateError = courseTemplatesQuery.isError
    ? "Ders şablonları alınamadı."
    : "";
  const campusError = campusesQuery.isError ? "Kampüsler alınamadı." : "";
  const isReadinessStep = activeStepId === "readiness";
  const activeStepIndex = steps.findIndex((step) => step.id === activeStepId);
  const activeStep = isReadinessStep ? readinessStep : steps[Math.max(0, activeStepIndex)]!;
  const stepValidation = useMemo(
    () => new Map(steps.map((step) => [step.id, validateStep(step.id, draft, allCourseOptions, campuses)])),
    [allCourseOptions, campuses, draft],
  );
  const completedStepCount = steps.filter((step) => Object.keys(stepValidation.get(step.id) ?? {}).length === 0).length;
  const progressPercent = Math.round((completedStepCount / steps.length) * 100);
  const isFinished = setupProgressQuery.data?.status === "READY";
  const readinessHeadline = setupProgressQuery.isPending
    ? "Sunucu kayıtları kontrol ediliyor."
    : setupProgressQuery.isError
      ? "Kurulum durumu doğrulanamadı."
      : isFinished
        ? "Çekirdek kurulum tamamlandı."
        : "Kurulumda tamamlanması gereken kayıtlar var.";
  const readinessMetricValue = setupProgressQuery.isPending
    ? "Kontrol ediliyor"
    : setupProgressQuery.isError
      ? "Doğrulanamadı"
      : isFinished ? "Hazır" : "Eksik";
  const selectedCourses = selectedCourseOptions(draft.courses.selectedCourseIds, allCourseOptions);
  const generatedClasses = generateClasses(draft.classes.classCounts, draft.classes.classNames);
  const courseCount = selectedCourses.length;
  const classCount = generatedClasses.length;

  useEffect(() => {
    setActiveStepId(initialStep);
    setErrors({});
  }, [initialStep]);

  useEffect(() => {
    function syncStepFromHistory() {
      const step = window.location.pathname === readinessStep.path
        ? readinessStep
        : steps.find((candidate) => candidate.path === window.location.pathname);
      if (!step) return;
      setActiveStepId(step.id);
      setErrors({});
    }
    window.addEventListener("popstate", syncStepFromHistory);
    return () => window.removeEventListener("popstate", syncStepFromHistory);
  }, []);

  useEffect(() => {
    if (!auth || typeof window === "undefined") return;
    const storedDraft = readDraftFromSession(draftStorageKey);
    if (storedDraft) {
      setDraft(mergeDraft(storedDraft));
    } else {
      setDraft(initialDraft);
    }
    setLoadedDraftKey(draftStorageKey);
  }, [auth, draftStorageKey]);

  useEffect(() => {
    if (!auth || loadedDraftKey !== draftStorageKey || typeof window === "undefined") return;
    writeDraftToSession(draftStorageKey, sanitizeDraftForStorage(draft));
  }, [auth, draft, draftStorageKey, loadedDraftKey]);

  useEffect(() => {
    if (loadedDraftKey !== draftStorageKey || !tenantProfileQuery.data) return;
    setDraft((current) => mergeTenantProfileDraft(current, tenantProfileQuery.data!));
  }, [draftStorageKey, loadedDraftKey, tenantProfileQuery.data]);

  useEffect(() => {
    if (!campusesQuery.data) return;
    setDraft((current) => {
      const currentCampusExists = campuses.some((campus) => campus.id === current.classes.campusId);
      const campusId = currentCampusExists ? current.classes.campusId : campuses.length === 1 ? campuses[0]!.id : "";
      if (campusId === current.classes.campusId) return current;
      return { ...current, classes: { ...current.classes, campusId } };
    });
  }, [campuses, campusesQuery.data]);

  useEffect(() => {
    const activeStageIds = activeStageIdsFromClassCounts(draft.classes.classCounts);
    if (activeStageIds.length === 0) return;
    setDraft((current) => {
      const defaultCourseIds = defaultCourseIdsForStages(activeStageIdsFromClassCounts(current.classes.classCounts), allCourseOptions);
      if (defaultCourseIds.length === 0 || sameStringList(current.courses.selectedCourseIds, defaultCourseIds)) return current;
      return {
        ...current,
        courses: {
          ...current.courses,
          selectedCourseIds: defaultCourseIds,
        },
      };
    });
  }, [allCourseOptions, draft.classes.classCounts]);

  function updateDraft(section: keyof OnboardingDraft, nextValue: Partial<OnboardingDraft[typeof section]>) {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...nextValue,
      },
    }));
  }

  function goToStep(stepId: StepId) {
    setActiveStepId(stepId);
    setErrors({});
    const step = stepId === "readiness" ? readinessStep : steps.find((candidate) => candidate.id === stepId);
    if (step && window.location.pathname !== step.path) {
      window.history.pushState(null, "", step.path);
    }
  }

  function goNext() {
    if (activeStepId === "readiness") return;
    const nextErrors = validateStep(activeStepId, draft, allCourseOptions, campuses);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const nextStep = steps[activeStepIndex + 1];
    if (nextStep) {
      goToStep(nextStep.id);
    }
  }

  function goBack() {
    if (isReadinessStep) {
      goToStep("people");
      return;
    }
    const previousStep = steps[activeStepIndex - 1];
    if (!previousStep) return;
    goToStep(previousStep.id);
  }

  async function changeStudentImportFile(file: File | undefined) {
    setStudentImportFileBase64("");
    setStudentImportIdempotencyKey("");
    setSaveError("");
    setSavedSummary("");
    if (!file) {
      setStudentImportUploadStatus(createIdleUploadStatus());
      updateDraft("people", { studentImportFileName: "" });
      return;
    }

    const validation = validateSetupImportFile(file);
    setStudentImportUploadStatus(validation.status);
    updateDraft("people", { studentImportFileName: validation.accepted ? validation.notice : "" });
    if (!validation.accepted) return;

    try {
      setStudentImportFileBase64(await readFileAsBase64(file));
      setStudentImportIdempotencyKey(globalThis.crypto.randomUUID());
    } catch {
      setStudentImportUploadStatus(createErrorUploadStatus(file, "Dosya okunamadı. Lütfen dosyayı yeniden seçin."));
      updateDraft("people", { studentImportFileName: "" });
      setSaveError("Öğrenci aktarım dosyası okunamadı.");
    }
  }

  async function changeTeacherImportFile(file: File | undefined) {
    setTeacherImportFileBase64("");
    setTeacherImportIdempotencyKey("");
    setSaveError("");
    setSavedSummary("");
    if (!file) {
      setTeacherImportUploadStatus(createIdleUploadStatus());
      updateDraft("people", { teacherImportFileName: "" });
      return;
    }
    const validation = validateSetupImportFile(file);
    setTeacherImportUploadStatus(validation.status);
    updateDraft("people", { teacherImportFileName: validation.accepted ? validation.notice : "" });
    if (!validation.accepted) return;

    try {
      setTeacherImportFileBase64(await readFileAsBase64(file));
      setTeacherImportIdempotencyKey(globalThis.crypto.randomUUID());
    } catch {
      setTeacherImportUploadStatus(createErrorUploadStatus(file, "Dosya okunamadı. Lütfen dosyayı yeniden seçin."));
      updateDraft("people", { teacherImportFileName: "" });
      setSaveError("Öğretmen aktarım dosyası okunamadı.");
    }
  }

  async function changeKazanimImportFile(file: File | undefined) {
    setKazanimImportFileBase64("");
    setKazanimImportIdempotencyKey("");
    setSaveError("");
    setSavedSummary("");
    if (!file) {
      setKazanimImportUploadStatus(createIdleUploadStatus());
      updateDraft("people", { kazanimImportFileName: "" });
      return;
    }

    const validation = validateSetupImportFile(file);
    setKazanimImportUploadStatus(validation.status);
    updateDraft("people", { kazanimImportFileName: validation.accepted ? validation.notice : "" });
    if (!validation.accepted) return;

    try {
      setKazanimImportFileBase64(await readFileAsBase64(file));
      setKazanimImportIdempotencyKey(globalThis.crypto.randomUUID());
    } catch {
      setKazanimImportUploadStatus(createErrorUploadStatus(file, "Dosya okunamadı. Lütfen dosyayı yeniden seçin."));
      updateDraft("people", { kazanimImportFileName: "" });
      setSaveError("Kazanım aktarım dosyası okunamadı.");
    }
  }

  function changeStudentModel(model: OnboardingDraft["people"]["studentModel"]) {
    setStudentImportFileBase64("");
    setStudentImportIdempotencyKey("");
    setStudentImportUploadStatus(createIdleUploadStatus());
    setSavedSummary("");
    updateDraft("people", { studentImportFileName: "", studentModel: model });
  }

  function changeTeacherModel(model: OnboardingDraft["people"]["teacherModel"]) {
    setTeacherImportFileBase64("");
    setTeacherImportIdempotencyKey("");
    setTeacherImportUploadStatus(createIdleUploadStatus());
    setSavedSummary("");
    updateDraft("people", { teacherImportFileName: "", teacherModel: model });
  }

  async function checkImportFiles() {
    if (teacherImportUploadStatus.state === "error") {
      setSaveError("Öğretmen aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (studentImportUploadStatus.state === "error") {
      setSaveError("Öğrenci aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (kazanimImportUploadStatus.state === "error") {
      setSaveError("Kazanım aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (draft.people.teacherModel === "excel" && !teacherImportFileBase64) {
      setSaveError("Öğretmen aktarım dosyası seçilmelidir.");
      return;
    }
    if (draft.people.studentModel === "excel" && !studentImportFileBase64) {
      setSaveError("Öğrenci aktarım dosyası seçilmelidir.");
      return;
    }
    if (draft.people.teacherModel !== "excel" && draft.people.studentModel !== "excel" && !kazanimImportFileBase64) {
      setSaveError("Ön kontrol için en az bir aktarım dosyası seçin.");
      return;
    }
    if (!auth?.accessToken) {
      setSaveError("Oturum bulunamadı. Yeniden giriş yapıp tekrar deneyin.");
      return;
    }

    setIsCheckingImports(true);
    setSaveError("");
    setSavedSummary("");
    try {
      const checked: string[] = [];
      if (draft.people.teacherModel === "excel" && teacherImportFileBase64) {
        const dryRun = await dryRunTeacherImport(auth.accessToken, teacherImportFileBase64);
        if (!dryRun.wouldImport) throw new Error(teacherImportErrorMessage(dryRun));
        checked.push(`${dryRun.validRows.length} öğretmen`);
        setTeacherImportUploadStatus(markUploadStatusServerChecked);
      }
      if (draft.people.studentModel === "excel" && studentImportFileBase64) {
        const dryRun = await dryRunStudentImport(auth.accessToken, studentImportFileBase64);
        if (!dryRun.wouldImport) throw new Error(studentImportErrorMessage(dryRun));
        checked.push(`${dryRun.validRows.length} öğrenci`);
        setStudentImportUploadStatus(markUploadStatusServerChecked);
      }
      if (kazanimImportFileBase64) {
        const dryRun = await dryRunLearningOutcomeImport(auth.accessToken, kazanimImportFileBase64);
        if (!dryRun.wouldImport) throw new Error(kazanimImportErrorMessage(dryRun));
        checked.push(`${dryRun.validRows.length} kazanım`);
        setKazanimImportUploadStatus(markUploadStatusServerChecked);
      }
      setSavedSummary(`Sunucu ön kontrolü geçti: ${checked.join(", ")}. Henüz kayıt oluşturulmadı.`);
    } catch (error) {
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Aktarım dosyaları ön kontrolden geçirilemedi. Lütfen dosyaları kontrol edin.",
      );
    } finally {
      setIsCheckingImports(false);
    }
  }

  async function finishSetup() {
    const allErrors = Object.fromEntries(
      steps.flatMap((step) =>
        Object.entries(validateStep(step.id, draft, allCourseOptions, campuses)).map(([field, message]) => [
          `${step.id}.${field}`,
          message,
        ]),
      ),
    );
    if (Object.keys(allErrors).length > 0) {
      const firstInvalidStep = steps.find(
        (step) => Object.keys(validateStep(step.id, draft, allCourseOptions, campuses)).length > 0,
      );
      if (firstInvalidStep) goToStep(firstInvalidStep.id);
      setErrors(allErrors);
      return;
    }
    if (courseTemplatesQuery.isLoading) {
      goToStep("courses");
      setSaveError("Ders şablonları yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.");
      return;
    }
    if (courseTemplateError) {
      goToStep("courses");
      setSaveError(courseTemplateError);
      return;
    }
    if (campusesQuery.isLoading) {
      goToStep("classes");
      setSaveError("Kampüsler yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.");
      return;
    }
    if (campusError) {
      goToStep("classes");
      setSaveError(campusError);
      return;
    }
    if (studentImportUploadStatus.state === "error") {
      goToStep("people");
      setSaveError("Öğrenci aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (teacherImportUploadStatus.state === "error") {
      goToStep("people");
      setSaveError("Öğretmen aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (kazanimImportUploadStatus.state === "error") {
      goToStep("people");
      setSaveError("Kazanım aktarım dosyasını desteklenen tür ve boyutla yeniden seçin.");
      return;
    }
    if (draft.people.teacherModel === "excel" && !teacherImportFileBase64) {
      goToStep("people");
      setSaveError("Öğretmen aktarım dosyası seçilmelidir.");
      return;
    }
    if (draft.people.studentModel === "excel" && !studentImportFileBase64) {
      goToStep("people");
      setSaveError("Öğrenci aktarım dosyası seçilmelidir.");
      return;
    }
    if (
      (draft.people.teacherModel === "excel" && !teacherImportIdempotencyKey)
      || (draft.people.studentModel === "excel" && !studentImportIdempotencyKey)
      || (kazanimImportFileBase64 && !kazanimImportIdempotencyKey)
    ) {
      goToStep("people");
      setSaveError("Aktarım dosyası hazırlanamadı. Lütfen dosyayı yeniden seçin.");
      return;
    }
    if (!auth?.accessToken) {
      setSaveError("Oturum bulunamadı. Yeniden giriş yapıp tekrar deneyin.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    setSavedSummary("");
    try {
      const accessCheck = await setupProgressQuery.refetch();
      if (accessCheck.isError) {
        setSaveError(accessCheck.error instanceof ApiRequestError && accessCheck.error.status === 403
          ? "Kurulum yalnız kurum genelinde yetkili bir hesapla tamamlanabilir."
          : "Sunucu kurulum durumu doğrulanamadı. Kayıt başlatılmadı; lütfen tekrar deneyin.");
        return;
      }
      const result = await saveSetup(
        auth.accessToken,
        draft,
        teacherImportFileBase64,
        teacherImportIdempotencyKey,
        studentImportFileBase64,
        studentImportIdempotencyKey,
        kazanimImportFileBase64,
        kazanimImportIdempotencyKey,
        allCourseOptions,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["next-academic-years", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-academic-terms", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-courses", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-classes", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-teachers", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-teacher-assignment-refs", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-students", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-student-refs", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-guardians", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-learning-outcomes", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-current-tenant", tenantId] }),
        queryClient.invalidateQueries({ queryKey: ["next-user-subject-refs", tenantId] }),
      ]);
      const refreshedReadiness = await setupProgressQuery.refetch();
      if (refreshedReadiness.isError) {
        setSaveError("Kayıtlar kaydedildi ancak sunucu kurulum durumu doğrulanamadı. Durumu yeniden kontrol edin.");
      }
      const studentSummary =
        result.importedStudents > 0
          ? `${result.importedStudents} öğrenci ve dosyadaki iletişim kişileri işlendi`
          : `${result.importedStudents} öğrenci eklendi`;
      const outcomeSummary = result.importedOutcomes > 0 ? `, ${result.importedOutcomes} kazanım` : "";
      setSavedSummary(
        `${result.createdClasses} sınıf, ${result.createdCourses} ders, ${result.createdTeachers} öğretmen, ${result.createdTeacherAssignments} öğretmen ataması, ${result.createdAcademicYears} akademik yıl, ${result.createdAcademicTerms} dönem, ${studentSummary}${outcomeSummary}. ${result.repairedClasses > 0 ? `${result.repairedClasses} sınıf bağlantısı tamamlandı. ` : ""}Mevcut kayıtlar tekrar eklenmedi.`,
      );
      goToStep("readiness");
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "CLASS_NAME_ALREADY_EXISTS") {
        goToStep("classes");
        setSaveError("Bu sınıf adı kurumda aktif olarak kullanılıyor. Farklı bir ad girin.");
      } else if (error instanceof Error && error.message.startsWith("SETUP_CLASS_CONTEXT_CONFLICT:")) {
        goToStep("classes");
        setSaveError(error.message.slice("SETUP_CLASS_CONTEXT_CONFLICT:".length));
      } else if (error instanceof ApiRequestError) {
        setSaveError("Sunucudan kesin sonuç alınamadı. Aynı bilgilerle tekrar deneyin; tamamlanan kayıtlar yeniden eklenmez.");
      } else {
        setSaveError(error instanceof Error && error.message
          ? error.message
          : "Kurulum kayıtları sisteme eklenemedi. Lütfen tekrar deneyin.");
      }
      return;
    } finally {
      setIsSaving(false);
    }
    setDraft((current) => ({
      ...current,
      people: {
        ...current.people,
        kazanimImportFileName: "",
        studentImportFileName: "",
        studentModel: "manual",
        teacherImportFileName: "",
        teacherModel: "manual",
      },
    }));
    setKazanimImportFileBase64("");
    setKazanimImportIdempotencyKey("");
    setStudentImportFileBase64("");
    setStudentImportIdempotencyKey("");
    setTeacherImportFileBase64("");
    setTeacherImportIdempotencyKey("");
    setKazanimImportUploadStatus(createIdleUploadStatus());
    setStudentImportUploadStatus(createIdleUploadStatus());
    setTeacherImportUploadStatus(createIdleUploadStatus());
  }

  return (
    <PageFrame title="Kurulum Sihirbazı" subtitle="Yeni kurumun ilk çalışma düzenini beş adımda hazırla.">
      <section className="next-onboarding-hero" aria-label="Kurulum karşılama">
        <div>
          <span>{isFinished ? "Temel kurum kayıtları oluşturuldu" : "İlk giriş akışı"}</span>
          <h2>{draft.general.institutionName || "Kurumunu birlikte hazırlayalım"}</h2>
          <p>Genel bilgilerden kişi yönetimine kadar temel kararları tek akışta toparla.</p>
        </div>
        <MetricGrid className="next-onboarding-metrics" aria-label="Kurulum operasyon metrikleri" role="region">
          <MetricCard
            label={isReadinessStep ? "Çekirdek hazırlık" : "Form ilerlemesi"}
            value={isReadinessStep ? readinessMetricValue : `${progressPercent}%`}
            description={isReadinessStep ? "Sunucu kayıtları" : `${completedStepCount} / ${steps.length} adım doğrulandı`}
            tone={(isReadinessStep && isFinished) || (!isReadinessStep && progressPercent === 100) ? "success" : "info"}
          />
          <MetricCard label="Ders" value={courseCount} description="Seçili ders" />
          <MetricCard label="Sınıf" value={classCount} description="Oluşturulacak şube" />
        </MetricGrid>
      </section>

      {!isReadinessStep ? <section className="next-onboarding-progress">
        <div className="next-onboarding-progress__bar">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
        <Tabs label="Adım ilerlemesi" className="next-onboarding-tabs">
          {steps.map((step, index) => {
            const stepErrors = stepValidation.get(step.id) ?? {};
            const isComplete = Object.keys(stepErrors).length === 0;
            return (
              <TabButton key={step.id} selected={step.id === activeStepId} onClick={() => goToStep(step.id)}>
                <span className="next-onboarding-step-index">{index + 1}</span>
                <strong>{step.title}</strong>
                <small>{isComplete ? "Hazır" : "Eksik"}</small>
              </TabButton>
            );
          })}
        </Tabs>
      </section> : null}

      <section className="next-onboarding-layout" aria-label="Kurulum formu">
        <Panel className="next-onboarding-panel" key={activeStep.id}>
          <header>
            <span>{activeStep.kicker}</span>
            <h2>{activeStep.title}</h2>
            <p>{activeStep.description}</p>
          </header>
          {activeStep.id === "general" ? (
            <>
              <GeneralStep draft={draft} errors={errors} updateDraft={updateDraft} />
              <GuardianAutoNotificationSettings />
            </>
          ) : null}
          {activeStep.id === "term" ? (
            <TermStep draft={draft} errors={errors} updateDraft={updateDraft} />
          ) : null}
          {activeStep.id === "classes" ? (
            <ClassesStep
              campuses={campuses}
              draft={draft}
              errorMessage={campusError}
              errors={errors}
              isLoading={campusesQuery.isLoading}
              updateDraft={updateDraft}
            />
          ) : null}
          {activeStep.id === "courses" ? (
            <CoursesStep
              allCourseOptions={allCourseOptions}
              courseGroups={courseGroups}
              draft={draft}
              errorMessage={courseTemplateError}
              errors={errors}
              isLoading={courseTemplatesQuery.isLoading}
              updateDraft={updateDraft}
            />
          ) : null}
          {activeStep.id === "people" ? (
            <PeopleStep
              draft={draft}
              errors={errors}
              kazanimImportUploadStatus={kazanimImportUploadStatus}
              onKazanimImportFileChange={(file) => void changeKazanimImportFile(file)}
              onStudentModelChange={changeStudentModel}
              onTeacherImportFileChange={(file) => void changeTeacherImportFile(file)}
              onTeacherModelChange={changeTeacherModel}
              onStudentImportFileChange={(file) => void changeStudentImportFile(file)}
              studentImportUploadStatus={studentImportUploadStatus}
              teacherImportUploadStatus={teacherImportUploadStatus}
            />
          ) : null}
          {activeStep.id === "readiness" ? (
            <div className="next-onboarding-done" aria-label="Hazırlık kontrolü">
              <strong>{readinessHeadline}</strong>
              {setupProgressQuery.isPending ? <span>Kurulum kayıtları doğrulanıyor…</span> : null}
              {setupProgressQuery.isError ? <span>Kurulum durumu doğrulanamadı; tamamlandı kabul edilmiyor.</span> : null}
              {setupProgressQuery.data ? (
                <ul>
                  {setupProgressQuery.data.steps.map((step) => (
                    <li key={step.key}>
                      <span>{setupReadinessLabel(step.key)}</span>
                      <StatusBadge tone={step.ready ? "success" : step.required ? "warning" : "info"}>
                        {step.ready ? "Hazır" : step.required ? "Eksik" : "Sonraki adım"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : null}
              {steps.map((step) => step.readinessChecks.length > 0 ? (
                <details key={step.id}>
                  <summary>{step.title} kontrolleri</summary>
                  <ul>
                    {step.readinessChecks.map((check) => (
                      <li key={check.id}>
                        <Link href={check.href}>{check.title}</Link>
                        {check.optional ? " (isteğe bağlı)" : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null)}
            </div>
          ) : null}
          <footer className="next-onboarding-actions">
            <Button variant="secondary" type="button" onClick={goBack} disabled={activeStepIndex === 0 || isCheckingImports || isSaving}>
              Geri
            </Button>
            {isReadinessStep ? (
              <>
                <Button variant="secondary" type="button" onClick={() => void setupProgressQuery.refetch()} disabled={setupProgressQuery.isFetching}>
                  {setupProgressQuery.isFetching ? "Kontrol ediliyor" : "Durumu yenile"}
                </Button>
                <Link className="uh-button uh-button--secondary uh-button--md" href="/kurum">
                  Kurum paneline dön
                </Link>
              </>
            ) : activeStep.id === "people" ? (
              <>
                {draft.people.teacherModel === "excel" || draft.people.studentModel === "excel" || kazanimImportFileBase64 ? (
                  <Button variant="secondary" type="button" onClick={() => void checkImportFiles()} disabled={isCheckingImports || isSaving}>
                    {isCheckingImports ? "Kontrol ediliyor" : "Dosyaları ön kontrol et"}
                  </Button>
                ) : null}
                <Button type="button" onClick={() => void finishSetup()} disabled={isCheckingImports || isSaving}>
                  {isSaving ? "Kaydediliyor" : "Kaydet ve kontrol et"}
                </Button>
              </>
            ) : activeStepIndex < steps.length - 1 ? (
              <Button type="button" onClick={goNext}>
                İleri
              </Button>
            ) : null}
          </footer>
          {saveError ? <p className="next-form-error" role="alert">{saveError}</p> : null}
          {savedSummary ? <p className="next-onboarding-success" role="status">{savedSummary}</p> : null}
        </Panel>

        <Panel as="aside" className="next-onboarding-aside" aria-label="Kurulum özeti">
          <h2>Akış Özeti</h2>
          <dl>
            <div>
              <dt>Kurum</dt>
              <dd>{draft.general.institutionName || "Bekliyor"}</dd>
            </div>
            <div>
              <dt>Dönem</dt>
              <dd>{draft.term.academicYearName || "Bekliyor"}</dd>
            </div>
            <div>
              <dt>Ders</dt>
              <dd>{courseCount} seçili</dd>
            </div>
            <div>
              <dt>Sınıf</dt>
              <dd>{classCount} şube</dd>
            </div>
            <div>
              <dt>Veri modeli</dt>
              <dd>{dataModelLabel(draft.people.studentModel)}</dd>
            </div>
          </dl>
          {!isReadinessStep ? (
            <div className="next-onboarding-done" aria-label="Sunucu kurulum durumu">
              <strong>Sunucu doğrulaması</strong>
              {setupProgressQuery.isPending ? <span>Kurulum kayıtları doğrulanıyor…</span> : null}
              {setupProgressQuery.isError ? (
                <span>Kurulum durumu doğrulanamadı; tamamlandı kabul edilmiyor.</span>
              ) : null}
              {setupProgressQuery.data ? (
                <ul>
                  {setupProgressQuery.data.steps.map((step) => (
                    <li key={step.key}>
                      <span>{setupReadinessLabel(step.key)}</span>
                      <StatusBadge tone={step.ready ? "success" : step.required ? "warning" : "info"}>
                        {step.ready ? "Hazır" : step.required ? "Eksik" : "Sonraki adım"}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Panel>
      </section>
    </PageFrame>
  );
}

function GeneralStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "general", nextValue: Partial<OnboardingDraft["general"]>) => void;
}) {
  return (
    <div className="next-onboarding-fields">
      <Field label="Kurum adı" error={errors.institutionName ?? errors["general.institutionName"]}>
        <Input
          invalid={Boolean(errors.institutionName ?? errors["general.institutionName"])}
          value={draft.general.institutionName}
          onChange={(event) => updateDraft("general", { institutionName: event.target.value })}
          placeholder="o-okul Eğitim Kurumu"
        />
      </Field>
      <Field label="Kurum türü">
        <Select
          value={draft.general.institutionType}
          onChange={(event) => updateDraft("general", { institutionType: event.target.value as OnboardingDraft["general"]["institutionType"] })}
        >
          <option value="course-center">Kurs merkezi</option>
          <option value="school">Okul</option>
          <option value="study-center">Etüt merkezi</option>
        </Select>
      </Field>
      <Field label="Logo adresi" error={errors.logoUrl ?? errors["general.logoUrl"]}>
        <Input
          invalid={Boolean(errors.logoUrl ?? errors["general.logoUrl"])}
          value={draft.general.logoUrl}
          onChange={(event) => updateDraft("general", { logoUrl: event.target.value })}
          placeholder="https://..."
        />
      </Field>
      <Field label="İletişim e-postası" error={errors.contactEmail ?? errors["general.contactEmail"]}>
        <Input
          invalid={Boolean(errors.contactEmail ?? errors["general.contactEmail"])}
          value={draft.general.contactEmail}
          onChange={(event) => updateDraft("general", { contactEmail: event.target.value })}
          placeholder="info@kurum.test"
        />
      </Field>
    </div>
  );
}

function TermStep({
  draft,
  errors,
  updateDraft,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  updateDraft: (section: "term", nextValue: Partial<OnboardingDraft["term"]>) => void;
}) {
  return (
    <div className="next-onboarding-fields next-onboarding-fields--two">
      <Field label="Akademik yıl adı" error={errors.academicYearName ?? errors["term.academicYearName"]}>
        <Input
          invalid={Boolean(errors.academicYearName ?? errors["term.academicYearName"])}
          value={draft.term.academicYearName}
          onChange={(event) => updateDraft("term", { academicYearName: event.target.value })}
          placeholder="2026-2027"
        />
      </Field>
      <Field label="Aktif dönem" error={errors.termName ?? errors["term.termName"]}>
        <Input
          invalid={Boolean(errors.termName ?? errors["term.termName"])}
          value={draft.term.termName}
          onChange={(event) => updateDraft("term", { termName: event.target.value })}
          placeholder="1. Dönem"
        />
      </Field>
      <Field label="Yıl başlangıcı" error={errors.startsAt ?? errors["term.startsAt"]}>
        <Input
          invalid={Boolean(errors.startsAt ?? errors["term.startsAt"])}
          type="date"
          value={draft.term.startsAt}
          onChange={(event) => updateDraft("term", { startsAt: event.target.value })}
        />
      </Field>
      <Field label="Yıl bitişi" error={errors.endsAt ?? errors["term.endsAt"]}>
        <Input
          invalid={Boolean(errors.endsAt ?? errors["term.endsAt"])}
          type="date"
          value={draft.term.endsAt}
          onChange={(event) => updateDraft("term", { endsAt: event.target.value })}
        />
      </Field>
      <Field label="Dönem başlangıcı" error={errors.termStartsAt ?? errors["term.termStartsAt"]}>
        <Input
          invalid={Boolean(errors.termStartsAt ?? errors["term.termStartsAt"])}
          type="date"
          value={draft.term.termStartsAt}
          onChange={(event) => updateDraft("term", { termStartsAt: event.target.value })}
        />
      </Field>
      <Field label="Dönem bitişi" error={errors.termEndsAt ?? errors["term.termEndsAt"]}>
        <Input
          invalid={Boolean(errors.termEndsAt ?? errors["term.termEndsAt"])}
          type="date"
          value={draft.term.termEndsAt}
          onChange={(event) => updateDraft("term", { termEndsAt: event.target.value })}
        />
      </Field>
    </div>
  );
}

function CoursesStep({
  allCourseOptions,
  courseGroups,
  draft,
  errorMessage,
  errors,
  isLoading,
  updateDraft,
}: {
  allCourseOptions: SetupCourseOption[];
  courseGroups: SetupCourseGroup[];
  draft: OnboardingDraft;
  errorMessage: string;
  errors: StepErrors;
  isLoading: boolean;
  updateDraft: (section: "courses", nextValue: Partial<OnboardingDraft["courses"]>) => void;
}) {
  const selectedCourseIds = new Set(draft.courses.selectedCourseIds);
  const selectedVisibleCourseCount = allCourseOptions.filter((course) => selectedCourseIds.has(course.id)).length;
  const allCoursesSelected = allCourseOptions.length > 0 && selectedVisibleCourseCount === allCourseOptions.length;
  const automaticCourses = selectedCourseOptions(
    defaultCourseIdsForStages(activeStageIdsFromClassCounts(draft.classes.classCounts), allCourseOptions),
    allCourseOptions,
  );

  function selectAllCourses() {
    updateDraft("courses", { selectedCourseIds: allCourseOptions.map((course) => course.id) });
  }

  function toggleCourse(courseId: string) {
    const selected = new Set(draft.courses.selectedCourseIds);
    if (selected.has(courseId)) {
      selected.delete(courseId);
    } else {
      selected.add(courseId);
    }
    updateDraft("courses", { selectedCourseIds: [...selected] });
  }

  return (
    <div className="next-onboarding-fields">
      <section className="next-onboarding-auto-classes" aria-label="Otomatik seçilen dersler">
        <h3>Sınıfa göre otomatik seçilen dersler</h3>
        <div>
          {automaticCourses.length > 0 ? (
            automaticCourses.map((course) => <span key={course.id}>{course.name}</span>)
          ) : (
            <span>Sınıf seçildiğinde dersler burada görünür.</span>
          )}
        </div>
      </section>
      <div className="next-onboarding-course-actions">
        <Button
          variant="secondary"
          type="button"
          onClick={selectAllCourses}
          disabled={allCoursesSelected || allCourseOptions.length === 0}
        >
          Hepsini Seç
        </Button>
      </div>
      {isLoading ? (
        <p className="next-onboarding-success" role="status">
          Ders şablonları yükleniyor.
        </p>
      ) : null}
      {errorMessage ? <p className="next-form-error">{errorMessage}</p> : null}
      {courseGroups.map((group) => (
        <section className="next-onboarding-course-group" key={group.title}>
          <header>
            <h3>{group.title}</h3>
            <span>{group.source}</span>
          </header>
          <div className="next-onboarding-course-grid">
            {group.courses.map((course) => (
              <button
                key={course.id}
                type="button"
                aria-pressed={draft.courses.selectedCourseIds.includes(course.id)}
                onClick={() => toggleCourse(course.id)}
              >
                <strong>{course.name}</strong>
                <small>{course.code}</small>
              </button>
            ))}
          </div>
        </section>
      ))}
      <FieldError message={errors.selectedCourseIds ?? errors["courses.selectedCourseIds"]} />
    </div>
  );
}

function ClassesStep({
  campuses,
  draft,
  errorMessage,
  errors,
  isLoading,
  updateDraft,
}: {
  campuses: CampusRecord[];
  draft: OnboardingDraft;
  errorMessage: string;
  errors: StepErrors;
  isLoading: boolean;
  updateDraft: (section: "classes", nextValue: Partial<OnboardingDraft["classes"]>) => void;
}) {
  const generatedClasses = generateClasses(draft.classes.classCounts, draft.classes.classNames);
  const campusFieldError = errors.campusId ?? errors["classes.campusId"];

  return (
    <div className="next-onboarding-fields">
      <Field label="Sınıfların kampüsü" error={campusFieldError}>
        {isLoading ? <span>Kampüsler yükleniyor.</span> : campuses.length > 0 ? (
          <Select
            value={draft.classes.campusId}
            onChange={(event) => updateDraft("classes", { campusId: event.target.value })}
          >
            <option value="">Kampüs seçin</option>
            {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
          </Select>
        ) : (
          <Link href="/kurum/kampusler?new=1">Önce kampüs oluştur</Link>
        )}
      </Field>
      {errorMessage ? <p className="next-form-error">{errorMessage}</p> : null}
      <fieldset className="next-onboarding-class-counts">
        <legend>Kademeye göre sınıf sayısı</legend>
        {stageOptions.map((stage) => {
          const fieldError = errors[`classCounts.${stage.id}`] ?? errors[`classes.classCounts.${stage.id}`];
          return (
            <Field key={stage.id} label={stage.label} error={fieldError}>
              <Input
                invalid={Boolean(fieldError)}
                inputMode="numeric"
                value={draft.classes.classCounts[stage.id]}
                onChange={(event) =>
                  updateDraft("classes", {
                    classCounts: {
                      ...draft.classes.classCounts,
                      [stage.id]: event.target.value,
                    },
                  })
                }
                placeholder="0"
              />
            </Field>
          );
        })}
      </fieldset>
      <FieldError message={errors.classCounts ?? errors["classes.classCounts"]} />
      <fieldset className="next-onboarding-class-counts" aria-label="Sınıf adları">
        <legend>Sınıf adları</legend>
        <p>Otomatik adlar başlangıç önerisidir; sınıf adını ihtiyacınıza göre düzenleyebilirsiniz.</p>
        {generatedClasses.map((classRecord) => {
          const fieldError = errors[`classNames.${classRecord.key}`] ?? errors[`classes.classNames.${classRecord.key}`];
          return (
            <Field
              key={classRecord.key}
              label={`${stageOptions.find((stage) => stage.id === classRecord.stageId)?.label ?? classRecord.stageId} · ${classRecord.section} şubesi · Sınıf adı`}
              error={fieldError}
            >
              <Input
                invalid={Boolean(fieldError)}
                value={classRecord.name}
                onChange={(event) => updateDraft("classes", {
                  classNames: {
                    ...draft.classes.classNames,
                    [classRecord.key]: event.target.value,
                  },
                })}
                onBlur={(event) => updateDraft("classes", {
                  classNames: {
                    ...draft.classes.classNames,
                    [classRecord.key]: event.target.value.trim(),
                  },
                })}
              />
            </Field>
          );
        })}
      </fieldset>
    </div>
  );
}

function PeopleStep({
  draft,
  errors,
  kazanimImportUploadStatus,
  onKazanimImportFileChange,
  onStudentModelChange,
  onTeacherImportFileChange,
  onTeacherModelChange,
  onStudentImportFileChange,
  studentImportUploadStatus,
  teacherImportUploadStatus,
}: {
  draft: OnboardingDraft;
  errors: StepErrors;
  kazanimImportUploadStatus: SetupUploadStatus;
  onKazanimImportFileChange(file: File | undefined): void;
  onStudentModelChange(model: OnboardingDraft["people"]["studentModel"]): void;
  onTeacherImportFileChange(file: File | undefined): void;
  onTeacherModelChange(model: OnboardingDraft["people"]["teacherModel"]): void;
  onStudentImportFileChange(file: File | undefined): void;
  studentImportUploadStatus: SetupUploadStatus;
  teacherImportUploadStatus: SetupUploadStatus;
}) {
  return (
    <div className="next-onboarding-fields">
      <section className="next-onboarding-choice" aria-labelledby="teacher-model-label">
        <span className="next-onboarding-choice__label" id="teacher-model-label">Öğretmen veri girişi</span>
        <SegmentedControl label="Öğretmen veri girişi">
          <button type="button" aria-pressed={draft.people.teacherModel === "manual"} onClick={() => onTeacherModelChange("manual")}>
            Tek tek giriş
          </button>
          <button type="button" aria-pressed={draft.people.teacherModel === "excel"} onClick={() => onTeacherModelChange("excel")}>
            Excel aktarımı
          </button>
        </SegmentedControl>
      </section>
      <section className="next-onboarding-choice" aria-labelledby="student-model-label">
        <span className="next-onboarding-choice__label" id="student-model-label">Öğrenci veri girişi</span>
        <SegmentedControl label="Öğrenci veri girişi">
          <button type="button" aria-pressed={draft.people.studentModel === "manual"} onClick={() => onStudentModelChange("manual")}>
            Tek tek giriş
          </button>
          <button type="button" aria-pressed={draft.people.studentModel === "excel"} onClick={() => onStudentModelChange("excel")}>
            Excel aktarımı
          </button>
        </SegmentedControl>
      </section>
      <ImportTemplatePanel />
      {draft.people.teacherModel === "excel" ? (
        <>
          <Field
            label="Öğretmen aktarım dosyası"
            description={describeSelectedUploadFileNotice(
              draft.people.teacherImportFileName,
              "Öğretmen XLSX veya CSV dosyası seçilebilir.",
            )}
            error={errors.teacherImportFileName ?? errors["people.teacherImportFileName"]}
          >
            <Input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                onTeacherImportFileChange(file);
                event.currentTarget.value = "";
              }}
            />
          </Field>
          <ImportUploadStatus label="Öğretmen aktarım güven durumu" status={teacherImportUploadStatus} />
        </>
      ) : null}
      {draft.people.studentModel === "excel" ? (
        <>
          <Field
            label="Öğrenci aktarım dosyası"
            description={describeSelectedUploadFileNotice(
              draft.people.studentImportFileName,
              "Öğrenci kayıtları ve dosyada varsa veli iletişim kişileri için XLSX veya CSV dosyası seçilebilir; veli hesabı açılmaz.",
            )}
            error={errors.studentImportFileName ?? errors["people.studentImportFileName"]}
          >
            <Input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                onStudentImportFileChange(file);
                event.currentTarget.value = "";
              }}
            />
          </Field>
          <ImportUploadStatus label="Öğrenci aktarım güven durumu" status={studentImportUploadStatus} />
        </>
      ) : null}
      <Field
        label="Kazanım aktarım dosyası (opsiyonel)"
        description={describeSelectedUploadFileNotice(
          draft.people.kazanimImportFileName,
          "Kazanım XLSX veya CSV dosyası seçilebilir.",
        )}
      >
        <Input
          type="file"
          accept=".xlsx,.csv"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            onKazanimImportFileChange(file);
            event.currentTarget.value = "";
          }}
        />
      </Field>
      <ImportUploadStatus label="Kazanım aktarım güven durumu" status={kazanimImportUploadStatus} />
    </div>
  );
}

function ImportUploadStatus({ label, status }: { label: string; status: SetupUploadStatus }) {
  return (
    <div
      className="next-onboarding-upload-status"
      data-state={status.state}
      aria-label={label}
      role={status.state === "error" ? "alert" : "status"}
    >
      <StatusBadge tone={status.tone}>{status.badge}</StatusBadge>
      <div>
        <strong>{status.title}</strong>
        <span>{status.meta}</span>
      </div>
      <p>{status.detail}</p>
    </div>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? <span className="next-form-error">{message}</span> : null;
}

function validateStep(
  stepId: SetupFlowStep["id"],
  draft: OnboardingDraft,
  courseOptions: SetupCourseOption[],
  campuses: CampusRecord[],
): StepErrors {
  if (stepId === "general") return validateGeneral(draft.general);
  if (stepId === "term") return validateTerm(draft.term);
  if (stepId === "courses") return validateCourses(draft.courses, courseOptions);
  if (stepId === "classes") return validateClasses(draft.classes, campuses);
  return validatePeople(draft.people);
}

function validateGeneral(general: OnboardingDraft["general"]): StepErrors {
  const errors: StepErrors = {};
  if (general.institutionName.trim().length < 2) {
    errors.institutionName = "Kurum adı en az 2 karakter olmalıdır.";
  }
  if (general.logoUrl.trim() && !isUrl(general.logoUrl)) {
    errors.logoUrl = "Logo adresi geçerli bir URL olmalıdır.";
  }
  if (general.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(general.contactEmail.trim())) {
    errors.contactEmail = "E-posta geçerli olmalıdır.";
  }
  return errors;
}

function validateTerm(term: OnboardingDraft["term"]): StepErrors {
  const errors: StepErrors = {};
  if (!term.academicYearName.trim()) errors.academicYearName = "Akademik yıl adı zorunludur.";
  if (!term.termName.trim()) errors.termName = "Aktif dönem adı zorunludur.";
  validateDateRange(term.startsAt, term.endsAt, "startsAt", "endsAt", errors);
  validateDateRange(term.termStartsAt, term.termEndsAt, "termStartsAt", "termEndsAt", errors);
  return errors;
}

function validateCourses(courses: OnboardingDraft["courses"], courseOptions: SetupCourseOption[]): StepErrors {
  return selectedCourseOptions(courses.selectedCourseIds, courseOptions).length > 0
    ? {}
    : { selectedCourseIds: "En az bir ders seçilmelidir." };
}

function validateClasses(classes: OnboardingDraft["classes"], campuses: CampusRecord[]): StepErrors {
  const errors: StepErrors = {};
  if (campuses.length === 0) {
    errors.campusId = "Sınıfları oluşturmadan önce bir kampüs eklenmelidir.";
  } else if (!classes.campusId) {
    errors.campusId = "Sınıfların kampüsü seçilmelidir.";
  } else if (!campuses.some((campus) => campus.id === classes.campusId)) {
    errors.campusId = "Seçili kampüs artık kullanılamıyor. Yeniden seçim yapın.";
  }
  let totalClassCount = 0;
  for (const stage of stageOptions) {
    const classCount = Number(classes.classCounts[stage.id]);
    if (!Number.isInteger(classCount) || classCount < 0) {
      errors[`classCounts.${stage.id}`] = "Sınıf sayısı 0 veya pozitif tam sayı olmalıdır.";
      continue;
    }
    if (classCount > 26) {
      errors[`classCounts.${stage.id}`] = "Bir kademe için en fazla 26 şube oluşturulabilir.";
    }
    totalClassCount += classCount;
  }
  if (totalClassCount <= 0) {
    errors.classCounts = "En az bir kademe için sınıf sayısı girilmelidir.";
  }
  const classKeyByName = new Map<string, string>();
  for (const classRecord of generateClasses(classes.classCounts, classes.classNames)) {
    const trimmedName = classRecord.name.trim();
    if (!trimmedName) {
      errors[`classNames.${classRecord.key}`] = "Sınıf adı zorunludur.";
      continue;
    }
    const normalizedName = normalizeClassNameValue(trimmedName);
    const duplicateKey = classKeyByName.get(normalizedName);
    if (duplicateKey) {
      errors[`classNames.${duplicateKey}`] = "Aktif sınıf adları boşluk ve harf farkı olmadan tekil olmalıdır.";
      errors[`classNames.${classRecord.key}`] = "Aktif sınıf adları boşluk ve harf farkı olmadan tekil olmalıdır.";
    } else {
      classKeyByName.set(normalizedName, classRecord.key);
    }
  }
  return errors;
}

function validatePeople(people: OnboardingDraft["people"]): StepErrors {
  const errors: StepErrors = {};
  if (people.teacherModel === "excel" && !people.teacherImportFileName) {
    errors.teacherImportFileName = "Öğretmen aktarım dosyası zorunludur.";
  }
  if (people.studentModel === "excel" && !people.studentImportFileName) {
    errors.studentImportFileName = "Öğrenci aktarım dosyası zorunludur.";
  }
  return errors;
}

function validateDateRange(startsAt: string, endsAt: string, startField: string, endField: string, errors: StepErrors) {
  if (!isDate(startsAt)) errors[startField] = "Başlangıç tarihi zorunludur.";
  if (!isDate(endsAt)) errors[endField] = "Bitiş tarihi zorunludur.";
  if (isDate(startsAt) && isDate(endsAt) && Date.parse(startsAt) >= Date.parse(endsAt)) {
    errors[endField] = "Bitiş başlangıçtan sonra olmalıdır.";
  }
}

function dataModelLabel(model: OnboardingDraft["people"]["studentModel"]) {
  if (model === "manual") return "Tek tek giriş";
  return "Excel aktarımı";
}

function formatSelectedUploadFileNotice(fileName: string) {
  const extension = fileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  return extension ? `${extension} dosyası seçildi` : "Dosya seçildi";
}

function validateSetupImportFile(
  file: File,
  options: { detail?: string; suffix?: string } = {},
): { accepted: boolean; notice: string; status: SetupUploadStatus } {
  const extension = inferSetupImportExtension(file);
  if (!extension || !setupImportAllowedExtensions.has(extension)) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, "CSV veya XLSX dosyası seçin."),
    };
  }
  if (file.size <= 0) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, "Dosya boş görünüyor. Dolu bir aktarım dosyası seçin."),
    };
  }
  if (file.size > setupImportMaxBytes) {
    return {
      accepted: false,
      notice: "",
      status: createErrorUploadStatus(file, `Dosya en fazla ${formatUploadByteSize(setupImportMaxBytes)} olabilir.`),
    };
  }

  return {
    accepted: true,
    notice: formatSelectedUploadFileNotice(`upload.${extension.toLocaleLowerCase("tr-TR")}`),
    status: {
      badge: "Yerel kontrol",
      detail: options.detail ?? "Ham dosya adı ve kişi bilgisi ekranda veya saklı taslakta gösterilmez.",
      meta: `${extension} • ${formatUploadByteSize(file.size)} • ${options.suffix ?? "Sunucu ön kontrolü bekleniyor"}`,
      state: "ready",
      title: "Yerel kontrol tamam",
      tone: "success",
    },
  };
}

function inferSetupImportExtension(file: File): SetupImportFileExtension | undefined {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  if (extension === "CSV" || extension === "XLSX") return extension;
  if (file.type === "text/csv" || file.type === "text/plain") return "CSV";
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "XLSX";
  return undefined;
}

function createIdleUploadStatus(): SetupUploadStatus {
  return {
    badge: "Bekliyor",
    detail: "Dosya adı saklanmaz; yalnız tür, boyut ve yerel kontrol sonucu gösterilir.",
    meta: `CSV/XLSX • en fazla ${formatUploadByteSize(setupImportMaxBytes)}`,
    state: "idle",
    title: "Dosya bekleniyor",
    tone: "info",
  };
}

function createErrorUploadStatus(file: File, detail: string): SetupUploadStatus {
  const extension = inferSetupImportExtension(file) ?? "DESTEKLENMEYEN";
  return {
    badge: "Kontrol hatası",
    detail,
    meta: `${extension} • ${formatUploadByteSize(file.size)}`,
    state: "error",
    title: "Dosya kabul edilmedi",
    tone: "danger",
  };
}

function markUploadStatusServerChecked(status: SetupUploadStatus): SetupUploadStatus {
  return {
    ...status,
    badge: "Sunucu ön kontrolü",
    meta: status.meta.replace("Sunucu ön kontrolü bekleniyor", "Sunucu ön kontrolü geçti"),
    title: "Ön kontrol geçti",
  };
}

function formatUploadByteSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${(byteSize / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

function describeSelectedUploadFileNotice(value: string, fallback: string) {
  if (value === "Dosya seçildi" || /^[A-Z0-9]+ dosyası seçildi$/.test(value)) return value;
  return fallback;
}

function selectedCourseOptions(selectedCourseIds: string[], courseOptions: SetupCourseOption[]) {
  const selected = new Set(selectedCourseIds);
  const uniqueByName = new Map<string, SetupCourseOption>();
  for (const course of courseOptions) {
    if (selected.has(course.id) && !uniqueByName.has(course.name)) {
      uniqueByName.set(course.name, course);
    }
  }
  return [...uniqueByName.values()];
}

function activeStageIdsFromClassCounts(classCounts: Record<StageId, string>): StageId[] {
  return stageOptions
    .filter((stage) => {
      const count = Number(classCounts[stage.id]);
      return Number.isInteger(count) && count > 0;
    })
    .map((stage) => stage.id);
}

function mergeCourseTemplateGroups(serverGroups: SetupCourseGroup[]) {
  const mergedGroups: SetupCourseGroup[] = serverGroups
    .filter((group) => group.stageId)
    .map((group) => ({
      ...group,
      courses: group.courses.map((course) => ({
        ...course,
        stageId: course.stageId ?? group.stageId,
        targetStageIds: [course.stageId ?? group.stageId!],
      })),
    }));

  for (const fallbackGroup of fallbackCourseGroups) {
    const missingCourses: SetupCourseOption[] = [];
    for (const fallbackCourse of fallbackGroup.courses) {
      const fallbackStageIds: StageId[] = fallbackGroup.stageId === "TYT/AYT"
        ? ["11", "12", "TYT/AYT"]
        : [fallbackGroup.stageId!];
      const matchingCourses = mergedGroups.flatMap((group) => group.courses).filter(
        (course) => sameCourseOption(course, fallbackCourse)
          && course.targetStageIds?.some((stageId) => fallbackStageIds.includes(stageId)),
      );
      const missingStageIds = fallbackStageIds.filter((stageId) =>
        !matchingCourses.some((course) => course.targetStageIds?.includes(stageId)),
      );
      if (missingStageIds.length === 0) continue;
      const matchingCourse = matchingCourses[0];
      if (matchingCourse) {
        matchingCourse.targetStageIds = [...new Set([...(matchingCourse.targetStageIds ?? []), ...missingStageIds])];
      } else {
        missingCourses.push({
          ...fallbackCourse,
          stageId: fallbackGroup.stageId,
          targetStageIds: missingStageIds,
        });
      }
    }
    if (missingCourses.length > 0) mergedGroups.push({ ...fallbackGroup, courses: missingCourses });
  }

  return mergedGroups;
}

function defaultCourseIdsForStages(stageIds: StageId[], courseOptions: SetupCourseOption[]) {
  const activeStages = new Set(stageIds);
  const matchingCourses = courseOptions.filter((course) => courseMatchesActiveStages(course, activeStages));
  const defaultCourses = matchingCourses.filter((course) => course.isDefault !== false);
  return (defaultCourses.length > 0 ? defaultCourses : matchingCourses).map((course) => course.id);
}

function courseMatchesActiveStages(course: SetupCourseOption, activeStages: ReadonlySet<StageId>) {
  const targetStageIds = course.targetStageIds ?? (course.stageId ? [course.stageId] : []);
  return targetStageIds.length === 0 || targetStageIds.some((stageId) => activeStages.has(stageId));
}

function targetStageIdsForCourse(course: SetupCourseOption, activeStageIds: StageId[]): StageId[] {
  const targetStageIds = course.targetStageIds ?? (course.stageId ? [course.stageId] : []);
  const matchingActiveStages = targetStageIds.filter((stageId) => activeStageIds.includes(stageId));
  return matchingActiveStages.length > 0 ? matchingActiveStages : targetStageIds;
}

function sameCourseOption(left: SetupCourseOption, right: SetupCourseOption) {
  return normalizeValue(left.name) === normalizeValue(right.name)
    || normalizeValue(left.code) === normalizeValue(right.code);
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function generateClasses(classCounts: Record<StageId, string>, classNames: Record<string, string>) {
  return stageOptions.flatMap((stage) => {
    const classCount = Number(classCounts[stage.id]);
    if (!Number.isInteger(classCount) || classCount <= 0) return [];
    return Array.from({ length: Math.min(classCount, 26) }, (_item, index) => {
      const section = String.fromCharCode(65 + index);
      const key = `${stage.id}:${section}`;
      return {
        key,
        name: classNames[key] ?? `${stageClassPrefix(stage.id)}-${section}`,
        section,
        stageId: stage.id,
      };
    });
  });
}

function stageClassPrefix(stage: StageId) {
  if (stage === "8-LGS") return "8";
  return stage;
}

async function saveSetup(
  accessToken: string,
  draft: OnboardingDraft,
  teacherImportFileBase64: string,
  teacherImportIdempotencyKey: string,
  studentImportFileBase64: string,
  studentImportIdempotencyKey: string,
  kazanimImportFileBase64: string,
  kazanimImportIdempotencyKey: string,
  courseOptions: SetupCourseOption[],
) {
  const [existingCampuses, existingCourses, existingClasses, existingYears, existingTerms, gradeLevels] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses?limit=200`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses?limit=200`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes?limit=200`),
    apiListRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years?limit=200`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms?limit=200`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels?limit=200`),
  ]);
  if (!existingCampuses.data.some((campus) => campus.id === draft.classes.campusId)) {
    throw new Error("Seçili kampüs artık kullanılamıyor. Sınıf adımından yeniden seçim yapın.");
  }
  const courseByName = new Map(existingCourses.data.map((course) => [normalizeValue(course.name), course]));
  const existingClassByName = new Map(
    existingClasses.data.map((classRecord) => [normalizeClassNameValue(classRecord.name), classRecord]),
  );
  const gradeLevelIdByStageId = new Map(
    gradeLevels.data
      .map((gradeLevel) => [stageIdFromGradeLevel(gradeLevel), gradeLevel.id] as const)
      .filter((entry): entry is [StageId, string] => Boolean(entry[0])),
  );
  const gradeLevelStageIdById = new Map(
    gradeLevels.data
      .map((gradeLevel) => [gradeLevel.id, stageIdFromGradeLevel(gradeLevel)] as const)
      .filter((entry): entry is [string, StageId] => Boolean(entry[1])),
  );
  const activeStageIds = activeStageIdsFromClassCounts(draft.classes.classCounts);
  const selectedCourseIds = new Set(draft.courses.selectedCourseIds);
  const selectedCourses = courseOptions.filter((course) => selectedCourseIds.has(course.id));
  const requiredStageIds = new Set(activeStageIds);
  for (const course of selectedCourses) {
    const targetStageIds = targetStageIdsForCourse(course, activeStageIds);
    if (targetStageIds.length === 0) throw new Error(`Seçili ${course.name} dersi için sınıf seviyesi bulunamadı.`);
    for (const stageId of targetStageIds) requiredStageIds.add(stageId);
  }
  const existingClassGradeLevelIdByStageId = new Map<StageId, string>();
  for (const classRecord of generateClasses(draft.classes.classCounts, draft.classes.classNames)) {
    const existingClass = existingClassByName.get(normalizeClassNameValue(classRecord.name));
    if (!existingClass) continue;
    if (existingClass.campusId && existingClass.campusId !== draft.classes.campusId) {
      throw new Error(`SETUP_CLASS_CONTEXT_CONFLICT:${classRecord.name} sınıfı farklı bir kampüse bağlı. Bu kayıt otomatik taşınmadı.`);
    }
    if (existingClass.gradeLevelId) {
      if (gradeLevelStageIdById.get(existingClass.gradeLevelId) !== classRecord.stageId) {
        throw new Error(`SETUP_CLASS_CONTEXT_CONFLICT:${classRecord.name} sınıfı farklı bir seviyeye bağlı. Bu kayıt otomatik taşınmadı.`);
      }
      const existingGradeLevelId = existingClassGradeLevelIdByStageId.get(classRecord.stageId);
      if (existingGradeLevelId && existingGradeLevelId !== existingClass.gradeLevelId) {
        throw new Error(`SETUP_CLASS_CONTEXT_CONFLICT:${classRecord.stageId} seviyesindeki mevcut sınıflar farklı seviye kayıtlarına bağlı. Otomatik değişiklik yapılmadı.`);
      }
      existingClassGradeLevelIdByStageId.set(classRecord.stageId, existingClass.gradeLevelId);
    }
  }
  for (const [stageId, gradeLevelId] of existingClassGradeLevelIdByStageId) {
    gradeLevelIdByStageId.set(stageId, gradeLevelId);
  }

  await apiRequest<TenantProfileRecord>(accessToken, `${apiBaseUrl}/me/tenant`, {
    body: JSON.stringify({
      name: draft.general.institutionName,
      institutionType: draft.general.institutionType,
      contactEmail: draft.general.contactEmail || undefined,
      logoUrl: draft.general.logoUrl || undefined,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });

  for (const stageId of requiredStageIds) {
    if (gradeLevelIdByStageId.has(stageId)) continue;
    const gradeLevel = await apiRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`, {
      body: JSON.stringify({ code: stageId, name: stageOptions.find((stage) => stage.id === stageId)?.label ?? stageId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    gradeLevelIdByStageId.set(stageId, gradeLevel.id);
  }
  const selectedCourseLinks: Array<{ course: SetupCourseOption; gradeLevelId: string }> = [];
  const selectedCourseLinkKeys = new Set<string>();
  for (const course of selectedCourses) {
    for (const stageId of targetStageIdsForCourse(course, activeStageIds)) {
      const gradeLevelId = gradeLevelIdByStageId.get(stageId);
      if (!gradeLevelId) throw new Error(`Seçili ${course.name} dersi için ${stageId} seviyesi oluşturulamadı.`);
      const key = `${gradeLevelId}:${normalizeValue(course.name)}`;
      if (selectedCourseLinkKeys.has(key)) continue;
      selectedCourseLinkKeys.add(key);
      selectedCourseLinks.push({ course, gradeLevelId });
    }
  }
  const existingYear = existingYears.data.find((year) => normalizeValue(year.name) === normalizeValue(draft.term.academicYearName));
  let createdCourses = 0;
  let createdClasses = 0;
  let createdAcademicYears = 0;
  let createdAcademicTerms = 0;
  let repairedClasses = 0;
  let createdTeachers = 0;
  let createdTeacherAssignments = 0;
  let importedStudents = 0;
  let importedOutcomes = 0;

  let academicYear = existingYear ?? await apiRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years`, {
    body: JSON.stringify({
      endsAt: draft.term.endsAt,
      isActive: true,
      name: draft.term.academicYearName,
      startsAt: draft.term.startsAt,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!existingYear) createdAcademicYears += 1;
  if (existingYear && !existingYear.isActive) {
    academicYear = await apiRequest<AcademicYearRecord>(
      accessToken,
      `${apiBaseUrl}/academic-years/${encodeURIComponent(existingYear.id)}`,
      {
        body: JSON.stringify({ isActive: true }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
  }

  const existingTerm = existingTerms.data.find(
    (term) => term.academicYearId === academicYear.id && normalizeValue(term.name) === normalizeValue(draft.term.termName),
  );
  if (!existingTerm) {
    await apiRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`, {
      body: JSON.stringify({
        academicYearId: academicYear.id,
        endsAt: draft.term.termEndsAt,
        isActive: true,
        name: draft.term.termName,
        startsAt: draft.term.termStartsAt,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdAcademicTerms += 1;
  } else if (!existingTerm.isActive) {
    await apiRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms/${encodeURIComponent(existingTerm.id)}`, {
      body: JSON.stringify({ isActive: true }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
  }

  for (const course of selectedCourseOptions(draft.courses.selectedCourseIds, courseOptions)) {
    if (courseByName.has(normalizeValue(course.name))) continue;
    const created = await apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, {
      body: JSON.stringify({ code: course.code, name: course.name }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    courseByName.set(normalizeValue(created.name), created);
    createdCourses += 1;
  }

  for (const { course, gradeLevelId } of selectedCourseLinks) {
    const courseRecord = courseByName.get(normalizeValue(course.name));
    if (!courseRecord) throw new Error(`Seçili ${course.name} dersi oluşturulamadı.`);
    await apiRequest<void>(
      accessToken,
      `${apiBaseUrl}/grade-levels/${encodeURIComponent(gradeLevelId)}/courses/${encodeURIComponent(courseRecord.id)}`,
      { method: "PUT" },
    );
  }

  for (const classRecord of generateClasses(draft.classes.classCounts, draft.classes.classNames)) {
    const gradeLevelId = gradeLevelIdByStageId.get(classRecord.stageId);
    if (!gradeLevelId) throw new Error(`${classRecord.name} sınıfı için seviye oluşturulamadı.`);
    const existingClass = existingClassByName.get(normalizeClassNameValue(classRecord.name));
    if (existingClass) {
      if (
        (existingClass.campusId && existingClass.campusId !== draft.classes.campusId)
        || (existingClass.gradeLevelId && existingClass.gradeLevelId !== gradeLevelId)
      ) {
        throw new Error(`SETUP_CLASS_CONTEXT_CONFLICT:${classRecord.name} sınıfı farklı bir kampüs veya seviyeye bağlı. Bu kayıt otomatik taşınmadı.`);
      }
      const missingContext = {
        ...(!existingClass.campusId ? { campusId: draft.classes.campusId } : {}),
        ...(!existingClass.gradeLevelId ? { gradeLevelId } : {}),
      };
      if (Object.keys(missingContext).length > 0) {
        await apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(existingClass.id)}`, {
          body: JSON.stringify(missingContext),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        });
        repairedClasses += 1;
      }
      continue;
    }
    await apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`, {
      body: JSON.stringify({
        campusId: draft.classes.campusId,
        gradeLevelId,
        name: classRecord.name.trim(),
        section: classRecord.section,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    createdClasses += 1;
  }

  if (draft.people.teacherModel === "excel" && teacherImportFileBase64) {
    const dryRun = await dryRunTeacherImport(accessToken, teacherImportFileBase64);
    if (!dryRun.wouldImport) {
      throw new Error(teacherImportErrorMessage(dryRun));
    }
    const imported = await apiRequest<TeacherImportResult>(accessToken, `${apiBaseUrl}/teachers/imports`, {
      body: JSON.stringify({ fileBase64: teacherImportFileBase64 }),
      headers: { "content-type": "application/json", "Idempotency-Key": teacherImportIdempotencyKey },
      method: "POST",
    });
    createdTeachers = imported.createdTeachers;
    createdTeacherAssignments = imported.createdAssignments;
  }

  if (draft.people.studentModel === "excel" && studentImportFileBase64) {
    const dryRun = await dryRunStudentImport(accessToken, studentImportFileBase64);
    if (!dryRun.wouldImport) {
      throw new Error(studentImportErrorMessage(dryRun));
    }
    const imported = await apiRequest<StudentImportResult>(accessToken, `${apiBaseUrl}/students/imports`, {
      body: JSON.stringify({ fileBase64: studentImportFileBase64 }),
      headers: { "content-type": "application/json", "Idempotency-Key": studentImportIdempotencyKey },
      method: "POST",
    });
    importedStudents = imported.importedRows;
  }

  if (kazanimImportFileBase64) {
    const dryRun = await dryRunLearningOutcomeImport(accessToken, kazanimImportFileBase64);
    if (!dryRun.wouldImport) {
      throw new Error(kazanimImportErrorMessage(dryRun));
    }
    const imported = await apiRequest<LearningOutcomeImportResult>(accessToken, `${apiBaseUrl}/learning-outcomes/imports`, {
      body: JSON.stringify({ fileBase64: kazanimImportFileBase64 }),
      headers: { "content-type": "application/json", "Idempotency-Key": kazanimImportIdempotencyKey },
      method: "POST",
    });
    importedOutcomes = imported.importedRows;
  }

  return {
    createdAcademicTerms,
    createdAcademicYears,
    createdClasses,
    createdCourses,
    createdTeacherAssignments,
    createdTeachers,
    importedOutcomes,
    importedStudents,
    repairedClasses,
  };
}

function dryRunTeacherImport(accessToken: string, fileBase64: string) {
  return apiRequest<TeacherImportDryRunResult>(accessToken, `${apiBaseUrl}/teachers/imports/dry-run`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function dryRunStudentImport(accessToken: string, fileBase64: string) {
  return apiRequest<StudentImportDryRunResult>(accessToken, `${apiBaseUrl}/students/imports/dry-run`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function dryRunLearningOutcomeImport(accessToken: string, fileBase64: string) {
  return apiRequest<LearningOutcomeImportDryRunResult>(accessToken, `${apiBaseUrl}/learning-outcomes/imports/dry-run`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function kazanimImportErrorMessage(dryRun: LearningOutcomeImportDryRunResult) {
  const requiredError = dryRun.errors.find((error) => error.code === "REQUIRED");
  if (requiredError) {
    return `Kazanım dosyasında zorunlu ${kazanimImportFieldLabel(requiredError.field)} alanı eksik. Satır: ${requiredError.row}.`;
  }

  const duplicateCode = dryRun.errors.find((error) => error.code === "DUPLICATE_CODE");
  if (duplicateCode) {
    return `Kazanım dosyasında tekrar eden kod var. Satır: ${duplicateCode.row}.`;
  }

  return "Kazanım aktarım dosyası içe aktarılamadı. Dosyayı kontrol edip tekrar deneyin.";
}

function kazanimImportFieldLabel(field: string) {
  if (field === "code") return "kod";
  if (field === "branch") return "branş";
  if (field === "title") return "başlık";
  return field;
}

function teacherImportErrorMessage(dryRun: TeacherImportDryRunResult) {
  const classError = dryRun.errors.find((error) => error.code === "CLASS_NOT_FOUND");
  if (classError) {
    return `Öğretmen dosyasında sistemde olmayan sınıf var. Satır: ${classError.row}.`;
  }

  const courseError = dryRun.errors.find((error) => error.code === "COURSE_NOT_FOUND");
  if (courseError) {
    return `Öğretmen dosyasında sistemde olmayan ders var. Satır: ${courseError.row}.`;
  }

  const requiredError = dryRun.errors.find((error) => error.code === "REQUIRED");
  if (requiredError) {
    if (requiredError.field === "className") {
      return `Öğretmen dosyasında ders ataması için sınıf alanı eksik. Satır: ${requiredError.row}.`;
    }
    const fieldName = teacherImportFieldLabel(requiredError.field);
    return `Öğretmen dosyasında zorunlu ${fieldName} alanı eksik. Satır: ${requiredError.row}.`;
  }

  const invalidError = dryRun.errors.find((error) => error.code === "INVALID");
  if (invalidError) {
    return `Öğretmen dosyasında geçersiz ${teacherImportFieldLabel(invalidError.field)} var. Satır: ${invalidError.row}.`;
  }

  return "Öğretmen aktarım dosyası içe aktarılamadı. Dosyayı kontrol edip tekrar deneyin.";
}

function teacherImportFieldLabel(field: string) {
  if (field === "firstName") return "ad";
  if (field === "lastName") return "soyad";
  if (field === "nationalId") return "TC kimlik";
  if (field === "phone") return "telefon";
  if (field === "className") return "sınıf";
  if (field === "courseName") return "ders";
  return field;
}

function studentImportErrorMessage(dryRun: StudentImportDryRunResult) {
  const quotaError = dryRun.errors.find((error) => error.code === "ACTIVE_STUDENT_LIMIT_REACHED");
  if (quotaError && dryRun.quota) {
    return `Öğrenci dosyası kota sınırını aşıyor. Sınır: ${dryRun.quota.limit}, mevcut: ${dryRun.quota.current}, dosyada: ${dryRun.quota.incoming}.`;
  }

  const classError = dryRun.errors.find((error) => error.code === "CLASS_NOT_FOUND");
  if (classError) {
    return `Öğrenci dosyasında sistemde olmayan sınıf var. Satır: ${classError.row}.`;
  }

  const contactColumnsConflict = dryRun.errors.find((error) => error.code === "CONTACT_COLUMNS_CONFLICT");
  if (contactColumnsConflict) {
    return `Öğrenci dosyasında aynı satırda hem veli hem iletişim kişisi sütunları dolu; birini boşaltın. Satır: ${contactColumnsConflict.row}.`;
  }

  const requiredError = dryRun.errors.find((error) => error.code === "REQUIRED");
  if (requiredError) {
    const fieldName = studentImportFieldLabel(requiredError.field);
    return `Öğrenci dosyasında zorunlu ${fieldName} alanı eksik. Satır: ${requiredError.row}.`;
  }

  const duplicateStudentNo = dryRun.errors.find((error) => error.code === "STUDENT_NO_DUPLICATE");
  if (duplicateStudentNo) {
    return `Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı okul no var. Satır: ${duplicateStudentNo.row}.`;
  }

  const duplicateNationalId = dryRun.errors.find((error) => error.code === "STUDENT_NATIONAL_ID_DUPLICATE");
  if (duplicateNationalId) {
    return `Öğrenci dosyasında tekrar eden veya sistemde zaten kayıtlı TC kimlik no var. Satır: ${duplicateNationalId.row}.`;
  }

  const invalidEmail = dryRun.errors.find((error) => error.code === "INVALID_EMAIL");
  if (invalidEmail) {
    return `Öğrenci dosyasında geçersiz e-posta var. Satır: ${invalidEmail.row}.`;
  }

  const invalidDate = dryRun.errors.find((error) => error.code === "INVALID_DATE");
  if (invalidDate) {
    return `Öğrenci dosyasında tarih YYYY-AA-GG formatında olmalı. Satır: ${invalidDate.row}.`;
  }

  const invalidNationalId = dryRun.errors.find((error) => error.code === "INVALID_NATIONAL_ID");
  if (invalidNationalId) {
    return `Öğrenci dosyasında geçersiz TC kimlik no var. Satır: ${invalidNationalId.row}.`;
  }

  const invalidPhone = dryRun.errors.find((error) => error.code === "INVALID_PHONE");
  if (invalidPhone) {
    return `Öğrenci dosyasında geçersiz telefon var. Satır: ${invalidPhone.row}.`;
  }

  return "Öğrenci aktarım dosyası içe aktarılamadı. Dosyayı kontrol edip tekrar deneyin.";
}

function studentImportFieldLabel(field: string) {
  if (field === "firstName") return "ad";
  if (field === "lastName") return "soyad";
  if (field === "nationalId") return "TC kimlik";
  if (field === "phone") return "telefon";
  if (field === "className") return "sınıf";
  if (field === "email") return "e-posta";
  if (field === "studentNo") return "okul no";
  return field;
}

function normalizeValue(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function normalizeClassNameValue(value: string) {
  return value.replace(/\s/gu, "").toLocaleLowerCase("tr-TR");
}

function loadCurrentTenant(accessToken: string) {
  return apiRequest<TenantProfileRecord>(accessToken, `${apiBaseUrl}/me/tenant`);
}

async function loadCourseTemplateGroups(accessToken: string): Promise<SetupCourseGroup[]> {
  const gradeLevels = await apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels?limit=200`);
  const recognizedGradeLevels = gradeLevels.data.flatMap((gradeLevel) => {
    const stageId = stageIdFromGradeLevel(gradeLevel);
    return stageId ? [{ gradeLevel, stageId }] : [];
  });
  const groups = await Promise.all(
    recognizedGradeLevels.map(async ({ gradeLevel, stageId }) => {
      const templates = await apiListRequest<GradeLevelCourseRecord>(
        accessToken,
        `${apiBaseUrl}/grade-levels/${encodeURIComponent(gradeLevel.id)}/courses?limit=200`,
      );
      return {
        title: gradeLevel.name,
        source: gradeLevel.code ? `${gradeLevel.code} ders şablonu` : "Ders şablonu",
        courses: templates.data.map((template) => ({
          code: template.courseCode ?? template.courseId,
          id: template.id,
          isDefault: template.isDefault,
          name: template.courseName,
          stageId,
        })),
        stageId,
      };
    }),
  );
  return groups.filter((group) => group.courses.length > 0);
}

function stageIdFromGradeLevel(gradeLevel: GradeLevelRecord): StageId | undefined {
  const value = `${gradeLevel.code ?? ""} ${gradeLevel.name} ${gradeLevel.id}`.toLocaleLowerCase("tr-TR");
  if (value.includes("tyt") || value.includes("ayt")) return "TYT/AYT";
  if (value.includes("lgs") || containsStandaloneNumber(value, "8")) return "8-LGS";
  if (containsStandaloneNumber(value, "7")) return "7";
  if (containsStandaloneNumber(value, "10")) return "10";
  if (containsStandaloneNumber(value, "11")) return "11";
  if (containsStandaloneNumber(value, "12")) return "12";
  return undefined;
}

function containsStandaloneNumber(value: string, numberText: string) {
  return new RegExp(`(^|\\D)${numberText}(\\D|$)`).test(value);
}

function mergeTenantProfileDraft(draft: OnboardingDraft, tenant: TenantProfileRecord): OnboardingDraft {
  if (draft.general.institutionName.trim()) return draft;
  return {
    ...draft,
    general: {
      ...draft.general,
      contactEmail: tenant.contactEmail ?? "",
      institutionName: tenant.name,
      institutionType: normalizeInstitutionType(tenant.institutionType),
      logoUrl: tenant.logoUrl ?? "",
    },
  };
}

async function readFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isDate(value: string) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function isUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function mergeDraft(rawDraft: string): OnboardingDraft {
  try {
    const parsed = JSON.parse(rawDraft) as Partial<OnboardingDraft>;
    const parsedPeople: Partial<OnboardingDraft["people"]> = parsed.people ?? {};
    const parsedClasses = parsed.classes as (Partial<OnboardingDraft["classes"]> & {
      classCount?: unknown;
      stage?: unknown;
    }) | undefined;
    const parsedCourses: Partial<OnboardingDraft["courses"]> = parsed.courses ?? {};
    return {
      classes: {
        ...initialDraft.classes,
        campusId: typeof parsedClasses?.campusId === "string" ? parsedClasses.campusId : initialDraft.classes.campusId,
        classCounts: normalizeClassCounts(parsedClasses),
        classNames: normalizeClassNames(parsedClasses?.classNames),
      },
      courses: {
        ...initialDraft.courses,
        ...parsedCourses,
        selectedCourseIds: Array.isArray(parsedCourses.selectedCourseIds)
          ? normalizeCourseIds(parsedCourses.selectedCourseIds)
          : initialDraft.courses.selectedCourseIds,
      },
      general: {
        ...initialDraft.general,
        ...parsed.general,
        institutionType: normalizeInstitutionType(parsed.general?.institutionType),
      },
      people: {
        kazanimImportFileName:
          typeof parsedPeople.kazanimImportFileName === "string"
            ? parsedPeople.kazanimImportFileName
            : initialDraft.people.kazanimImportFileName,
        studentImportFileName:
          typeof parsedPeople.studentImportFileName === "string"
            ? parsedPeople.studentImportFileName
            : initialDraft.people.studentImportFileName,
        studentModel: isPeopleModel(parsedPeople.studentModel) ? parsedPeople.studentModel : initialDraft.people.studentModel,
        teacherImportFileName:
          typeof parsedPeople.teacherImportFileName === "string"
            ? parsedPeople.teacherImportFileName
            : initialDraft.people.teacherImportFileName,
        teacherModel: isPeopleModel(parsedPeople.teacherModel) ? parsedPeople.teacherModel : initialDraft.people.teacherModel,
      },
      term: { ...initialDraft.term, ...parsed.term },
    };
  } catch {
    return initialDraft;
  }
}

function sanitizeDraftForStorage(draft: OnboardingDraft): OnboardingDraft {
  return {
    ...draft,
    general: {
      ...draft.general,
      contactEmail: "",
    },
    people: {
      ...draft.people,
      kazanimImportFileName: "",
      studentImportFileName: "",
      teacherImportFileName: "",
    },
  };
}

function normalizeInstitutionType(value: unknown): OnboardingDraft["general"]["institutionType"] {
  if (value === "school" || value === "study-center" || value === "course-center") return value;
  return initialDraft.general.institutionType;
}

function isStageId(value: unknown): value is StageId {
  return typeof value === "string" && stageOptions.some((stage) => stage.id === value);
}

function normalizeStageId(value: unknown): StageId {
  if (value === "LGS") return "8-LGS";
  return isStageId(value) ? value : "8-LGS";
}

function normalizeClassCounts(
  value: (Partial<OnboardingDraft["classes"]> & { classCount?: unknown; stage?: unknown }) | undefined,
) {
  const classCounts = { ...initialDraft.classes.classCounts };
  if (value?.classCounts && typeof value.classCounts === "object") {
    for (const stage of stageOptions) {
      const count = value.classCounts[stage.id];
      if (typeof count === "string") classCounts[stage.id] = count;
    }
  }
  if (value?.classCount !== undefined) {
    const legacyStage = normalizeStageId(value.stage);
    classCounts[legacyStage] = String(value.classCount);
  }
  return classCounts;
}

function normalizeClassNames(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, name]) => /^(?:7|8-LGS|10|11|12|TYT\/AYT):[A-Z]$/.test(key) && typeof name === "string"),
  ) as Record<string, string>;
}

function normalizeCourseIds(values: unknown[]) {
  const legacyCourseIdById: Record<string, string> = {
    "lgs-turkce": "8-lgs-turkce",
    "lgs-matematik": "8-lgs-matematik",
    "lgs-fen": "8-lgs-fen",
    "lgs-inkilap": "8-lgs-inkilap",
    "lgs-din": "8-lgs-din",
    "lgs-ingilizce": "8-lgs-ingilizce",
  };
  const validIds = new Set(fallbackCourseOptions.map((course) => course.id));
  const normalized = values
    .filter((id): id is string => typeof id === "string")
    .map((id) => legacyCourseIdById[id] ?? id)
    .filter((id) => validIds.has(id) || /^[a-z0-9][a-z0-9._:-]{0,159}$/i.test(id));
  return normalized.length > 0 ? normalized : initialDraft.courses.selectedCourseIds;
}

function isPeopleModel(value: unknown): value is OnboardingDraft["people"]["studentModel"] {
  return value === "manual" || value === "excel";
}

function readDraftFromSession(key: string) {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraftToSession(key: string, draft: OnboardingDraft) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Draft persistence is a convenience; setup can continue without it.
  }
}

function setupReadinessLabel(key: import("@o-okul/shared-types").SetupReadinessKey): string {
  const labels: Record<import("@o-okul/shared-types").SetupReadinessKey, string> = {
    institution: "Kurum profili",
    campus: "Kampüs",
    "academic-year": "Aktif akademik yıl",
    "academic-term": "Aktif dönem",
    "grade-level": "Seviye",
    class: "Sınıf",
    course: "Ders",
    teacher: "Öğretmen",
    student: "Öğrenci",
  };
  return labels[key];
}
