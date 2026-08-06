export const passwordMinLength = 8;
export const passwordMaxLength = 128;

const blockedPasswords = new Set([
  "123456789012345",
  "adminadminadmin",
  "letmeinletmein",
  "passwordpassword",
  "qwertyqwertyqwerty",
]);

export function passwordPolicyViolation(password: string | undefined): string | undefined {
  if (!password || password.length < passwordMinLength) return "PASSWORD_MIN_8_REQUIRED";
  if (password.length > passwordMaxLength) return "PASSWORD_MAX_128_EXCEEDED";
  if (!/\p{Lu}/u.test(password)) return "PASSWORD_UPPERCASE_REQUIRED";
  if (!/\p{Ll}/u.test(password)) return "PASSWORD_LOWERCASE_REQUIRED";
  if (blockedPasswords.has(password.normalize("NFKC").toLowerCase())) return "PASSWORD_COMMON_REJECTED";
  return undefined;
}
