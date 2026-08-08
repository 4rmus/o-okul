import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  FileChartColumnIncreasing,
  GraduationCap,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  UserRoundCheck,
  WalletCards,
} from "lucide-react";
import { appBrand, appBrandHomeAriaLabel } from "../src/brand.js";

const optikSteps = [
  ["01", "Dosyayı alın", "TXT veya DAT optik verisini sınav kaydına aktarın."],
  ["02", "Eşleşmeleri kontrol edin", "Öğrenci, kitapçık ve cevap anahtarı eşleşmelerini gözden geçirin."],
  ["03", "Sonucu doğrulayın", "Eksik veya hatalı satırları sonuç yayımlanmadan önce inceleyin."],
  ["04", "Raporu oluşturun", "Başarı % karşılaştırmasını Net ve Soru bilgileriyle değerlendirin."],
  ["05", "Takibi planlayın", "Öğrenciye verilecek akademik desteği gelişim geçmişi üzerinden izleyin."],
] as const;

const roles = [
  {
    icon: Building2,
    label: "Kurum yöneticisi",
    title: "Süreci ve genel görünümü takip eder.",
    description: "Aktarım kontrolünü, sınıf sonuçlarını ve günlük kurum işlerini aynı çalışma düzeninde görür.",
  },
  {
    icon: UserRoundCheck,
    label: "Öğretmen",
    title: "Desteğe ihtiyaç duyan öğrenciyi belirler.",
    description: "Sınıf ve öğrenci sonuçlarını karşılaştırır; sıradaki akademik adımı planlar.",
  },
  {
    icon: GraduationCap,
    label: "Öğrenci",
    title: "Kendi gelişimini anlaşılır biçimde görür.",
    description: "Başarı geçmişini, Net ve Soru bilgilerini ve geliştirmesi gereken alanları inceler.",
  },
] as const;

const operations = [
  {
    icon: BookOpenCheck,
    title: "Kurum operasyonu",
    description: "Öğrenci kayıtları, devam bilgisi ve öğretmen notlarını kurumun günlük işleyişi içinde takip edin.",
  },
  {
    icon: WalletCards,
    title: "Ödeme planı takibi",
    description: "Taksit planını ve ödeme durumunu kaydedin; online tahsilat, fatura ve makbuz kapsamı beklemeyin.",
  },
  {
    icon: MessageSquareText,
    title: "İletişim takibi",
    description: "Kurum içi iletişim kayıtlarını öğrencinin eğitim sürecinden koparmadan düzenleyin.",
  },
] as const;

const boundaries = [
  {
    icon: LockKeyhole,
    title: "Kurum kayıtları ayrıdır",
    description: "Her kurum yalnızca kendi öğrenci, çalışan ve sınav kayıtlarıyla çalışır.",
  },
  {
    icon: ShieldCheck,
    title: "Erişim göreve göre belirlenir",
    description: "Kullanıcılar yalnızca görevleri için izin verilen ekran ve bilgilere ulaşır.",
  },
  {
    icon: FileChartColumnIncreasing,
    title: "Rapor sürümü korunur",
    description: "Farklı soru sayılarını Başarı % ile karşılaştırırken Net ve Soru bilgisi raporda kalır.",
  },
] as const;

