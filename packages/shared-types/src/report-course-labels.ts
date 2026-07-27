import type { ExamScoreType } from "./domain.js";

const scoreCourseOrder: Record<ExamScoreType, readonly string[]> = {
  LGS: ["Tr", "Mat", "Fen", "İnk", "Din", "Yab"],
  TYT: ["Tr", "Sos", "Mat", "Fen"],
  SAY: ["Mat", "Fiz", "Kim", "Bio"],
  EA: ["Mat", "Edb", "Tar-1", "Coğ-1"],
  SOZ: ["Edb", "Tar-1", "Coğ-1", "Tar-2", "Coğ-2", "Fel", "Din"],
};

export function reportCourseShortName(courseName: string): string {
  const normalized = normalizeCourseName(courseName);

  if (normalized.includes("EDEBIYAT")) return "Edb";
  if (normalized.includes("INKILAP")) return "İnk";
  if (normalized.includes("DIN")) return "Din";
  if (normalized.includes("FELSEFE")) return "Fel";
  if (normalized.includes("TARIH 2")) return "Tar-2";
  if (normalized.includes("TARIH")) return "Tar-1";
  if (normalized.includes("COGRAFYA 2")) return "Coğ-2";
  if (normalized.includes("COGRAFYA")) return "Coğ-1";
  if (normalized.includes("MATEMATIK")) return "Mat";
  if (normalized.includes("FIZIK")) return "Fiz";
  if (normalized.includes("KIMYA")) return "Kim";
  if (normalized.includes("BIYOLOJI")) return "Bio";
  if (normalized.includes("TURKCE")) return "Tr";
  if (normalized.includes("SOSYAL")) return "Sos";
  if (normalized.includes("FEN")) return "Fen";
  if (normalized.includes("YABANCI") || normalized.includes("INGILIZCE")) return "Yab";

  const trimmed = courseName.trim();
  return trimmed.length > 10 ? `${trimmed.slice(0, 9)}.` : trimmed;
}

export function reportCourseMatchesScoreType(type: ExamScoreType, courseName: string): boolean {
  return scoreCourseOrder[type].includes(reportCourseShortName(courseName));
}

export function reportCourseSortOrder(type: ExamScoreType, courseName: string): number {
  const index = scoreCourseOrder[type].indexOf(reportCourseShortName(courseName));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizeCourseName(value: string): string {
  return value
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Z0-9]+/gu, " ")
    .trim();
}
