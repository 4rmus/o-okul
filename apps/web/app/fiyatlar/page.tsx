import Link from "next/link";
import { ArrowRight, BarChart3, BookOpen, CalendarDays, ScanLine, ShieldCheck, Wallet } from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, trialOfferPublished } from "../../src/brand.js";
import { PriceCalculator } from "./price-calculator.js";
import { estimateAnnualPrice, formatAverageTl, formatCount, formatTl, minimumBilledStudents, pricingTiers, quoteFromStudents } from "./pricing.js";

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

// Beş profil kademe üst sınırlarıdır; tutar pricing.ts'ten türetilir, her pakette tüm modüller vardır.
const planProfiles = [
  { students: 100, name: "Başlangıç", note: "En küçük paket" },
  { students: 250, name: "Tek kampüs", note: "Tek binalı okul" },
  { students: 500, name: "Büyüyen okul", note: "Birkaç kademe bir arada" },
  { students: 1000, name: "Orta ölçek", note: "Anaokulundan liseye" },
  { students: 2000, name: "Kampüs grubu", note: "Çok kampüslü kurum" },
] as const;

const plans = planProfiles.map((profile) => {
  const estimate = estimateAnnualPrice(profile.students);
  const total = estimate.kind === "price" ? estimate.total : 0;
  return { ...profile, total, average: total / profile.students };
});

const features = [
  { icon: ScanLine, title: "Optik okuma ve karne", text: "Optik TXT/DAT dosyasından rapor ve karne sürecini tek akışta yönetin." },
  { icon: BarChart3, title: "Deneme analizi", text: "Başarı %, Net/Soru ve deneme puanıyla gelişimi inceleyin." },
  { icon: CalendarDays, title: "Kurum operasyonu", text: "Kayıt, akademik yapı, program ve devamsızlık işlerini tek yerden takip edin." },
  { icon: BookOpen, title: "Okul notu ve ödev", text: "Deneme sonuçları, okul notu, devamsızlık ve ödev aynı öğrenci kaydında." },
  { icon: Wallet, title: "Finans takibi", text: "Ödeme planı, alacak ve taksitleri takip edin." },
  { icon: ShieldCheck, title: "Rol tabanlı erişim", text: "Öğretmen atanmış kapsamını, öğrenci kendi bilgilerini görür." },
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
        <section className="next-marketing-section next-pricing" aria-labelledby="pricing-title">
          <div className="next-pricing__head">
            <p className="next-marketing-kicker">Fiyatlar</p>
            <h1 id="pricing-title">Aktif öğrenci sayınıza göre yıllık fiyat.</h1>
            <p className="next-pricing__lead">
              Öğrenci başı yıllık {formatTl(lowestUnitPrice)}–{formatTl(highestUnitPrice)}, KDV hariç. Kurulum ücreti yok, tüm modüller her pakette dahil;
              çalışan hesapları ücretli değildir.
            </p>
          </div>

          <div className="next-pricing-plans" role="region" aria-label="Paketler">
            <ul className="next-pricing-plans__list">
              {plans.map((plan) => (
                <li key={plan.students} className="next-pricing-plan">
                  <div className="next-pricing-plan__head">
                    <h2>{plan.name}</h2>
                    <p>{plan.note}</p>
                  </div>
                  <p className="next-pricing-plan__students">{formatCount(plan.students)} aktif öğrenciye kadar</p>
                  <p className="next-pricing-plan__price">
                    <strong>{formatAverageTl(plan.average)}</strong>
                    <span>öğrenci / yıl</span>
                  </p>
                  <p className="next-pricing-plan__total">Yıllık {formatTl(plan.total)}</p>
                  <Link className="uh-button uh-button--secondary uh-button--md" href="/iletisim#demo">Demo talep et</Link>
                </li>
              ))}
            </ul>
            <div className="next-pricing-plans__foot">
              <p>
                Kademeli hesap: her öğrenci kendi kademesinin fiyatını öder, kademe tutarları toplanır
                ({pricingTiers.map((tier) => `${formatCount(tier.min)}–${formatCount(tier.max)}: ${formatTl(tier.unitPrice)}`).join(", ")}).
                Örnek, {formatCount(exampleStudents)} öğrenci: {exampleText}.
              </p>
              <p>
                En küçük paket {minimumBilledStudents} öğrencidir; daha az öğrencisi olan kurum {minimumBilledStudents} öğrenci üzerinden öder.
                Fiyatlar yıllık ve KDV hariçtir; aylık ödeme seçeneği yoktur. {formatCount(quoteFromStudents)} ve üzeri öğrenci için özel teklif hazırlarız.
              </p>
              <a className="next-marketing-text-link" href="#hesaplayici">Kendi sayınızla hesaplayın<ArrowRight size={16} aria-hidden="true" /></a>
            </div>
          </div>
        </section>

        <section className="next-marketing-section next-marketing-section--flush" aria-labelledby="features-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Her pakette</p>
            <h2 id="features-title">Tüm modüller, her paket büyüklüğünde.</h2>
            <p>Paketler yalnız öğrenci sayısıyla ayrılır; kapsam aynıdır.</p>
          </div>
          <ul className="next-pricing-features" aria-label="Her pakette bulunan modüller">
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

        <section className="next-marketing-section" aria-labelledby="calculator-title">
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
              <p>Demo görüşmesinde öğrenci sayınızı ve kademelerinizi konuşalım; {formatCount(quoteFromStudents)} ve üzeri öğrencisi olan kurumlara özel fiyat teklifi hazırlarız. İlk talepte öğrenci verisi paylaşmayın.</p>
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
