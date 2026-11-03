import {
  studentBulkMaxStudentCount,
  type StudentBulkEnrollmentRequest,
  type StudentBulkRenewDryRunResult,
  type StudentBulkStatusRequest,
  type StudentRecord,
} from "@o-okul/shared-types";

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
  /**
   * Irreversible-exit confirmation: the fingerprint of the exit set the user confirmed (`exitSetFingerprint`). It counts
   * only while it matches the current plan, so a changed set of graduating or leaving students needs a new confirmation.
   */
  confirmation: string;
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
    confirmation: normalizeConfirmation(params.get("onay")),
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
  if (state.confirmation) params.set("onay", state.confirmation);
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

/**
 * Fingerprint of the students the transition would graduate or move out, with their action. It binds the
 * irreversible confirmation to exactly this set; it is not a secret and names no student on its own.
 */
export function exitSetFingerprint(plan: Pick<TransitionPlan, "graduate" | "leave">): string {
  const text = [
    ...plan.graduate.map((item) => `G:${item.student.id}`),
    ...plan.leave.map((item) => `A:${item.student.id}`),
  ].sort().join("|");
  return fnv1a32(text, 0x811c9dc5) + fnv1a32(text, 0x050c5d1f);
}

/** True when the plan has no exits, or the confirmation in the address matches the current exit set. */
export function isExitConfirmed(plan: Pick<TransitionPlan, "graduate" | "leave">, state: Pick<WizardState, "confirmation">): boolean {
  if (plan.graduate.length + plan.leave.length === 0) return true;
  return state.confirmation !== "" && state.confirmation === exitSetFingerprint(plan);
}

/** Splits a list into the server's per-request bound (`studentBulkMaxStudentCount`). */
export function chunkStudents<T>(items: readonly T[], size = studentBulkMaxStudentCount): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Bulk renewal requests of the plan, at most `studentBulkMaxStudentCount` students each, in a stable order. */
export function renewRequestBodies(plan: TransitionPlan, state: Pick<WizardState, "academicYearId" | "termId">): StudentBulkEnrollmentRequest[] {
  const renew = [...plan.renew].sort((left, right) => left.student.id.localeCompare(right.student.id));
  return chunkStudents(renew).map((items) => {
    const classIdBySourceClassId: Record<string, string> = {};
    for (const item of items) {
      if (item.student.classId && item.targetClassId) classIdBySourceClassId[item.student.classId] = item.targetClassId;
    }
    return {
      studentIds: items.map((item) => item.student.id),
      classIdBySourceClassId: sortRecord(classIdBySourceClassId),
      academicYearId: state.academicYearId,
      termId: state.termId,
    };
  });
}

export function statusRequestBodies(items: readonly PlannedStudent[], status: StudentBulkStatusRequest["status"]): StudentBulkStatusRequest[] {
  const studentIds = items.map((item) => item.student.id).sort();
  return chunkStudents(studentIds).map((chunk) => ({ studentIds: chunk, status, confirmIrreversible: true }));
}

/**
 * One preview from the per-batch previews: items and conflicts are joined, the licence count adds up the incoming
 * students, and the calendar permission holds only when every batch allows it.
 */
export function mergeDryRunResults(results: readonly StudentBulkRenewDryRunResult[]): StudentBulkRenewDryRunResult | undefined {
  const [first] = results;
  if (!first) return undefined;
  const incoming = results.reduce((total, result) => total + result.quota.incoming, 0);
  return {
    ...first,
    termStarted: results.every((result) => result.termStarted),
    canActivateCalendar: results.every((result) => result.canActivateCalendar),
    items: results.flatMap((result) => result.items),
    conflictStudentIds: results.flatMap((result) => result.conflictStudentIds),
    quota: {
      limit: first.quota.limit,
      current: first.quota.current,
      incoming,
      wouldExceed: first.quota.current + incoming > first.quota.limit,
    },
  };
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

function normalizeConfirmation(value: string | null): string {
  return value && /^[0-9a-f]{16}$/.test(value) ? value : "";
}

/** 32-bit FNV-1a over UTF-16 code units as 8 hex digits; synchronous so the plan can be checked while rendering. */
function fnv1a32(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeRunId(value: string | null): string {
  return value && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : "";
}
