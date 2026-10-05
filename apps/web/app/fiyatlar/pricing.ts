// DEC-20261005-01: yıllık, KDV hariç, aktif öğrenci kademesine göre öğrenci başı TL.
// Birim fiyat kurumun toplam aktif öğrenci sayısının düştüğü kademeden uygulanır.
export const pricingTiers = [
  { min: 1, max: 250, unitPrice: 280 },
  { min: 251, max: 500, unitPrice: 250 },
  { min: 501, max: 1000, unitPrice: 220 },
  { min: 1001, max: 3000, unitPrice: 190 },
  { min: 3001, max: 7000, unitPrice: 160 },
] as const;

export const minimumAnnualPrice = 25_000;
export const quoteFromStudents = 7001;

export type PriceEstimate =
  | { kind: "invalid" }
  | { kind: "quote" }
  | { kind: "price"; minimumApplied: boolean; total: number; unitPrice: number };

export function estimateAnnualPrice(activeStudents: number): PriceEstimate {
  if (!Number.isInteger(activeStudents) || activeStudents < 1) return { kind: "invalid" };
  const tier = pricingTiers.find((candidate) => activeStudents <= candidate.max);
  if (!tier) return { kind: "quote" };
  const listed = activeStudents * tier.unitPrice;
  return {
    kind: "price",
    minimumApplied: listed < minimumAnnualPrice,
    total: Math.max(listed, minimumAnnualPrice),
    unitPrice: tier.unitPrice,
  };
}

export function formatTl(amount: number) {
  return `${new Intl.NumberFormat("tr-TR").format(amount)} TL`;
}
