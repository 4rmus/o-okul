import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BookOpenCheck,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileChartColumnIncreasing,
  GraduationCap,
  Landmark,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  ScanLine,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref } from "../src/brand.js";

const proofPoints = [
  "TXT / DAT optik işleme",
  "Rapor ve karne üretimi",
  "Rol bazlı kullanıcı portalları",
  "Tek ve çok şubeli kurum yapısı",
];

const outcomes = [
  {
    icon: Building2,
    eyebrow: "Kurum operasyonu",
    title: "Dağınık veriyi tek kurum kaydında birleştirin.",
    description:
      "Öğrenci, veli, öğretmen, sınıf, kampüs ve program bilgisi aynı yapı içinde güncel kalsın.",
    items: ["Kişi ve rol yönetimi", "Sınıf, seviye ve kampüs", "Program, etüt ve günlük yoklama"],
  },
  {
    icon: ScanLine,
    eyebrow: "Sınav ve raporlama",
    title: "Optik veriyi izlenebilir bir rapor akışına dönüştürün.",
    description:
      "Cevap anahtarı, optik dosya, değerlendirme ve karne aynı sınav bağlamında ilerlesin.",
    items: ["TXT / DAT optik aktarımı", "Karantina ve veri kontrolü", "Başarı, net ve kazanım görünümü"],
  },
  {
    icon: Users,
    eyebrow: "Portallar",
    title: "Her kullanıcıya ihtiyacı olan görünümü sunun.",
    description:
      "Kurum ekibi, öğretmen, öğrenci ve veli aynı verinin kendi yetki kapsamındaki bölümünü kullansın.",
    items: ["Öğretmen çalışma alanı", "Öğrenci gelişim görünümü", "Veli takip ve ödeme görünümü"],
  },
];

const capabilities = [
  {
    icon: Layers3,
    title: "Kurum yönetimi",
    description: "Kurulumdan kampüs ve sınıf yapısına kadar kurumun operasyon temelini tek yerde yönetin.",
  },
  {
    icon: ClipboardCheck,
    title: "Günlük eğitim akışı",
    description: "Ders programı, etüt, ödev ve devamsızlık süreçlerini aynı öğrenci kaydıyla ilişkilendirin.",
  },
  {
    icon: FileChartColumnIncreasing,
    title: "Sınav ve karne",
    description: "Optik veriden başarı yüzdesine, öğrenci raporundan karneye kadar bağlı bir akış kurun.",
  },
  {
    icon: MessageSquareText,
    title: "Duyuru ve destek",
    description: "Duyuruları doğru role ulaştırın; destek taleplerini kurum bağlamında takip edin.",
  },
  {
    icon: Landmark,
    title: "Ödeme planı takibi",
    description: "Taksit planlarını ve ödeme durumunu öğrenci ve veli ilişkisi içinde düzenli izleyin.",
  },
  {
    icon: BarChart3,
    title: "Karar görünümü",
    description: "Sınıf, sınav ve öğrenci gelişimini ortak göstergelerle karşılaştırın.",
  },
];

const roleExperiences = [
  {
    icon: Building2,
    label: "Kurum yöneticisi",
    title: "Operasyonun tamamını görür.",
    description: "Kişilerden sınavlara, devamsızlıktan ödeme planlarına kadar kurum işleyişini yönetir.",
  },
  {
    icon: UserRoundCheck,
    label: "Öğretmen",
    title: "Sınıfına odaklanır.",
    description: "Ders akışı, ödev, sınav ve öğrenci takibini kendi görev kapsamından yürütür.",
  },
  {
    icon: GraduationCap,
    label: "Öğrenci",
    title: "Gelişimini takip eder.",
    description: "Program, ödev, duyuru ve raporlarına tek kişisel çalışma alanından ulaşır.",
  },
  {
    icon: Users,
    label: "Veli",
    title: "Bağlı öğrenciyi izler.",
    description: "İzinli rapor, devamsızlık, duyuru ve ödeme planı bilgilerini düzenli görür.",
  },
];

const securityPoints = [
  {
    icon: LockKeyhole,
    title: "Kurum bazlı veri ayrımı",
    description: "Her kurumun verisi kendi kurum bağlamında işlenir ve erişim sınırlarıyla korunur.",
  },
  {
    icon: ShieldCheck,
    title: "Rol ve yetki kapsamı",
    description: "Kullanıcılar yalnız görevleri ve ilişkileri için izin verilen ekran ve kayıtlara ulaşır.",
  },
  {
    icon: BookOpenCheck,
    title: "Denetim izi",
    description: "Kritik işlemler izlenebilir kayıtlarla desteklenir.",
  },
];

