// Tek Türkçe biçimlendirme katmanı: tarih/saat Türkiye saatiyle (Europe/Istanbul), telefon +90 gruplu, kimlik maskeli.
export const appLocale = "tr-TR";
export const appTimeZone = "Europe/Istanbul";

type DateInput = Date | string | null | undefined;

const istanbulDateKeyFormat = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: appTimeZone, year: "numeric" });
const dateKeyLabelFormat = new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeZone: "UTC" });
const dateFormat = new Intl.DateTimeFormat(appLocale, { dateStyle: "short", timeZone: appTimeZone });
const dateTimeFormat = new Intl.DateTimeFormat(appLocale, { dateStyle: "short", timeStyle: "short", timeZone: appTimeZone });
const dateTimeMediumFormat = new Intl.DateTimeFormat(appLocale, { dateStyle: "medium", timeStyle: "short", timeZone: appTimeZone });
const timeFormat = new Intl.DateTimeFormat(appLocale, { timeStyle: "short", timeZone: appTimeZone });
const wallClockDateTimeFormat = new Intl.DateTimeFormat(appLocale, { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(format: Intl.DateTimeFormat, value: DateInput, fallback: string) {
  const date = toDate(value);
  if (date) return format.format(date);
  return typeof value === "string" && value ? value : fallback;
}

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

/** Bir anı Türkiye takvim günü olarak yazar: "10.06.2026". */
export function formatDate(value: DateInput, fallback = "-") {
  return formatWith(dateFormat, value, fallback);
}

/** Bir anı Türkiye saatiyle yazar: "10.06.2026 15:05"; `medium` stili "10 Haz 2026 15:05" verir. */
export function formatDateTime(value: DateInput, options: { fallback?: string; style?: "medium" | "short" } = {}) {
  return formatWith(options.style === "medium" ? dateTimeMediumFormat : dateTimeFormat, value, options.fallback ?? "-");
}

/** Bir anın Türkiye saatini yazar: "15:05". */
export function formatTime(value: DateInput, fallback = "-") {
  return formatWith(timeFormat, value, fallback);
}

/** Aynı gün içindeki aralığı "09:00–10:30", farklı günlerde tarih ve saatle yazar. */
export function formatTimeRange(start: DateInput, end: DateInput, fallback = "-") {
  const startDate = toDate(start);
  const endDate = toDate(end);
  if (!startDate) return fallback;
  if (!endDate) return formatDateTime(startDate);
  if (istanbulDateKey(startDate) === istanbulDateKey(endDate)) return `${formatTime(startDate)}–${formatTime(endDate)}`;
  return `${formatDateTime(startDate)} – ${formatDateTime(endDate)}`;
}

/**
 * Takvim günü veya anı bugüne göre yazar: "Bugün", "Dün", "Yarın", "3 gün önce", "2 gün sonra";
 * bir haftadan uzaksa tarih etiketi döner.
 */
export function formatRelativeDay(value: DateInput, now: Date = new Date(), fallback = "-") {
  const key = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const date = key ? null : toDate(value);
  const dayKey = key ?? (date ? istanbulDateKey(date) : null);
  if (!dayKey) return typeof value === "string" && value ? value : fallback;
  const diff = Math.round((Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${istanbulDateKey(now)}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Bugün";
  if (diff === -1) return "Dün";
  if (diff === 1) return "Yarın";
  if (Math.abs(diff) <= 7) return diff < 0 ? `${-diff} gün önce` : `${diff} gün sonra`;
  return formatDateKey(dayKey);
}

/**
 * Formdaki yerel saati UTC alanında saklayan kayıtlar (ders programı, etüt) için duvar saatini kaydırmadan yazar:
 * "2026-11-01T09:00:00.000Z" -> "01.11.2026 09:00".
 */
export function formatWallClockDateTime(value: DateInput, fallback = "-") {
  return formatWith(wallClockDateTimeFormat, value, fallback);
}

function turkishPhoneDigits(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0090")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("90") && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/** Telefon girişini yazdıkça "+90 532 123 45 67" biçimine getirir. */
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

/** Kayıtlı telefonu gösterir; Türkiye numarası "+90 532 123 45 67" olur, tanınmayan değer olduğu gibi kalır. */
export function formatPhone(value: string | null | undefined, fallback = "-") {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  const digits = turkishPhoneDigits(trimmed);
  return digits.length === 10 ? formatTurkishPhoneInput(digits) : trimmed;
}

/** Telefonu yalnız son iki hanesiyle gösterir: "••• ••• ••67". */
export function maskPhone(value: string | null | undefined) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  return `••• ••• ••${digits.slice(-2).padStart(2, "•")}`;
}

/** TC kimlik numarasını API maskesiyle aynı biçimde, en fazla son dört haneyle gösterir: "*******2362". */
export function maskNationalId(value: string | null | undefined) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Kimlik kayıtlı";
  return `*******${digits.slice(-4).padStart(4, "*")}`;
}
