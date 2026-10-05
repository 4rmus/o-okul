import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { DataTable } from "@o-okul/ui";
import { appBrand, appBrandHomeAriaLabel } from "../../src/brand.js";
import { PriceCalculator } from "./price-calculator.js";
import { formatTl, minimumAnnualPrice, pricingTiers, quoteFromStudents } from "./pricing.js";

type TierRow = { key: string; range: string; unitPrice: string };

const tierRows: TierRow[] = [
  ...pricingTiers.map((tier) => ({
    key: String(tier.min),
    range: `${tier.min}–${tier.max}`,
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
            <p>Fiyatlar KDV hariç ve yıllıktır. Birim fiyat, toplam aktif öğrenci sayınızın düştüğü kademeden uygulanır.</p>
          </div>
          <DataTable
            caption="Öğrenci başı yıllık fiyat kademeleri"
            description="KDV hariç, yıllık"
            columns={[
              { key: "range", header: "Aktif öğrenci", render: (row) => row.range },
              { key: "unitPrice", header: "Öğrenci başı yıllık", align: "right", render: (row) => <strong>{row.unitPrice}</strong> },
            ]}
            getRowKey={(row) => row.key}
            rows={tierRows}
          />
          <ul className="next-pricing-included">
            <li><CheckCircle2 size={17} aria-hidden="true" /> <span>1–250 öğrenci kademesinde yıllık en az {formatTl(minimumAnnualPrice)} uygulanır.</span></li>
            {included.map((item) => <li key={item}><CheckCircle2 size={17} aria-hidden="true" /> <span>{item}</span></li>)}
          </ul>
        </section>

        <section id="hesaplayici" className="next-marketing-section" aria-labelledby="calculator-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Hesaplayıcı</p>
            <h2 id="calculator-title">Yıllık tutarı hesaplayın.</h2>
            <p>Hesap tarayıcınızda yapılır; girdiğiniz sayı kaydedilmez veya gönderilmez.</p>
          </div>
          <PriceCalculator />
        </section>

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
      </div>

      <footer className="next-marketing-footer">
        <div><Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link><p>Özel okullar için bütüncül öğrenci takibi.</p></div>
        <nav aria-label="Alt navigasyon"><Link href="/">Ana sayfa</Link><Link href="/iletisim">İletişim</Link><Link href="/login">Giriş</Link></nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
