import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DataTable } from "@o-okul/ui";
import { appBrand, appBrandHomeAriaLabel, trialOfferPublished } from "../../src/brand.js";
import { PriceCalculator } from "./price-calculator.js";
import { estimateAnnualPrice, formatTl, minimumAnnualPrice, pricingTiers, quoteFromStudents } from "./pricing.js";

const exampleStudents = 1000;
const exampleEstimate = estimateAnnualPrice(exampleStudents);
const exampleText = exampleEstimate.kind === "price"
  ? `${exampleEstimate.lines.map((line) => `${line.students} × ${formatTl(line.unitPrice)}`).join(" + ")} = ${formatTl(exampleEstimate.total)}`
  : "";

type TierRow = { key: string; range: string; unitPrice: string };

const tierRows: TierRow[] = [
  ...pricingTiers.map((tier) => ({
    key: String(tier.min),
    range: `${tier.min}–${tier.max} (${tier.min === 1 ? "ilk" : "sonraki"} ${tier.max - tier.min + 1})`,
    unitPrice: formatTl(tier.unitPrice),
  })),
  { key: "quote", range: `${quoteFromStudents} ve üzeri`, unitPrice: "Teklif alın" },
];

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
            <p>Fiyatlar KDV hariç ve yıllıktır. Fiyat kademelidir: her kademenin birim fiyatı yalnız o aralıktaki öğrencilere uygulanır.</p>
          </div>
          <DataTable
            caption="Öğrenci başı yıllık fiyat kademeleri"
            description="KDV hariç, yıllık"
            columns={[
              { key: "range", header: "Kademe", render: (row) => row.range },
              { key: "unitPrice", header: "Aralıktaki öğrenci başı", align: "right", render: (row) => <strong>{row.unitPrice}</strong> },
            ]}
            getRowKey={(row) => row.key}
            rows={tierRows}
          />
          <ul className="next-pricing-included">
            <li><CheckCircle2 size={17} aria-hidden="true" /> <span>Toplam yıllık tutar en az {formatTl(minimumAnnualPrice)} olur.</span></li>
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
            <p>Öğrencileriniz kademelere sırayla yerleşir: ilk 250 öğrenci 280 TL, sonraki 250 öğrenci 250 TL, sonraki 500 öğrenci 220 TL, sonraki 2000 öğrenci 190 TL, sonraki 4000 öğrenci 160 TL. Kademe tutarları toplanır; toplam {formatTl(minimumAnnualPrice)} altındaysa {formatTl(minimumAnnualPrice)} uygulanır.</p>
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
              <p>Demo görüşmesinde öğrenci sayınızı ve kademelerinizi konuşalım; {quoteFromStudents} ve üzeri öğrenci için teklif hazırlarız. İlk talepte öğrenci verisi paylaşmayın.</p>
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