const steps = [
  {
    number: "01",
    title: "Kurum yapısını oluşturun",
    description: "Kampüs, sınıf, dönem, kişi ve rol yapılarını mevcut işleyişinize göre tanımlayın.",
  },
  {
    number: "02",
    title: "Günlük akışı yürütün",
    description: "Program, ödev, yoklama, duyuru ve ödeme planlarını aynı kurum bağlamında yönetin.",
  },
  {
    number: "03",
    title: "Sınav verisini işleyin",
    description: "Optik dosyaları kontrol ederek içeri alın, cevap anahtarını uygulayın ve sonuçları üretin.",
  },
  {
    number: "04",
    title: "Raporları paylaşın",
    description: "Karne ve gelişim sonuçlarını yetkili kurum, öğretmen, öğrenci ve veli görünümlerine taşıyın.",
  },
];

const faqs = [
  {
    question: "o-okul hangi kurumlar için uygundur?",
    answer:
      "Tek veya çok şubeli dershaneler ve özel öğretim kurumları için tasarlanmıştır. Kurum, öğretmen, öğrenci ve veli süreçlerini aynı operasyon yapısında birleştirir.",
  },
  {
    question: "Demo görüşmesinde hangi akışlar gösterilir?",
    answer:
      "Kurum yapınıza göre kurulum, öğrenci takibi, günlük yoklama, optik sınav, rapor/karne, rol bazlı portallar ve ödeme planı takibi gösterilebilir.",
  },
  {
    question: "Hangi optik dosya akışları desteklenir?",
    answer:
      "TXT ve DAT tabanlı optik veriler cevap anahtarı, veri kontrolü, değerlendirme ve rapor üretimi adımlarıyla işlenir. Kurumunuzun örnek dosyası demo sürecinde ayrıca değerlendirilir.",
  },
  {
    question: "Öğretmen, öğrenci ve veli aynı bilgileri mi görür?",
    answer:
      "Hayır. Her kullanıcı kendi rolü, kurum kapsamı ve öğrenci ilişkisine göre izin verilen görünümle çalışır.",
  },
  {
    question: "Ödeme modülü online tahsilat yapar mı?",
    answer:
      "Mevcut kapsam ödeme planı ve taksit durumunun takibidir. Online tahsilat, fatura ve makbuz entegrasyonu demo kapsamına dahil değildir.",
  },
];

