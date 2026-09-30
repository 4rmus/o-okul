// Sınav çalışma alanı route'ları (Berrak §4, Almanak §15.4). Sekme ↔ URL segmenti tek yerde eşlenir.
export type OpticalWorkspaceTab = "format" | "upload" | "quarantine";
export type ReportWorkspaceRouteTab = "overview" | "students" | "karne" | "exports";

const opticalSegments: Record<OpticalWorkspaceTab, string> = { format: "duzen", upload: "yukleme", quarantine: "eslesmeyenler" };
const reportSegments: Record<ReportWorkspaceRouteTab, string> = { overview: "genel", students: "ogrenciler", karne: "karne", exports: "ciktilar" };

export function examWorkspaceHref(examId: string, section?: "degerlendirme") {
  const base = `/kurum/sinavlar/${encodeURIComponent(examId)}`;
  return section ? `${base}/${section}` : base;
}

export function opticalWorkspaceHref(examId: string, tab: OpticalWorkspaceTab = "format") {
  return `${examWorkspaceHref(examId)}/optik/${opticalSegments[tab]}`;
}

export function reportWorkspaceHref(examId: string, tab: ReportWorkspaceRouteTab = "overview") {
  return `${examWorkspaceHref(examId)}/rapor/${reportSegments[tab]}`;
}

export function opticalTabFromSegment(segment: string | null): OpticalWorkspaceTab {
  return (Object.entries(opticalSegments).find(([, value]) => value === segment)?.[0] as OpticalWorkspaceTab | undefined) ?? "format";
}

export function reportTabFromSegment(segment: string | null): ReportWorkspaceRouteTab {
  return (Object.entries(reportSegments).find(([, value]) => value === segment)?.[0] as ReportWorkspaceRouteTab | undefined) ?? "overview";
}
