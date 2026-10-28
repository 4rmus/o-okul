// DEC-20261028-01 (kademeli hesap DEC-20261005-01'den): yıllık, KDV hariç, kademeli fiyat.
// Her kademenin birim fiyatı yalnız o aralıktaki öğrencilere uygulanır (gelir vergisi dilimi gibi);
// böylece öğrenci sayısı artınca toplam tutar hiçbir sınırda düşmez. En küçük paket 100 öğrencidir.
export const pricingTiers = [
  { min: 1, max: 100, unitPrice: 99 },
  { min: 101, max: 250, unitPrice: 95 },
  { min: 251, max: 500, unitPrice: 90 },
  { min: 501, max: 1000, unitPrice: 85 },
  { min: 1001, max: 2000, unitPrice: 80 },
  { min: 2001, max: 3000, unitPrice: 75 },
] as const;

export const minimumBilledStudents = 100;
export const quoteFromStudents = 3001;

export type PriceLine = { students: number; unitPrice: number };

export type PriceEstimate =
  | { kind: "invalid" }
  | { kind: "quote" }
  | { kind: "price"; billedStudents: number; lines: PriceLine[]; minimumApplied: boolean; total: number };

export function estimateAnnualPrice(activeStudents: number): PriceEstimate {
  if (!Number.isInteger(activeStudents) || activeStudents < 1) return { kind: "invalid" };
  if (activeStudents >= quoteFromStudents) return { kind: "quote" };
  const billedStudents = Math.max(activeStudents, minimumBilledStudents);
  const lines = pricingTiers
    .filter((tier) => billedStudents >= tier.min)
    .map((tier) => ({ students: Math.min(billedStudents, tier.max) - tier.min + 1, unitPrice: tier.unitPrice }));
  const total = lines.reduce((sum, line) => sum + line.students * line.unitPrice, 0);
  return { kind: "price", billedStudents, lines, minimumApplied: activeStudents < minimumBilledStudents, total };
}

export function formatTl(amount: number) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

// Ortalama tam sayıysa kuruş gösterilmez (99 TL), değilse iki hane (96,60 TL).
export function formatAverageTl(amount: number) {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: fractionDigits }).format(amount)} TL`;
}
