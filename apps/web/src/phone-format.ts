export function formatTurkishPhoneInput(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0090")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("90")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (!digits) return "";

  return `+90 ${[digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)].filter(Boolean).join(" ")}`;
}