const faqs = [
  {
    question: "Hangi optik dosyalarla başlanabilir?",
    answer: "Demo hazırlığında kullandığınız TXT veya DAT dosya biçimini belirtmeniz yeterlidir. İlk e-postada gerçek öğrenci verisi ya da dosya göndermeyin.",
  },
  {
    question: "Sonuçlar doğrudan yayımlanır mı?",
    answer: "Hayır. Aktarılan satırlar, öğrenci ve cevap anahtarı eşleşmeleri kontrol edilir; sonuç bu incelemeden sonra rapora dönüştürülür.",
  },
  {
    question: "Başarı neden yüzdeyle karşılaştırılır?",
    answer: "Başarı %, soru sayıları farklı sınavları ortak bir ölçüde karşılaştırmayı sağlar. Net ve Soru bilgileri sonucu açıklamak için gösterilmeye devam eder.",
  },
  {
    question: "Ödeme özelliği online tahsilat yapar mı?",
    answer: "Mevcut kapsam ödeme planı ve taksit durumunun takibidir. Online tahsilat, fatura, makbuz ve ödeme sağlayıcısı entegrasyonu ürün vaadine dahil değildir.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="next-marketing">
      <a className="next-marketing-skip" href="#main-content">İçeriğe geç</a>

      <header className="next-marketing-header">
        <nav className="next-marketing-nav" aria-label="Ana navigasyon">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <p className="next-marketing-nav__statement">Optik sınav raporlama ve kurum takibi.</p>
          <div className="next-marketing-nav__actions">
            <Link className="next-marketing-login" href="/login">Giriş yap</Link>
            <Link className="uh-button uh-button--primary uh-button--md" href="/iletisim#demo">Demo talep et</Link>
          </div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-hero" aria-labelledby="home-title">
          <div className="next-marketing-hero__copy">
            <p className="next-marketing-eyebrow">Optik sınavdan öğrenci takibine</p>
            <h1 id="home-title">Optik veriyi kontrol edin, rapora dönüştürün.</h1>
            <p className="next-marketing-hero__lead">
              Dershane ve özel öğretim kurumları için TXT/DAT yükleme, hatalı kayıtları ayırma,
              Başarı % odaklı rapor ve öğrenci takibi.
            </p>
            <div className="next-marketing-actions">
              <Link className="uh-button uh-button--primary uh-button--lg" href="/iletisim#demo">
                <span>Demo talep et</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a className="next-marketing-text-link" href="#optik-akis">
                Optikten rapora akışı gör
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="next-marketing-hero__note">
              <CheckCircle2 size={17} aria-hidden="true" />
              Demo talebinde gerçek öğrenci verisi veya optik dosya göndermeniz gerekmez.
            </p>
          </div>

          <section className="next-marketing-workflow" aria-label="Örnek optik işleme akışı">
            <header><span>Örnek çalışma akışı</span><strong>Dosyadan öğrenci takibine</strong></header>
            <ol>
              {optikSteps.map(([number, title, description], index) => (
                <li data-current={index === 1 ? "true" : undefined} key={number}>
                  <span>{number}</span>
                  <div><strong>{title}</strong><small>{description}</small></div>
                  <CheckCircle2 size={18} aria-hidden="true" />
                </li>
              ))}
            </ol>
          </section>
        </section>

        <section id="optik-akis" className="next-marketing-section" aria-labelledby="flow-title">
          <div className="next-marketing-section__header">
            <div><p className="next-marketing-kicker">Beş adımda kontrollü akış</p><h2 id="flow-title">Sonucu yayımlamadan önce veriyi görün ve doğrulayın.</h2></div>
            <p>Optik dosyanın alınmasından öğrenci takibine kadar her adım aynı sınav kaydı üzerinden ilerler.</p>
          </div>
          <div className="next-marketing-steps">
            {optikSteps.map(([number, title, description]) => (
              <article key={number}><span>{number}</span><h3>{title}</h3><p>{description}</p></article>
            ))}
          </div>
        </section>

        <section id="roller" className="next-marketing-section" aria-labelledby="roles-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Kimin için?</p>
            <h2 id="roles-title">Yönetici, öğretmen ve öğrenci aynı sonuca kendi işi kadar yaklaşır.</h2>
          </div>
          <div className="next-marketing-role-grid">
            {roles.map((role, index) => {
              const Icon = role.icon;
              return <article className={index === 0 ? "next-marketing-role-card next-marketing-role-card--primary" : "next-marketing-role-card"} key={role.label}>
                <div><Icon size={22} aria-hidden="true" /><span>{role.label}</span></div>
                <h3>{role.title}</h3><p>{role.description}</p>
              </article>;
            })}
          </div>
        </section>

        <section id="operasyon" className="next-marketing-section" aria-labelledby="operations-title">
          <div className="next-marketing-section__header">
            <p className="next-marketing-kicker">Sınavın çevresindeki işler</p>
            <h2 id="operations-title">Akademik takibi kurumun günlük işlerinden koparmayın.</h2>
          </div>
          <div className="next-marketing-outcome-grid">
            {operations.map((item) => {
              const Icon = item.icon;
              return <article className="next-marketing-outcome-card" key={item.title}>
                <div className="next-marketing-icon"><Icon size={23} aria-hidden="true" /></div>
                <h3>{item.title}</h3><p>{item.description}</p>
              </article>;
            })}
          </div>
        </section>

        <section id="sinirlar" className="next-marketing-trust" aria-labelledby="boundaries-title">
          <div className="next-marketing-trust__intro">
            <p className="next-marketing-kicker">Doğrulanabilir kapsam</p>
            <h2 id="boundaries-title">Ne sunduğumuzu ve nerede sınır koyduğumuzu açıkça anlatıyoruz.</h2>
            <p>Demo, mevcut ürün akışlarını kurumunuzun ihtiyacıyla karşılaştırır; sağlayıcı, resmî kurum veya üretim sonucu iddiası oluşturmaz.</p>
          </div>
          <div className="next-marketing-trust__list">
            {boundaries.map((item) => {
              const Icon = item.icon;
              return <article key={item.title}><Icon size={20} aria-hidden="true" /><div><h3>{item.title}</h3><p>{item.description}</p></div></article>;
            })}
          </div>
        </section>

        <section id="sss" className="next-marketing-section next-marketing-faq" aria-labelledby="faq-title">
          <div className="next-marketing-section__header"><p className="next-marketing-kicker">Sık sorulanlar</p><h2 id="faq-title">Demo öncesinde bilinmesi gerekenler.</h2></div>
          <div className="next-marketing-faq__list">
            {faqs.map((faq) => <details key={faq.question}><summary><span>{faq.question}</span><span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}
          </div>
        </section>

        <section className="next-marketing-cta" aria-labelledby="demo-title">
          <div><h2 id="demo-title">Kendi optik sınav akışınızı birlikte değerlendirelim.</h2><p>Kullandığınız dosya biçimini, kontrol adımlarını ve görmek istediğiniz raporları konuşalım. İlk talepte öğrenci verisi paylaşmayın.</p></div>
          <div className="next-marketing-cta__actions">
            <Link className="uh-button uh-button--primary uh-button--lg" href="/iletisim#demo"><span>Demo talep et</span><ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="next-marketing-text-link" href="/login">Mevcut kullanıcı girişi</Link>
          </div>
        </section>
      </div>

      <footer className="next-marketing-footer">
        <div><Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}><span className="next-brand-mark">{appBrand.mark}</span><span>{appBrand.name}</span></Link><p>Optik sınav raporlama ve kurum takibi.</p></div>
        <nav aria-label="Alt navigasyon"><a href="#optik-akis">Optik akış</a><a href="#roller">Kullanıcılar</a><a href="#operasyon">Kurum takibi</a><a href="#sinirlar">Kapsam</a><Link href="/iletisim">İletişim</Link><Link href="/iletisim#kvkk">KVKK başvurusu</Link><Link href="/login">Giriş</Link></nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
