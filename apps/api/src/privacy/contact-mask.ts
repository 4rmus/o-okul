export function maskContactPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "Telefon kayıtlı";
  return `••• ••• ••${digits.slice(-2).padStart(2, "•")}`;
}

export function maskContactEmail(value: string): string {
  const [localPart = "", domain = ""] = value.split("@");
  if (!localPart || !domain) return "E-posta kayıtlı";
  return `${localPart.slice(0, 2)}••@${domain.replace(/^[^.]*/, "•••")}`;
}
