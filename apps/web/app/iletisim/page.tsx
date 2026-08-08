import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref, platformSupportHref, privacyRequestHref } from "../../src/brand.js";
import { DemoActions } from "./demo-actions.js";

const preparation = [
  "Kullandığınız optik dosya biçimi: TXT veya DAT",
  "Sınav sonucunu yayımlamadan önce uyguladığınız kontrol adımları",
  "Görmek istediğiniz Başarı %, Net ve Soru raporları",
  "Kurum türü, kampüs sayısı ve yaklaşık öğrenci sayısı",
] as const;

export default function ContactPage() {
  return (
    <main className="next-marketing">
      <a className="next-marketing-skip" href="#main-content">İçeriğe geç</a>
      <header className="next-marketing-header">
        <nav className="next-marketing-nav" aria-label="İletişim navigasyonu">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link>
          <div className="next-marketing-nav__actions"><Link className="next-marketing-login" href="/login">Giriş yap</Link><Link className="next-marketing-text-link" href="/#optik-akis">Optik akışa dön</Link></div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section id="demo" className="next-marketing-section next-marketing-faq" aria-labelledby="contact-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Yönlendirmeli demo hazırlığı</p>
            <h1 id="contact-title">Demo görüşmesini kendi optik akışınıza göre hazırlayın.</h1>
            <p>Görüşme öncesinde aşağıdaki başlıkları düşünmeniz yeterli. Bu sayfa bilgi göndermez, kaydetmez veya ölçüm yapmaz.</p>
          </div>
          <div className="next-marketing-faq__list">
            <section aria-labelledby="preparation-title">
              <h2 id="preparation-title">Hazırlık listesi</h2>
              <ul>
                {preparation.map((item) => <li key={item}><CheckCircle2 size={17} aria-hidden="true" /> <span>{item}</span></li>)}
              </ul>
            </section>
            <section aria-labelledby="pii-title">
              <h2 id="pii-title"><ShieldCheck size={20} aria-hidden="true" /> Kişisel veri göndermeyin</h2>
              <p>İlk e-postaya gerçek öğrenci adı, TCKN, telefon, e-posta, optik dosya veya başka kişisel veri eklemeyin. Örnekleri görüşmede güvenli paylaşım yöntemi netleştirildikten sonra değerlendirin.</p>
            </section>
            <section aria-labelledby="email-title">
              <h2 id="email-title">Demo talebini hazırlayın</h2>
              <p>Hazır taslağı e-posta uygulamanızda açabilir veya adresi kopyalayabilirsiniz.</p>
              <DemoActions email={appBrand.demoEmail} mailtoHref={demoRequestHref} />
            </section>
          </div>
        </section>

        <section className="next-marketing-section next-marketing-faq" aria-labelledby="other-contact-title">
          <div className="next-marketing-section__header"><p className="next-marketing-kicker">Diğer iletişim yolları</p><h2 id="other-contact-title">Doğru konu için doğru adresi kullanın.</h2></div>
          <div className="next-marketing-faq__list">
            <section id="destek" aria-labelledby="support-title"><h3 id="support-title">Platform desteği</h3><p>Giriş, aktivasyon veya platform kullanımıyla ilgili sorunlar için.</p><a aria-label="O-Okul desteğine e-posta gönder" className="next-marketing-text-link" href={platformSupportHref}>{appBrand.supportEmail}</a></section>
            <section id="kvkk" aria-labelledby="privacy-title"><h3 id="privacy-title">KVKK başvurusu</h3><p>Kişisel verilerin işlenmesine ilişkin başvurular için.</p><a aria-label="KVKK başvurusu gönder" className="next-marketing-text-link" href={privacyRequestHref}>{appBrand.privacyEmail}</a></section>
          </div>
        </section>
      </div>

      <footer className="next-marketing-footer">
        <div><Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link><p>Optik sınav raporlama ve kurum takibi.</p></div>
        <nav aria-label="Alt navigasyon"><Link href="/">Ana sayfa</Link><Link href="/login">Giriş</Link></nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
