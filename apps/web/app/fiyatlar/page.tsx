import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DataTable } from "@o-okul/ui";
import { appBrand, appBrandHomeAriaLabel, trialOfferPublished } from "../../src/brand.js";
import { PriceCalculator } from "./price-calculator.js";
import { estimateAnnualPrice, formatTl, minimumBilledStudents, pricingTiers, quoteFromStudents } from "./pricing.js";

const exampleStudents = 1000;
const exampleEstimate = estimateAnnualPrice(exampleStudents);
const exampleText = exampleEstimate.kind === "price"
  ? `${exampleEstimate.lines.map((line) => `${line.students} × ${formatTl(line.unitPrice)}`).join(" + ")} = ${formatTl(exampleEstimate.total)}`
  : "";

type TierRow = { key: string; range: string; unitPrice: string; total: string };

// Each band's upper bound doubles as a package: the yearly total and the average per student a school of that size pays.
const packages = pricingTiers.map((tier) => {
  const estimate = estimateAnnualPrice(tier.max);
  const total = estimate.kind === "price" ? estimate.total : 0;
  return { students: tier.max, total, average: total / tier.max };
});

const tierRows: TierRow[] = [
  ...pricingTiers.map((tier, index) => ({
    key: String(tier.min),
    range: `${formatCount(tier.min)}–${formatCount(tier.max)} öğrenci`,
    unitPrice: formatTl(tier.unitPrice),
    total: formatTl(packages[index]!.total),
  })),
  { key: "quote", range: `${formatCount(quoteFromStudents)} ve üzeri`, unitPrice: "Teklif alın", total: "Teklif alın" },
];

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatAverage(value: number) {
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: fractionDigits }).format(value)} TL`;
}

const included = [
  "Kurulum ücreti yok, tüm modüller dahil.",
  "Fiyat yalnız aktif öğrenci sayısına göre belirlenir; çalışan hesapları ücretli değildir.",
  "Satış yıllıktır; aylık ödeme seçeneği yoktur.",
] as const;

export default function PricingPage() {
  return (
    <main className="next-marketing">
      <a className="next-marketing-skip" href="#main-content">İçeriğe geç</a>
      <header className="next-marketing-header">
        <nav className="next-marketing-nav" aria-label="Fiyat navigasyonu">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link>
          <p className="next-marketing-nav__statement">Özel okullar için bütüncül öğrenci takibi.</p>
          <div className="next-marketing-nav__actions">
            <Link className="next-marketing-login" href="/login">Giriş yap</Link>
            <Link className="uh-button uh-button--primary uh-button--md" href="/iletisim#demo">Demo talep et</Link>
          </div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-section" aria-labelledby="pricing-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Fiyatlar</p>
            <h1 id="pricing-title">Aktif öğrenci sayınıza göre yıllık fiyat.</h1>
            <p>Fiyatlar KDV hariç ve yıllıktır. Öğrenci sayınız arttıkça öğrenci başı ortalama fiyat düşer.</p>
          </div>
          <ul className="next-pricing-packages" aria-label="Öğrenci sayısına göre yıllık toplam">
            {packages.map((item) => (
              <li key={item.students}>
                <span className="next-pricing-packages__students">{formatCount(item.students)} öğrenci</span>
                <strong>{formatTl(item.total)}</strong>
                <span>yıllık · öğrenci başı ort. {formatAverage(item.average)}</span>
              </li>
            ))}
            <li>
              <span className="next-pricing-packages__students">{formatCount(quoteFromStudents)}+ öğrenci</span>
              <strong>Teklif alın</strong>
              <Link className="next-marketing-text-link" href="/iletisim#teklif">Teklif talebi hazırla</Link>
            </li>
          </ul>
          <DataTable
            caption="Fiyat kademeleri"
            description="KDV hariç, yıllık. Her kademenin fiyatı yalnız o aralıktaki öğrencilere uygulanır."
            columns={[
              { key: "range", header: "Öğrenci aralığı", render: (row) => row.range },
              { key: "unitPrice", header: "Aralıktaki öğrenci başı", align: "right", render: (row) => row.unitPrice },
              { key: "total", header: "Aralık sonunda yıllık toplam", align: "right", render: (row) => <strong>{row.total}</strong> },
            ]}
            getRowKey={(row) => row.key}
            rows={tierRows}
          />
          <ul className="next-pricing-included">
            <li><CheckCircle2 size={17} aria-hidden="true" /> <span>En küçük paket {minimumBilledStudents} öğrencidir; daha az öğrencisi olan kurum {minimumBilledStudents} öğrenci üzerinden öder.</span></li>
            {included.map((item) => <li key={item}><CheckCircle2 size={17} aria-hidden="true" /> <span>{item}</span></li>)}
          </ul>
        </section>

        <section id="hesaplayici" className="next-marketing-section" aria-labelledby="calculator-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Hesaplayıcı</p>
            <h2 id="calculator-title">Yıllık tutarı hesaplayın.</h2>
            <p>Hesap tarayıcınızda yapılır; girdiğiniz sayı kaydedilmez veya gönderilmez.</p>
          </div>
          <div className="next-pricing-explainer">
            <h3 id="pricing-how-title">Nasıl hesaplanır?</h3>
            <p>Öğrencileriniz kademelere sırayla yerleşir: ilk 100 öğrenci 99 TL, sonraki 150 öğrenci 95 TL, sonraki 250 öğrenci 90 TL, sonraki 500 öğrenci 85 TL, sonraki 1000 öğrenci 80 TL, sonraki 1000 öğrenci 75 TL. Kademe tutarları toplanır; {minimumBilledStudents} öğrenciden azı {minimumBilledStudents} öğrenci olarak hesaplanır.</p>
            <p>Örnek, {exampleStudents} öğrenci: {exampleText}.</p>
          </div>
          <PriceCalculator />
        </section>

        {trialOfferPublished ? (
          <section className="next-marketing-cta" aria-labelledby="trial-title">
            <div>
              <h2 id="trial-title">Kart bilgisi olmadan 7 gün deneyin.</h2>
              <p>Deneme hesabı en fazla 100 aktif öğrenciyle 7 gün açılır ve talebiniz üzerine ekibimiz tarafından kurulur. İlk talepte öğrenci verisi paylaşmayın.</p>
            </div>
            <div className="next-marketing-cta__actions">
              <Link className="uh-button uh-button--primary uh-button--lg" href="/iletisim#teklif"><span>Deneme talep et</span><ArrowRight size={18} aria-hidden="true" /></Link>
              <Link className="next-marketing-text-link" href="/iletisim#demo">Demo talep et</Link>
            </div>
          </section>
        ) : (
          <section className="next-marketing-cta" aria-labelledby="pricing-cta-title">
            <div>
              <h2 id="pricing-cta-title">Kurumunuz için fiyatı birlikte netleştirelim.</h2>
              <p>Demo görüşmesinde öğrenci sayınızı ve kademelerinizi konuşalım; {quoteFromStudents} ve üzeri öğrencisi olan kurumlara özel fiyat teklifi hazırlarız. İlk talepte öğrenci verisi paylaşmayın.</p>
            </div>
            <div className="next-marketing-cta__actions">
              <Link className="uh-button uh-button--primary uh-button--lg" href="/iletisim#demo"><span>Demo talep et</span><ArrowRight size={18} aria-hidden="true" /></Link>
              <Link className="next-marketing-text-link" href="/iletisim#teklif">Teklif talebi hazırla</Link>
            </div>
          </section>
        )}
      </div>

      <footer className="next-marketing-footer">
        <div><Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link><p>Özel okullar için bütüncül öğrenci takibi.</p></div>
        <nav aria-label="Alt navigasyon"><Link href="/">Ana sayfa</Link><Link href="/iletisim">İletişim</Link><Link href="/login">Giriş</Link></nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
