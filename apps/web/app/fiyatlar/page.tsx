import Link from "next/link";
import { AppearanceSelect } from "../../src/appearance-select.js";
import { ArrowRight, BarChart3, BookOpen, CalendarDays, Check, ScanLine, ShieldCheck, Wallet } from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, trialOfferPublished } from "../../src/brand.js";
import { PriceCalculator } from "./price-calculator.js";
import { estimateAnnualPrice, formatCount, formatTl, minimumBilledStudents, pricingTiers, quoteFromStudents } from "./pricing.js";

export const metadata = {
  title: `Fiyatlar | ${appBrand.name}`,
  description: "Aktif öğrenci sayısına göre yıllık, kademeli ve KDV hariç fiyat; kurulum ücreti yok, tüm modüller dahil.",
};

const exampleStudents = 1000;
const exampleEstimate = estimateAnnualPrice(exampleStudents);
const exampleText = exampleEstimate.kind === "price"
  ? `${exampleEstimate.lines.map((line) => `${line.students} × ${formatTl(line.unitPrice)}`).join(" + ")} = ${formatTl(exampleEstimate.total)}`
  : "";

const highestUnitPrice = pricingTiers[0].unitPrice;
const lowestUnitPrice = pricingTiers[pricingTiers.length - 1]!.unitPrice;

const facts = ["Kurulum ücreti yok", "Tüm modüller dahil", "Çalışan hesapları ücretsiz"] as const;

const features = [
  { icon: BookOpen, title: "Öğrenci kaydı", text: "Deneme sonuçları, okul notu, devamsızlık ve ödev aynı öğrenci kaydında." },
  { icon: CalendarDays, title: "Kurum operasyonu", text: "Kayıt, akademik yapı, program ve devamsızlık işlerini tek yerden takip edin." },
  { icon: Wallet, title: "Finans takibi", text: "Ödeme planı, alacak ve taksitleri takip edin." },
  { icon: ShieldCheck, title: "Rol tabanlı erişim", text: "Öğretmen atanmış kapsamını, öğrenci kendi bilgilerini görür." },
  { icon: BarChart3, title: "Deneme analizi", text: "Başarı %, Net/Soru ve deneme puanıyla gelişimi inceleyin." },
  { icon: ScanLine, title: "Optik okuma ve karne", text: "Optik TXT/DAT dosyasından rapor ve karne sürecini tek akışta yönetin." },
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
            <AppearanceSelect />
            <Link className="next-marketing-login" href="/login">Giriş yap</Link>
            <Link className="uh-button uh-button--primary uh-button--md" href="/iletisim#demo">Demo talep et</Link>
          </div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-section next-pricing" aria-labelledby="pricing-title">
          <div className="next-pricing__head">
            <p className="next-marketing-kicker">Fiyatlar</p>
            <h1 id="pricing-title">Aktif öğrenci sayınıza göre yıllık fiyat.</h1>
            <p className="next-pricing__lead">Öğrenci başı yıllık {formatTl(lowestUnitPrice)}–{formatTl(highestUnitPrice)}, KDV hariç.</p>
            <ul className="next-pricing__facts" aria-label="Fiyata dahil olanlar">
              {facts.map((fact) => (
                <li key={fact}><Check size={16} aria-hidden="true" />{fact}</li>
              ))}
            </ul>
          </div>
          <PriceCalculator />
        </section>

        <section className="next-marketing-section next-marketing-section--flush next-pricing-tiers" aria-labelledby="tiers-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Nasıl hesaplanır?</p>
            <h2 id="tiers-title">Fiyat kademeleri</h2>
            <p>Her fiyat yalnız kendi aralığındaki öğrencilere uygulanır; tutarlar toplanır.</p>
            <ul className="next-pricing-notes">
              <li>Örnek, {formatCount(exampleStudents)} öğrenci: {exampleText}.</li>
              <li>En küçük paket {minimumBilledStudents} öğrencidir; daha az öğrencisi olan kurum {minimumBilledStudents} öğrenci üzerinden öder.</li>
              <li>Ödeme yıllıktır; aylık ödeme seçeneği yoktur.</li>
            </ul>
          </div>
          <table className="next-pricing-table">
            <caption className="uh-visually-hidden">Aktif öğrenci aralığına göre öğrenci başı yıllık fiyat, KDV hariç</caption>
            <thead>
              <tr><th scope="col">Aktif öğrenci</th><th scope="col">Öğrenci başı yıllık</th></tr>
            </thead>
            <tbody>
              {pricingTiers.map((tier) => (
                <tr key={tier.min}><th scope="row">{formatCount(tier.min)}–{formatCount(tier.max)}</th><td>{formatTl(tier.unitPrice)}</td></tr>
              ))}
              <tr><th scope="row">{formatCount(quoteFromStudents)} ve üzeri</th><td>Teklif</td></tr>
            </tbody>
          </table>
        </section>

        <section className="next-marketing-section next-marketing-section--flush" aria-labelledby="features-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Kapsam</p>
            <h2 id="features-title">Tüm modüller fiyata dahil.</h2>
            <p>Fiyat yalnız öğrenci sayısıyla değişir; her kurum aynı modülleri kullanır.</p>
          </div>
          <ul className="next-pricing-features" aria-label="Fiyata dahil modüller">
            {features.map((feature) => (
              <li key={feature.title}>
                <feature.icon size={22} aria-hidden="true" />
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
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
              <p>{formatCount(quoteFromStudents)} ve üzeri öğrencisi olan kurumlara özel teklif hazırlarız. İlk talepte öğrenci verisi paylaşmayın.</p>
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
