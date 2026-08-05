import Link from "next/link";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref, platformSupportHref, privacyRequestHref } from "../../src/brand.js";

export default function ContactPage() {
  return (
    <main className="next-marketing">
      <a className="next-marketing-skip" href="#main-content">İçeriğe geç</a>
      <header className="next-marketing-header">
        <nav className="next-marketing-nav" aria-label="İletişim navigasyonu">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <Link className="next-marketing-login" href="/login">Giriş</Link>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-section next-marketing-faq" aria-labelledby="contact-title">
          <div className="next-marketing-section__header">
            <p className="next-section-eyebrow">İletişim</p>
            <h1 id="contact-title">İletişim ve Destek</h1>
            <p>Kurum içi destek kayıtları kurum ekibiniz tarafından, o-okul platform soruları ise destek ekibimiz tarafından takip edilir.</p>
          </div>
          <div className="next-marketing-faq__list">
            <section aria-labelledby="demo-contact-title">
              <h2 id="demo-contact-title">Demo talebi</h2>
              <p>Kurumunuz için ürün tanıtımı ve uygunluk görüşmesi planlayın.</p>
              <a aria-label="Demo talebi için e-posta gönder" className="next-marketing-text-link" href={demoRequestHref}>{appBrand.demoEmail}</a>
            </section>
            <section id="destek" aria-labelledby="support-contact-title">
              <h2 id="support-contact-title">o-okul platform desteği</h2>
              <p>Giriş, aktivasyon veya platform kullanımıyla ilgili teknik sorunları bildirin.</p>
              <a aria-label="o-okul desteğine e-posta gönder" className="next-marketing-text-link" href={platformSupportHref}>{appBrand.supportEmail}</a>
            </section>
            <section id="kvkk" aria-labelledby="privacy-contact-title">
              <h2 id="privacy-contact-title">KVKK başvurusu</h2>
              <p>Kişisel verilerin işlenmesine ilişkin başvurularınızı ayrı kanaldan iletin.</p>
              <a aria-label="KVKK başvurusu gönder" className="next-marketing-text-link" href={privacyRequestHref}>{appBrand.privacyEmail}</a>
            </section>
          </div>
          <p className="next-marketing-hero__note">
            İlk e-postada öğrenci bilgisi, TCKN, parola, aktivasyon kodu veya dosya göndermeyin.
          </p>
        </section>
      </div>

      <footer className="next-marketing-footer">
        <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
          <span className="next-brand-mark">{appBrand.mark}</span>
          <span>{appBrand.name}</span>
        </Link>
        <nav aria-label="Alt navigasyon">
          <Link href="/">Ana sayfa</Link>
          <Link href="/login">Giriş</Link>
        </nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
