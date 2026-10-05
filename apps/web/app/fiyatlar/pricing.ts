// DEC-20261005-01 + ürün sahibi kararı (2026-10-05): yıllık, KDV hariç, kademeli fiyat.
// Her kademenin birim fiyatı yalnız o aralıktaki öğrencilere uygulanır (gelir vergisi dilimi gibi);
// böylece öğrenci sayısı artınca toplam tutar hiçbir sınırda düşmez.
export const pricingTiers = [
  { min: 1, max: 250, unitPrice: 280 },
  { min: 251, max: 500, unitPrice: 250 },
  { min: 501, max: 1000, unitPrice: 220 },
  { min: 1001, max: 3000, unitPrice: 190 },
  { min: 3001, max: 7000, unitPrice: 160 },
] as const;

export const minimumAnnualPrice = 25_000;
export const quoteFromStudents = 7001;

export type PriceLine = { students: number; unitPrice: number };

export type PriceEstimate =
  | { kind: "invalid" }
  | { kind: "quote" }
  | { kind: "price"; lines: PriceLine[]; minimumApplied: boolean; total: number };

export function estimateAnnualPrice(activeStudents: number): PriceEstimate {
  if (!Number.isInteger(activeStudents) || activeStudents < 1) return { kind: "invalid" };
  if (activeStudents >= quoteFromStudents) return { kind: "quote" };
  const lines = pricingTiers
    .filter((tier) => activeStudents >= tier.min)
    .map((tier) => ({ students: Math.min(activeStudents, tier.max) - tier.min + 1, unitPrice: tier.unitPrice }));
  const listed = lines.reduce((sum, line) => sum + line.students * line.unitPrice, 0);
  return { kind: "price", lines, minimumApplied: listed < minimumAnnualPrice, total: Math.max(listed, minimumAnnualPrice) };
}

export function formatTl(amount: number) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}
