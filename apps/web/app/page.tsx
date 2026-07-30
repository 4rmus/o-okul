import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  Check,
  CheckCircle2,
  FileChartColumnIncreasing,
  GraduationCap,
  LockKeyhole,
  ScanLine,
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref } from "../src/brand.js";

const proofPoints = [
  "Tek ve çok şubeli kurum yönetimi",
  "Günlük sınıf yoklaması",
  "Optik sınav ve karne",
  "Öğretmen, öğrenci ve veli ekranları",
];

const outcomes = [
  {
    icon: Building2,
    eyebrow: "Günlük kurum işleri",
    title: "Öğrenci ve sınıf bilgilerini tek yerde güncel tutun.",
    description:
      "Kayıt, sınıf, program, yoklama ve ödeme planı aynı öğrenci üzerinden ilerlesin.",
    items: [
      "Kişi, sınıf ve kampüs kayıtları",
      "Ders programı, etüt ve günlük yoklama",
      "Ödeme planı ve taksit durumu",
    ],
  },
  {
    icon: ScanLine,
    eyebrow: "Sınav ve raporlama",
    title: "Optik sınavı kontrollü biçimde rapora dönüştürün.",
    description:
      "Cevap anahtarını ve desteklenen TXT / DAT dosyasını aynı sınav için işleyin; eşleşmeyen kayıtları sonuçtan önce inceleyin.",
    items: [
      "Desteklenen TXT / DAT formatları",
      "Eşleşmeyen kayıtları inceleme",
      "Başarı %, net ve kazanım görünümü",
    ],
  },
  {
    icon: Users,
    eyebrow: "Kullanıcı ekranları",
    title: "Sonuçları doğru kişilere açın.",
    description:
      "Kurum yöneticisi bütünü yönetsin; öğretmen, öğrenci ve veli yalnızca kendilerine açık bilgileri görsün.",
    items: ["Öğretmen sınıf görünümü", "Öğrenci sonuç ekranı", "Veli takip ve ödeme görünümü"],
  },
];

const roleExperiences = [
  {
    icon: Building2,
    label: "Kurum yöneticisi",
    title: "Kurumun tamamını yönetir.",
    description: "Kişileri, sınıfları, sınavları, yoklamayı ve ödeme planlarını tek yerden takip eder.",
  },
  {
    icon: UserRoundCheck,
    label: "Öğretmen",
    title: "Sınıfına odaklanır.",
    description: "Derslerini, ödevlerini ve görmesine izin verilen öğrenci sonuçlarını takip eder.",
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
    title: "Bağlı olduğu öğrenciyi takip eder.",
    description: "Görmesine izin verilen rapor, duyuru ve ödeme planı bilgilerine ulaşır.",
  },
];

const securityPoints = [
  {
    icon: LockKeyhole,
    title: "Kurumlara göre ayrılan kayıtlar",
    description: "Her kurum yalnızca kendi öğrenci, çalışan ve sınav kayıtlarıyla çalışır.",
  },
  {
    icon: ShieldCheck,
    title: "Göreve göre belirlenen yetkiler",
    description: "Kullanıcılar yalnızca görevleri ve öğrenci ilişkileri için izin verilen bilgilere ulaşır.",
  },
  {
    icon: BookOpenCheck,
    title: "Kayıt altında tutulan işlemler",
    description: "Önemli kullanıcı ve kurum işlemleri daha sonra incelenebilmesi için kaydedilir.",
  },
];

