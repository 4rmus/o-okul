"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input } from "@o-okul/ui";
import { estimateAnnualPrice, formatAverageTl, formatCount, formatTl, minimumBilledStudents, quoteFromStudents } from "./pricing.js";

// Hazır seçenekler kademe sınırlarıdır; son seçenek teklif eşiğini gösterir.
const presets = [
  { label: "100", value: 100 },
  { label: "250", value: 250 },
  { label: "500", value: 500 },
  { label: "1.000", value: 1000 },
  { label: "2.000", value: 2000 },
  { label: "3.000+", value: quoteFromStudents },
] as const;

export function PriceCalculator() {
  const [value, setValue] = useState("500");
  const trimmed = value.trim();
  const estimate = trimmed === "" ? null : estimateAnnualPrice(Number(trimmed));
  const error = estimate?.kind === "invalid" ? "1 veya daha büyük bir tam sayı girin." : undefined;

  return (
    <div className="next-pricing-calculator" id="hesaplayici">
      <div className="next-pricing-calculator__input">
        <h2 id="calculator-title">Yıllık tutarı hesaplayın</h2>
        <Field label="Aktif öğrenci sayısı" description="Bütün kampüslerinizdeki toplam aktif öğrenci. Hesap tarayıcınızda yapılır; sayı kaydedilmez veya gönderilmez." error={error}>
          <Input inputMode="numeric" min={1} name="activeStudents" onChange={(event) => setValue(event.target.value)} step={1} type="number" value={value} />
        </Field>
        <div className="next-pricing-presets" role="group" aria-label="Hazır öğrenci sayıları">
          {presets.map((preset) => (
            <Button
              key={preset.value}
              aria-pressed={trimmed === String(preset.value)}
              onClick={() => setValue(String(preset.value))}
              size="sm"
              variant="ghost"
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
      <output aria-live="polite" className="next-pricing-calculator__result">
        {estimate?.kind === "price" ? (
          <>
            <span className="next-pricing-calculator__label">Yıllık tutar · KDV hariç</span>
            <strong className="next-pricing-calculator__total">{formatTl(estimate.total)}</strong>
            <span className="next-pricing-calculator__average">Öğrenci başı ortalama {formatAverageTl(estimate.total / estimate.billedStudents)}</span>
            <ul className="next-pricing-calculator__lines" aria-label="Hesap dökümü">
              {estimate.minimumApplied ? <li className="next-pricing-calculator__note">En küçük paket {minimumBilledStudents} öğrenci: tutar {minimumBilledStudents} öğrenci üzerinden hesaplandı.</li> : null}
              {estimate.lines.map((line) => (
                <li key={line.unitPrice}>
                  <span>{formatCount(line.students)} öğrenci × {formatTl(line.unitPrice)}</span>
                  <span>{formatTl(line.students * line.unitPrice)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : estimate?.kind === "quote" ? (
          <>
            <span className="next-pricing-calculator__label">{formatCount(quoteFromStudents)} ve üzeri öğrenci</span>
            <strong className="next-pricing-calculator__total">Teklif alın</strong>
            <span className="next-pricing-calculator__average">Bu büyüklükteki kurumlar için fiyatı birlikte netleştiriyoruz.</span>
            <Link className="uh-button uh-button--secondary uh-button--md" href="/iletisim#teklif">Teklif talebi hazırla</Link>
          </>
        ) : (
          <span className="next-pricing-calculator__label">Tutarı görmek için öğrenci sayısını girin.</span>
        )}
      </output>
    </div>
  );
}
