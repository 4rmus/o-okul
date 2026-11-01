const istanbulDateKeyFormat = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Europe/Istanbul", year: "numeric" });
const dateKeyLabelFormat = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "UTC" });

// "Bugün" Türkiye saatine göredir; toISOString() UTC tarihini verir ve 03:00'ten önce bir önceki günü döndürür.
export function istanbulDateKey(date: Date = new Date()) {
  return istanbulDateKeyFormat.format(date);
}

/** "2026-11-01" gibi bir takvim gününü (veya o güne ait ISO zamanını) "1 Kas 2026" olarak yazar. */
export function formatDateKey(value: string) {
  const key = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!key) return value;
  return dateKeyLabelFormat.format(new Date(`${key}T00:00:00Z`));
}

export function readDateKeyParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}