export default function HomePage() {
  return (
    <main className="next-marketing">
      <a className="next-marketing-skip" href="#main-content">
        İçeriğe geç
      </a>

      <header className="next-marketing-header">
        <nav className="next-marketing-nav" aria-label="Ana navigasyon">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <div className="next-marketing-nav__links">
            <a href="#platform">Platform</a>
            <a href="#raporlama">Sınav ve rapor</a>
            <a href="#roller">Portallar</a>
            <a href="#guven">Güven</a>
            <a href="#sss">SSS</a>
          </div>
          <div className="next-marketing-nav__actions">
            <Link className="next-marketing-login" href="/login">
              Giriş
            </Link>
            <a className="uh-button uh-button--primary uh-button--md" href={demoRequestHref} title="Demo iste">
              Demo iste
            </a>
          </div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-hero" aria-labelledby="home-title">
          <div className="next-marketing-hero__copy">
            <p className="next-marketing-eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              Tek ve çok şubeli dershaneler için
            </p>
            <h1 id="home-title">
              Optikten karneye, <span>eğitim operasyonunuz tek akışta.</span>
            </h1>
            <p className="next-marketing-hero__lead">
              Öğrenci, sınıf, günlük yoklama, sınav, rapor, ödeme ve duyuru süreçlerini aynı kurum
              bağlamında yönetin. Her kullanıcı yalnız yetkili olduğu bilgiyle çalışsın.
            </p>
            <div className="next-marketing-actions">
              <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="Demo iste">
                <span>Kurumunuza özel demo isteyin</span>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="next-marketing-text-link" href="#platform">
                Ürün akışını inceleyin
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="next-marketing-hero__note">
              <CheckCircle2 size={17} aria-hidden="true" />
              Demo, kurumunuzun gerçek işleyişi üzerinden planlanır.
            </p>
          </div>

          <figure className="next-marketing-product">
            <div className="next-marketing-product__chrome" aria-hidden="true">
              <span />
              <span />
              <span />
              <strong>Kurum operasyon merkezi</strong>
            </div>
            <picture>
              <source srcSet="/images/landing-hero-education-ops.webp" type="image/webp" />
              <img
                className="next-marketing-product__image"
                src="/images/landing-hero-education-ops.png"
                width={1440}
                height={810}
                alt="Örnek kurum panelinde öğrenci, sınav ve operasyon göstergeleri"
                decoding="async"
                fetchPriority="high"
                loading="eager"
              />
            </picture>
            <figcaption>Örnek ürün görünümü</figcaption>
            <div className="next-marketing-product__signal next-marketing-product__signal--top" aria-hidden="true">
              <ScanLine size={18} />
              <span>
                <small>Sınav akışı</small>
                Optikten rapora bağlı süreç
              </span>
            </div>
            <div className="next-marketing-product__signal next-marketing-product__signal--bottom" aria-hidden="true">
              <BellRing size={18} />
              <span>
                <small>Ortak veri</small>
                Kurumdan portallara kontrollü paylaşım
              </span>
            </div>
          </figure>
        </section>

        <section className="next-marketing-proof" aria-label="Platform kapsamı">
          {proofPoints.map((point) => (
            <div key={point}>
              <Check size={16} aria-hidden="true" />
              <span>{point}</span>
            </div>
          ))}
        </section>

        <section id="platform" className="next-marketing-section" aria-labelledby="outcomes-title">
          <div className="next-marketing-section__header next-marketing-section__header--split">
            <div>
              <span className="next-marketing-kicker">Tek operasyon kaynağı</span>
              <h2 id="outcomes-title">Dağınık süreçleri ortak ve izlenebilir bir akışa taşıyın.</h2>
            </div>
            <p>
              E-tablolar, optik dosyalar, mesajlar ve ayrı paneller arasında kaybolan bilgiyi aynı kurum
              modeli içinde bir araya getirin.
            </p>
          </div>
          <div className="next-marketing-outcome-grid">
            {outcomes.map((outcome) => {
              const Icon = outcome.icon;
              return (
                <article className="next-marketing-outcome-card" key={outcome.title}>
                  <div className="next-marketing-icon">
                    <Icon size={23} aria-hidden="true" />
                  </div>
                  <span>{outcome.eyebrow}</span>
                  <h3>{outcome.title}</h3>
                  <p>{outcome.description}</p>
                  <ul>
                    {outcome.items.map((item) => (
                      <li key={item}>
                        <Check size={15} aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>

        <section className="next-marketing-showcase" aria-labelledby="capabilities-title">
          <div className="next-marketing-section next-marketing-section--flush">
            <div className="next-marketing-section__header">
              <span className="next-marketing-kicker">Birbiriyle çalışan modüller</span>
              <h2 id="capabilities-title">Kurumun günlük işi ile eğitim sonucunu aynı yerde buluşturun.</h2>
              <p>
                Her modül ayrı bir veri adası oluşturmaz; öğrenci ve kurum bağlamı süreç boyunca korunur.
              </p>
            </div>
            <div className="next-marketing-capability-grid">
              {capabilities.map((capability) => {
                const Icon = capability.icon;
                return (
                  <article key={capability.title}>
                    <Icon size={21} aria-hidden="true" />
                    <div>
                      <h3>{capability.title}</h3>
                      <p>{capability.description}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="raporlama" className="next-marketing-section next-marketing-reporting" aria-labelledby="reporting-title">
          <div className="next-marketing-reporting__visual">
            <div className="next-marketing-reporting__header">
              <div>
                <small>Örnek rapor görünümü</small>
                <strong>Sınav gelişim özeti</strong>
              </div>
              <span>Başarı %</span>
            </div>
            <div className="next-marketing-reporting__chart" aria-hidden="true">
              <span style={{ height: "46%" }} />
              <span style={{ height: "58%" }} />
              <span style={{ height: "54%" }} />
              <span style={{ height: "72%" }} />
              <span style={{ height: "81%" }} />
              <span style={{ height: "76%" }} />
            </div>
            <div className="next-marketing-reporting__summary">
              <div>
                <small>Ana karşılaştırma</small>
                <strong>Başarı yüzdesi</strong>
              </div>
              <div>
                <small>Bağlam</small>
                <strong>Net / soru</strong>
              </div>
              <div>
                <small>Detay</small>
                <strong>Kazanım analizi</strong>
              </div>
            </div>
          </div>
          <div className="next-marketing-reporting__copy">
            <span className="next-marketing-kicker">Sınav ve raporlama</span>
            <h2 id="reporting-title">Farklı sınavları ortak bir başarı metriğiyle karşılaştırın.</h2>
            <p>
              Başarı yüzdesini ana gösterge olarak izleyin; net ve soru sayısını bağlam olarak koruyun.
              Öğrenci, sınıf ve sınav görünümünden karne detayına ilerleyin.
            </p>
            <ul>
              <li>
                <CheckCircle2 size={18} aria-hidden="true" />
                Optik dosyadan rapora bağlı veri akışı
              </li>
              <li>
                <CheckCircle2 size={18} aria-hidden="true" />
                Öğrenci, sınıf ve sınav bazlı karşılaştırma
              </li>
              <li>
                <CheckCircle2 size={18} aria-hidden="true" />
                Portal ve karne görünümüne kontrollü paylaşım
              </li>
            </ul>
          </div>
        </section>

        <section id="roller" className="next-marketing-section" aria-labelledby="roles-title">
          <div className="next-marketing-section__header next-marketing-section__header--center">
            <span className="next-marketing-kicker">Rol bazlı deneyim</span>
            <h2 id="roles-title">Kurum için tek merkez, her kullanıcı için doğru görünüm.</h2>
            <p>Ortak veri, role göre sadeleşen çalışma alanlarıyla doğru kişiye doğru kapsamda ulaşır.</p>
          </div>
          <div className="next-marketing-role-grid">
            {roleExperiences.map((role, index) => {
              const Icon = role.icon;
              return (
                <article className={index === 0 ? "next-marketing-role-card next-marketing-role-card--primary" : "next-marketing-role-card"} key={role.label}>
                  <div>
                    <Icon size={22} aria-hidden="true" />
                    <span>{role.label}</span>
                  </div>
                  <h3>{role.title}</h3>
                  <p>{role.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section id="guven" className="next-marketing-trust" aria-labelledby="trust-title">
          <div className="next-marketing-trust__intro">
            <span className="next-marketing-kicker">Güven tasarımın parçası</span>
            <h2 id="trust-title">Erişimi rol ve kurum kapsamıyla sınırlandıran yapı.</h2>
            <p>
              Eğitim verisi tek yerde toplanırken herkesin her şeyi görmesi gerekmez. Yetki sınırları ve
              izlenebilirlik ürün akışının temelinde yer alır.
            </p>
          </div>
          <div className="next-marketing-trust__list">
            {securityPoints.map((point) => {
              const Icon = point.icon;
              return (
                <article key={point.title}>
                  <Icon size={20} aria-hidden="true" />
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="next-marketing-section" aria-labelledby="steps-title">
          <div className="next-marketing-section__header">
            <span className="next-marketing-kicker">Nasıl çalışır?</span>
            <h2 id="steps-title">Kurulumdan rapora dört net adım.</h2>
          </div>
          <div className="next-marketing-steps">
            {steps.map((step) => (
              <article key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="next-marketing-cta" aria-labelledby="demo-title">
          <div>
            <span className="next-marketing-kicker">Kurumunuza özel ürün turu</span>
            <h2 id="demo-title">Sınav, takip ve raporlama akışınızı birlikte değerlendirelim.</h2>
            <p>
              Demo görüşmesinde kurum yapınızı dinleyip kurulumdan optik sınava, rapordan rol bazlı
              portallara kadar ilgili akışı kurum senaryonuz üzerinden gösterelim.
            </p>
          </div>
          <div className="next-marketing-cta__actions">
            <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="Demo iste">
              <span>Demo talep edin</span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <Link className="next-marketing-text-link" href="/login">
              Mevcut kullanıcı girişi
            </Link>
          </div>
        </section>

        <section id="sss" className="next-marketing-section next-marketing-faq" aria-labelledby="faq-title">
          <div className="next-marketing-section__header">
            <span className="next-marketing-kicker">Sık sorulan sorular</span>
            <h2 id="faq-title">Demo öncesinde merak edilenler.</h2>
          </div>
          <div className="next-marketing-faq__list">
            {faqs.map((faq) => (
              <details key={faq.question}>
                <summary>
                  <span>{faq.question}</span>
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      <footer className="next-marketing-footer">
        <div>
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <p>Dershaneler ve özel öğretim kurumları için eğitim operasyon platformu.</p>
        </div>
        <nav aria-label="Alt navigasyon">
          <a href="#platform">Platform</a>
          <a href="#raporlama">Sınav ve rapor</a>
          <a href="#roller">Portallar</a>
          <a href="#guven">Güven</a>
          <Link href="/login">Giriş</Link>
        </nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
