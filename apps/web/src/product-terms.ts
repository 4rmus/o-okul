export const productTerms = {
  institution: "Kurum",
  branch: "Kampüs",
  allBranches: "Tüm kampüsler",
  rawImport: "Optik yükleme",
  parserConfig: "Optik formatı",
  quarantine: "İncelenecek kayıtlar",
  reportVersion: "Rapor sürümü",
  preparationOperation: "Hazırlama işlemi",
  reportStatus: {
    READY: "Rapor hazır",
    PENDING: "Hazırlanıyor",
    RUNNING: "Hazırlanıyor",
    STALE: "Yeniden oluşturulmalı",
    FAILED: "Oluşturulamadı",
  },
} as const;

export type ProductReportStatus = keyof typeof productTerms.reportStatus;
