import { UnprocessableEntityException } from "@nestjs/common";

export function normalizeTurkishMobilePhone(value: string, errorCode = "PHONE_INVALID"): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0090")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("90") && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (!/^5\d{9}$/.test(digits)) {
    throw new UnprocessableEntityException(errorCode);
  }
  return digits;
}

export function optionalTurkishMobilePhone(value: string | undefined, errorCode = "PHONE_INVALID"): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? normalizeTurkishMobilePhone(trimmed, errorCode) : undefined;
}
