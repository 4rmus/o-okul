const boundSubjectRoles = ["STUDENT", "GUARDIAN", "TEACHER"] as const;

export function missingBoundSubjectRole(input: {
  roles: readonly string[];
  subjectType?: string;
  subjectId?: string;
}): string | null {
  const role = boundSubjectRoles.find((candidate) => input.roles.includes(candidate));
  if (!role) return null;
  return input.subjectType === role && Boolean(input.subjectId) ? null : role;
}