const faqs = [
  {
    question: "o-okul hangi kurumlar için uygundur?",
    answer:
      "Tek veya çok şubeli dershaneler ve özel öğretim kurumları için tasarlanmıştır. Öğrenci, sınıf, sınav, yoklama, ödeme planı ve kullanıcı ekranlarını bir araya getirir.",
  },
  {
    question: "Demo görüşmesinde hangi akışlar gösterilir?",
    answer:
      "Kurum yapınıza göre kurulum, öğrenci takibi, günlük yoklama, optik sınav, rapor/karne, rol bazlı portallar ve ödeme planı takibi gösterilebilir.",
  },
  {
    question: "Hangi optik dosya akışları desteklenir?",
    answer:
      "Desteklenen TXT ve DAT formatları cevap anahtarı, veri kontrolü, değerlendirme ve rapor adımlarıyla işlenir. Kurumunuzun kullandığı örnek format demo sürecinde ayrıca değerlendirilir.",
  },
  {
    question: "Öğretmen, öğrenci ve veli aynı bilgileri mi görür?",
    answer:
      "Hayır. Her kullanıcı görevine, kurumuna ve bağlı olduğu öğrenciye göre izin verilen bilgilerle çalışır.",
  },
  {
    question: "Ödeme modülü online tahsilat yapar mı?",
    answer:
      "Mevcut kapsam ödeme planı ve taksit durumunun takibidir. Online tahsilat, fatura ve makbuz entegrasyonu demo kapsamına dahil değildir.",
  },
  {
    question: "Demo istemek için hangi bilgiler gerekir?",
    answer:
      "Kurum türü, şube sayısı, yaklaşık öğrenci sayısı, kullandığınız optik format ve öncelikli ihtiyacınız yeterlidir. İlk e-postada öğrenci bilgisi veya dosya göndermeniz gerekmez.",
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
          <p className="next-marketing-nav__statement">Öğrenci takibi, sınav ve karne tek yerde.</p>
          <div className="next-marketing-nav__actions">
            <Link className="next-marketing-login" href="/login">
              Giriş
            </Link>
            <a className="uh-button uh-button--primary uh-button--md" href={demoRequestHref} title="E-posta ile demo iste">
              E-posta ile demo iste
            </a>
          </div>
        </nav>
      </header>

      <div id="main-content" tabIndex={-1}>
        <section className="next-marketing-hero" aria-labelledby="home-title">
          <div className="next-marketing-hero__copy">
            <h1 id="home-title">
              Sınavdan karneye, <span>kurumunuzun günlük işlerini tek yerden yönetin.</span>
            </h1>
            <p className="next-marketing-hero__lead">
              Dershane ve özel öğretim kurumlarında öğrenci kayıtlarını, yoklamayı, sınav sonuçlarını,
              raporları ve ödeme planlarını bir arada yönetin. Öğretmen, öğrenci ve veli yalnızca
              kendilerine açık bilgileri görsün.
            </p>
            <div className="next-marketing-actions">
              <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="E-posta ile demo iste">
                <span>E-posta ile demo isteyin</span>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="next-marketing-text-link" href="#platform">
                Sınav akışını görün
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="next-marketing-hero__note">
              <CheckCircle2 size={17} aria-hidden="true" />
              Demo, kurumunuzun işleyişine göre planlanır.
            </p>
          </div>

          <section className="next-marketing-workflow" aria-label="Örnek sınav akışı">
            <header>
              <span>Örnek ürün akışı</span>
              <strong>Sınavdan paylaşıma</strong>
            </header>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Sınavı hazırlayın</strong>
                  <small>Cevap anahtarı ve katılımcılar</small>
                </div>
                <CheckCircle2 size={18} aria-hidden="true" />
              </li>
              <li data-current="true">
                <span>02</span>
                <div>
                  <strong>Optik dosyayı aktarın</strong>
                  <small>Desteklenen TXT / DAT formatları</small>
                </div>
                <ScanLine size={18} aria-hidden="true" />
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Sonuçları kontrol edin</strong>
                  <small>Başarı %, net ve soru sayısı</small>
                </div>
                <FileChartColumnIncreasing size={18} aria-hidden="true" />
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Karne ve raporları paylaşın</strong>
                  <small>Öğretmen, öğrenci ve veli ekranları</small>
                </div>
                <ShieldCheck size={18} aria-hidden="true" />
              </li>
            </ol>
            <p>
              Tüm adımlar aynı sınav kaydı üzerinden ilerler.
            </p>
          </section>
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
              <h2 id="outcomes-title">Kurumun günlük işlerini dağınık dosyalardan kurtarın.</h2>
            </div>
            <p>
              Öğrenci kayıtlarını, optik dosyaları, raporları ve ödeme planlarını aynı öğrenci üzerinden
              takip edin.
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
                <small>Ek bilgi</small>
                <strong>Net / soru</strong>
              </div>
              <div>
                <small>Detay</small>
                <strong>Kazanım analizi</strong>
              </div>
            </div>
          </div>
          <div className="next-marketing-reporting__copy">
            <h2 id="reporting-title">Soru sayıları farklı sınavları başarı yüzdesiyle karşılaştırın.</h2>
            <p>
              Başarı yüzdesi ana karşılaştırmayı verir. Net ve soru sayısı sonucu açıklayan ek bilgiler
              olarak kalır. Öğrenci, sınıf ve sınav sonuçlarından karne ayrıntısına ilerleyin.
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
          <div className="next-marketing-section__header">
            <h2 id="roles-title">Kurum için tek yönetim alanı, herkes için kendi ekranı.</h2>
            <p>Kurum yöneticisi bütünü yönetir; diğer kullanıcılar yalnızca kendilerine açık bilgileri görür.</p>
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
            <h2 id="trust-title">Kimin hangi bilgileri görebileceğini göreve göre belirleyin.</h2>
            <p>
              Eğitim verileri bir arada tutulurken öğretmen, öğrenci ve veli yalnızca kendi görevleri ve
              ilişkileri için gerekli bilgilere ulaşır.
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

        <section className="next-marketing-cta" aria-labelledby="demo-title">
          <div>
            <h2 id="demo-title">Kurumunuzun işleyişine uygunluğu birlikte değerlendirelim.</h2>
            <p>
              Kurum türünüzü, şube yapınızı ve kullandığınız optik formatı konuşalım. Demo görüşmesinde
              öğrenci takibi, sınav, rapor ve kullanıcı ekranlarından ihtiyacınıza uygun olanları gösterelim.
            </p>
          </div>
          <div className="next-marketing-cta__actions">
            <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="E-posta ile demo iste">
              <span>Demo görüşmesi isteyin</span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <Link className="next-marketing-text-link" href="/login">
              Mevcut kullanıcı girişi
            </Link>
          </div>
        </section>

        <section id="sss" className="next-marketing-section next-marketing-faq" aria-labelledby="faq-title">
          <div className="next-marketing-section__header">
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
          <p>Dershaneler ve özel öğretim kurumları için öğrenci, sınav, karne ve ödeme planı yönetimi.</p>
        </div>
        <nav aria-label="Alt navigasyon">
          <a href="#platform">Kurum yönetimi</a>
          <a href="#raporlama">Sınav ve rapor</a>
          <a href="#roller">Kullanıcı ekranları</a>
          <a href="#guven">Yetki ve kayıtlar</a>
          <Link href="/login">Giriş</Link>
        </nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
