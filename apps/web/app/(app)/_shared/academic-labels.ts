export function formatCourseName(value: string | null | undefined) {
  const raw = value ?? "";
  const cleaned = stripLgsMarker(raw);
  return (canonicalCourseName(raw, cleaned) ?? cleaned) || "-";
}

export function shortCourseName(value: string | null | undefined) {
  const cleaned = formatCourseName(value);
  const upper = cleaned.toLocaleUpperCase("tr-TR");
  if (upper.includes("TÜRKÇE") || upper.includes("TURKCE")) return "Türkçe";
  if (upper.includes("İNKILAP") || upper.includes("INKILAP") || upper.includes("ATATÜRK")) return "İnkılap";
  if (upper.includes("DİN") || upper.includes("DIN")) return "Din";
  if (upper.includes("İNGİLİZCE") || upper.includes("INGILIZCE")) return "İng.";
  if (upper.includes("MATEMATİK") || upper.includes("MATEMATIK") || upper === "MAT") return "Mat.";
  if (upper.includes("FEN")) return "Fen";
  return cleaned.length > 12 ? `${cleaned.slice(0, 12)}.` : cleaned;
}

export function formatOutcomeCode(value: string | null | undefined) {
  return stripLgsMarker(value ?? "") || "-";
}

export function formatOutcomeTitle(value: string | null | undefined) {
  return stripLgsMarker(value ?? "") || "-";
}

export function formatOutcomeChartName(branch: string | null | undefined, outcomeCode: string | null | undefined) {
  return `${shortCourseName(branch)} / ${formatOutcomeCode(outcomeCode)}`;
}

function stripLgsMarker(value: string) {
  return value
    .replace(/\bLGS\d*\s*[-_.]?\s*/giu, "")
    .replace(/\s*[-_/]\s*$/u, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function canonicalCourseName(raw: string, cleaned: string) {
  const upper = cleaned.toLocaleUpperCase("tr-TR");
  const shouldNormalize = /\bLGS\d*/iu.test(raw) || cleaned === upper;
  if (!shouldNormalize) return undefined;
  if (upper.includes("TÜRKÇE") || upper.includes("TURKCE")) return "Türkçe";
  if (upper.includes("İNKILAP") || upper.includes("INKILAP") || upper.includes("ATATÜRK")) return "İnkılap";
  if (upper.includes("DİN") || upper.includes("DIN")) return "Din";
  if (upper.includes("İNGİLİZCE") || upper.includes("INGILIZCE")) return "İngilizce";
  if (upper.includes("MATEMATİK") || upper.includes("MATEMATIK") || upper === "MAT") return "Matematik";
  if (upper.includes("FEN")) return "Fen";
  return undefined;
}
