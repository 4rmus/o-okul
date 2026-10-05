"use client";

import Link from "next/link";
import { useState } from "react";
import { Field, Input } from "@o-okul/ui";
import { estimateAnnualPrice, formatTl, minimumAnnualPrice } from "./pricing.js";

export function PriceCalculator() {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const estimate = trimmed === "" ? null : estimateAnnualPrice(Number(trimmed));
  const error = estimate?.kind === "invalid" ? "1 veya daha büyük bir tam sayı girin." : undefined;

  return (
    <div className="next-pricing-calculator">
      <Field label="Aktif öğrenci sayısı" description="Kurumunuzun bütün kampüslerindeki toplam aktif öğrenci." error={error}>
        <Input inputMode="numeric" min={1} name="activeStudents" onChange={(event) => setValue(event.target.value)} step={1} type="number" value={value} />
      </Field>
      <output aria-live="polite" className="next-pricing-calculator__result">
        {estimate?.kind === "price" ? (
          <>
            <span>Yıllık tutar (KDV hariç)</span>
            <strong>{formatTl(estimate.total)}</strong>
            <small>
              {estimate.minimumApplied
                ? `Yıllık en az ${formatTl(minimumAnnualPrice)} uygulanır.`
                : `Öğrenci başı ${formatTl(estimate.unitPrice)} × ${new Intl.NumberFormat("tr-TR").format(Number(trimmed))} öğrenci`}
            </small>
          </>
        ) : estimate?.kind === "quote" ? (
          <>
            <span>7001 ve üzeri öğrenci</span>
            <strong>Teklif alın</strong>
            <Link className="next-marketing-text-link" href="/iletisim#teklif">Teklif talebi hazırla</Link>
          </>
        ) : (
          <span>Tutarı görmek için öğrenci sayısını girin.</span>
        )}
      </output>
    </div>
  );
}
