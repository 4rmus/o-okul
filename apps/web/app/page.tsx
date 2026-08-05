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
  ShieldCheck,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref } from "../src/brand.js";

const proofPoints = [
  "Tek ve çok şubeli kurum yönetimi",
  "Öğrenci gelişim geçmişi",
  "Başarı % ile sınav takibi",
  "Öğretmen, öğrenci ve veli ekranları",
];

const outcomes = [
  {
    icon: Building2,
    eyebrow: "Gelişimi görün",
    title: "Her öğrencinin gelişimini tek yerde izleyin.",
    description:
      "Sınav sonuçları, devam durumu ve öğretmen notları aynı öğrenci geçmişinde buluşsun.",
    items: [
      "Zaman içinde başarı karşılaştırması",
      "Devam ve öğretmen notları",
      "Öğrenciye bağlı kurum kayıtları",
    ],
  },
  {
    icon: FileChartColumnIncreasing,
    eyebrow: "Desteği önceliklendirin",
    title: "Sonucu görün, desteğe ihtiyaç duyan öğrenciyi fark edin.",
    description:
      "Başarı yüzdesini zaman içinde karşılaştırın; net ve soru sayısını sonucu açıklayan bağlam olarak koruyun.",
    items: [
      "Başarı yüzdesiyle sınav takibi",
      "Net ve soru sayısıyla açık bağlam",
      "Öğrenci, sınıf ve kazanım görünümü",
    ],
  },
  {
    icon: Users,
    eyebrow: "Birlikte takip edin",
    title: "Öğretmen, öğrenci ve veliyi aynı hedefte buluşturun.",
    description:
      "Kurum yöneticisi bütünü görsün; öğretmen, öğrenci ve veli yalnızca kendileri için gerekli bilgiye ulaşsın.",
    items: ["Öğretmen destek görünümü", "Öğrenci gelişim ekranı", "Veli takip görünümü"],
  },
];

const roleExperiences = [
  {
    icon: Building2,
    label: "Kurum yöneticisi",
    title: "Desteğe ihtiyaç duyan öğrenciyi görür.",
    description: "Kurum, sınıf ve öğrenci başarı görünümünü günlük operasyonla birlikte takip eder.",
  },
  {
    icon: UserRoundCheck,
    label: "Öğretmen",
    title: "Kime destek vereceğine odaklanır.",
    description: "Sınıf karşılaştırmasını, öğrenci gelişimini ve sıradaki akademik aksiyonu görür.",
  },
  {
    icon: GraduationCap,
    label: "Öğrenci",
    title: "Nerede ilerlediğini görür.",
    description: "Başarı geçmişine, güçlü alanlarına ve geliştirmesi gereken konulara ulaşır.",
  },
  {
    icon: Users,
    label: "Veli",
    title: "Çocuğunun gelişimini izler.",
    description: "Gelişim özetini, son sınavı, devamsızlığı ve öğretmen notlarını sade bir dille görür.",
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
    title: "Her ekranda aynı sonuç",
    description: "Yayınlanan sınav sonucu web, PDF ve Excel çıktılarında aynı kayıt üzerinden sunulur.",
  },
];

