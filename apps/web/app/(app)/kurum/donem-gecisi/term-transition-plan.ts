import type { StudentBulkEnrollmentRequest, StudentBulkStatusRequest, StudentRecord } from "@o-okul/shared-types";

// DEC-20261102-08: the wizard keeps its choices in the page address and reads progress back from the server, so a
// reload or a retry continues where an interrupted run stopped. Nothing is kept in browser storage.

export const wizardSteps = [
  { key: "takvim", label: "Yıl ve dönem" },
  { key: "siniflar", label: "Sınıf eşleştirme" },
  { key: "mezunlar", label: "Mezun ve ayrılanlar" },
  { key: "atamalar", label: "Öğretmen atamaları" },
  { key: "on-izleme", label: "Ön izleme" },
  { key: "uygulama", label: "Uygulama" },
] as const;

export type WizardStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

/** Class mapping target that graduates every student of the source class. */
export const graduateTarget = "mezun";

/** Per-student change of the class mapping: A = leaves the school (TRANSFERRED), H = stays out of the transition. */
export type StudentOverride = "A" | "H";

export interface WizardState {
  step: WizardStepNumber;
  academicYearId: string;
  termId: string;
  /** Source class id → target class id or `graduateTarget`; a class without an entry stays out of the transition. */
  classTargets: Record<string, string>;
  overrides: Record<string, StudentOverride>;
  confirmed: boolean;
  /** Set when the apply step first runs; every request of the run derives its repeat-safe key from it. */
  runId: string;
}

export type StudentAction = "renew" | "graduate" | "leave" | "skip";

export interface PlannedStudent {
  student: StudentRecord;
  action: StudentAction;
  targetClassId?: string;
}

export interface TransitionPlan {
  /** Active students with a class whose open enrollment is not yet in the target term. */
  candidates: PlannedStudent[];
  renew: PlannedStudent[];
  graduate: PlannedStudent[];
  leave: PlannedStudent[];
  skip: PlannedStudent[];
  /** Students whose open enrollment is already in the target term: renewed by an earlier run or already there. */
  alreadyInTerm: StudentRecord[];
  classless: StudentRecord[];
  sourceClassIds: string[];
}

export function readWizardState(params: URLSearchParams): WizardState {
  const rawStep = Number(params.get("adim") ?? "1");
  const step = (Number.isInteger(rawStep) && rawStep >= 1 && rawStep <= 6 ? rawStep : 1) as WizardStepNumber;
  const classTargets: Record<string, string> = {};
  for (const entry of params.getAll("e")) {
    const [source, target] = splitPair(entry);
    if (source && target) classTargets[source] = target;
  }
  const overrides: Record<string, StudentOverride> = {};
  for (const entry of params.getAll("o")) {
    const [studentId, value] = splitPair(entry);
    if (studentId && (value === "A" || value === "H")) overrides[studentId] = value;
  }
  return {
    step,
    academicYearId: params.get("yil") ?? "",
    termId: params.get("donem") ?? "",
    classTargets,
    overrides,
    confirmed: params.get("onay") === "1",
    runId: normalizeRunId(params.get("kosu")),
  };
}

export function writeWizardState(state: WizardState): string {
  const params = new URLSearchParams();
  if (state.step !== 1) params.set("adim", String(state.step));
  if (state.academicYearId) params.set("yil", state.academicYearId);
  if (state.termId) params.set("donem", state.termId);
  for (const [source, target] of Object.entries(state.classTargets).sort(([left], [right]) => left.localeCompare(right))) {
    if (target) params.append("e", `${source}:${target}`);
  }
  for (const [studentId, value] of Object.entries(state.overrides).sort(([left], [right]) => left.localeCompare(right))) {
    params.append("o", `${studentId}:${value}`);
  }
  if (state.confirmed) params.set("onay", "1");
  if (state.runId) params.set("kosu", state.runId);
  return params.toString();
}

export function buildTransitionPlan(
  activeStudents: readonly StudentRecord[],
  state: Pick<WizardState, "classTargets" | "overrides">,
  studentIdsInTargetTerm: ReadonlySet<string>,
): TransitionPlan {
  const plan: TransitionPlan = {
    candidates: [],
    renew: [],
    graduate: [],
    leave: [],
    skip: [],
    alreadyInTerm: [],
    classless: [],
    sourceClassIds: [],
  };
  const sourceClassIds = new Set<string>();
  for (const student of [...activeStudents].sort(compareStudents)) {
    if (student.status !== "ACTIVE") continue;
    if (studentIdsInTargetTerm.has(student.id)) {
      plan.alreadyInTerm.push(student);
      continue;
    }
    if (!student.classId) {
      plan.classless.push(student);
      continue;
    }
    sourceClassIds.add(student.classId);
    const planned = planStudent(student, student.classId, state);
    plan.candidates.push(planned);
    plan[planned.action].push(planned);
  }
  plan.sourceClassIds = [...sourceClassIds];
  return plan;
}

function planStudent(student: StudentRecord, classId: string, state: Pick<WizardState, "classTargets" | "overrides">): PlannedStudent {
  const override = state.overrides[student.id];
  if (override === "A") return { student, action: "leave" };
  if (override === "H") return { student, action: "skip" };
  const target = state.classTargets[classId];
  if (!target) return { student, action: "skip" };
  if (target === graduateTarget) return { student, action: "graduate" };
  return { student, action: "renew", targetClassId: target };
}

export function renewRequestBody(plan: TransitionPlan, state: Pick<WizardState, "academicYearId" | "termId">): StudentBulkEnrollmentRequest {
  const classIdBySourceClassId: Record<string, string> = {};
  for (const item of plan.renew) {
    if (item.student.classId && item.targetClassId) classIdBySourceClassId[item.student.classId] = item.targetClassId;
  }
  return {
    studentIds: plan.renew.map((item) => item.student.id).sort(),
    classIdBySourceClassId: sortRecord(classIdBySourceClassId),
    academicYearId: state.academicYearId,
    termId: state.termId,
  };
}

export function statusRequestBody(items: readonly PlannedStudent[], status: StudentBulkStatusRequest["status"]): StudentBulkStatusRequest {
  return { studentIds: items.map((item) => item.student.id).sort(), status, confirmIrreversible: true };
}

/** Repeat-safe key: the same run and the same body reuse the key, so a retry after a lost answer is not applied twice. */
export async function stepRequestKey(runId: string, step: string, body: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest.slice(0, 8)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${runId}.${step}.${hex}`;
}

export function newRunId(): string {
  return globalThis.crypto.randomUUID();
}

export function studentName(student: Pick<StudentRecord, "firstName" | "lastName">): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

function compareStudents(left: StudentRecord, right: StudentRecord): number {
  return studentName(left).localeCompare(studentName(right), "tr-TR") || left.id.localeCompare(right.id);
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function splitPair(entry: string): [string, string] {
  const index = entry.lastIndexOf(":");
  return index > 0 ? [entry.slice(0, index), entry.slice(index + 1)] : ["", ""];
}

function normalizeRunId(value: string | null): string {
  return value && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : "";
}