const faqs = [
  {
    question: "o-okul hangi kurumlar için uygundur?",
    answer:
      "Tek veya çok şubeli dershaneler ve özel öğretim kurumları için tasarlanmıştır. Öğrenci gelişimi, sınav başarısı, devam, iletişim ve ödeme planı takibini bir araya getirir.",
  },
  {
    question: "Demo görüşmesinde hangi akışlar gösterilir?",
    answer:
      "Kurum yapınıza göre öğrenci gelişimi, sınav başarı takibi, günlük yoklama, raporlar, rol bazlı ekranlar ve ödeme planı takibi gösterilebilir.",
  },
  {
    question: "Sınav sonuçları gelişim takibine nasıl eklenir?",
    answer:
      "Kurumunuzun sınav verileri sonuçlandırılmadan önce kontrol edilir. Yayınlanan sonuçlar öğrencinin başarı geçmişine eklenir ve izinli kullanıcı ekranlarında paylaşılır.",
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
      "Kurum türü, şube sayısı, yaklaşık öğrenci sayısı ve öncelikli gelişim veya başarı takip ihtiyacınız yeterlidir. İlk e-postada öğrenci bilgisi veya dosya göndermeniz gerekmez.",
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
          <p className="next-marketing-nav__statement">Öğrenci gelişimi ve başarı takibi.</p>
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
              Her öğrencinin gelişimini <span>sınavdan sınava görün.</span>
            </h1>
            <p className="next-marketing-hero__lead">
              Başarı değişimini, güçlü alanları ve destek ihtiyacını tek yerde takip edin; öğretmen,
              öğrenci ve veliyi aynı hedefte buluşturun.
            </p>
            <div className="next-marketing-actions">
              <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="E-posta ile demo iste">
                <span>Kurumunuz için demo isteyin</span>
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className="next-marketing-text-link" href="#raporlama">
                Öğrenci gelişimi örneğini inceleyin
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
            <p className="next-marketing-hero__note">
              <CheckCircle2 size={17} aria-hidden="true" />
              Demo, kurumunuzun işleyişine göre planlanır.
            </p>
          </div>

          <section className="next-marketing-workflow" aria-label="Örnek öğrenci gelişimi akışı">
            <header>
              <span>Örnek ürün akışı</span>
              <strong>Sonuçtan doğru desteğe</strong>
            </header>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Sınavı sonuçlandırın</strong>
                  <small>Katılım ve sonuç kontrolü</small>
                </div>
                <CheckCircle2 size={18} aria-hidden="true" />
              </li>
              <li data-current="true">
                <span>02</span>
                <div>
                  <strong>Gelişimi karşılaştırın</strong>
                  <small>Başarı % ile zaman içindeki değişim</small>
                </div>
                <FileChartColumnIncreasing size={18} aria-hidden="true" />
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Desteği belirleyin</strong>
                  <small>Güçlü ve gelişime açık alanlar</small>
                </div>
                <BookOpenCheck size={18} aria-hidden="true" />
              </li>
              <li>
                <span>04</span>
                <div>
                  <strong>Birlikte takip edin</strong>
                  <small>Kurum, öğretmen, öğrenci ve veli</small>
                </div>
                <ShieldCheck size={18} aria-hidden="true" />
              </li>
            </ol>
            <p>
              Her sonuç öğrencinin gelişim geçmişine güvenilir biçimde eklenir.
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
              <h2 id="outcomes-title">Öğrenci gelişimini kurumun günlük işlerinden ayırmadan yönetin.</h2>
            </div>
            <p>
              Sınav başarısını, devamı, öğretmen notlarını ve kurum kayıtlarını aynı öğrenci üzerinden
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
                Sınav sonucundan gelişim geçmişine bağlı akış
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
              Kurum türünüzü, şube yapınızı ve öncelikli gelişim veya başarı takip ihtiyacınızı konuşalım.
              Demo görüşmesinde kurum, öğretmen, öğrenci ve veli ekranlarından size uygun olanları gösterelim.
            </p>
          </div>
          <div className="next-marketing-cta__actions">
            <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="E-posta ile demo iste">
              <span>Kurumunuz için demo isteyin</span>
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
          <p>Dershaneler ve özel öğretim kurumları için öğrenci gelişimi ve sınav başarı takibi.</p>
        </div>
        <nav aria-label="Alt navigasyon">
          <a href="#platform">Öğrenci gelişimi</a>
          <a href="#raporlama">Başarı takibi</a>
          <a href="#roller">Kullanıcı ekranları</a>
          <a href="#guven">Yetki ve kayıtlar</a>
          <Link href="/iletisim">İletişim</Link>
          <Link href="/iletisim#kvkk">KVKK başvurusu</Link>
          <Link href="/login">Giriş</Link>
        </nav>
        <p className="next-marketing-footer__copyright">© 2026 {appBrand.name}</p>
      </footer>
    </main>
  );
}
