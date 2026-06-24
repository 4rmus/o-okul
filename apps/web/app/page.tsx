import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  MessageSquareText,
  NotebookTabs,
  ScanLine,
  School,
  ShieldCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import { appBrand, appBrandHomeAriaLabel, demoRequestHref } from "../src/brand.js";

const heroMetrics = [
  { value: "4 rol", label: "Öğrenci, veli, öğretmen ve kurum görünümü" },
  { value: "8 modül", label: "Takip, iletişim, sınav ve raporlama altyapısı" },
  { value: "Tek akış", label: "Dershane ve özel okul süreçleri için ortak veri" },
];

const problemSolutions = [
  {
    problem: "Öğrenci verisi farklı dosya ve panellerde dağılır.",
    solution: "Öğrenci bilgi sistemi, ders programı, devamsızlık, sınav ve ödev takibi aynı kurum kaydında birleşir.",
  },
  {
    problem: "Veliler bilgiye geç ulaşır, kurum ekibi tekrar tekrar açıklama yapmak zorunda kalır.",
    solution: "Duyuru, sınav sonucu, devamsızlık ve öğretmen notları zamanında paylaşılır; iletişim kayıt altında ilerler.",
  },
  {
    problem: "Yönetici kararları çoğu zaman manuel raporlarla ve gecikmeli alınır.",
    solution: "Kurum paneli performans, şube, sınıf ve öğrenci gelişimini ölçülebilir raporlara dönüştürür.",
  },
];

const audienceBenefits = [
  {
    icon: GraduationCap,
    title: "Öğrenciler için",
    description: "Ders programı, ödev, sınav, başarı takibi ve duyurular tek ekranda takip edilir.",
    items: ["Güncel ders programı", "Ödev ve materyal takibi", "Sınav sonucu ve gelişim görünümü"],
  },
  {
    icon: Users,
    title: "Veliler için",
    description: "Anlık bilgilendirme, devamsızlık, sınav sonuçları ve öğretmen iletişimi düzenli hale gelir.",
    items: ["Devamsızlık ve duyuru bildirimleri", "Sınav sonuçlarına hızlı erişim", "Öğretmen iletişim kayıtları"],
  },
  {
    icon: UserRoundCog,
    title: "Öğretmenler için",
    description: "Sınıf yönetimi, ödev/sınav takibi, raporlama ve veli iletişimi daha az manuel işle yürür.",
    items: ["Sınıf ve öğrenci listeleri", "Ödev, sınav ve not takibi", "Raporlama ve geri bildirim akışı"],
  },
  {
    icon: Building2,
    title: "Kurumlar için",
    description: "Operasyon yönetimi, performans analizi, veli memnuniyeti ve dijitalleşme aynı platformda toplanır.",
    items: ["Şube ve sınıf operasyonu", "Performans analizi", "Kurumsal dijital dönüşüm"],
  },
];

const coreFeatures = [
  {
    icon: School,
    title: "Öğrenci bilgi sistemi",
    description: "Kayıt, sınıf, seviye, sorumlu öğretmen ve veli bilgileri kurum genelinde tutarlı yönetilir.",
  },
  {
    icon: ScanLine,
    title: "Sınav ve başarı takibi",
    description: "Optik okuma, cevap anahtarı ve sınav sonuçları öğrenci gelişimine bağlanır.",
  },
  {
    icon: CalendarDays,
    title: "Ödev ve ders programı yönetimi",
    description: "Ders akışı, ödevler, materyaller ve takvim bilgisi öğrenci ve veliye düzenli aktarılır.",
  },
  {
    icon: MessageSquareText,
    title: "Veli bilgilendirme",
    description: "Duyuru, devamsızlık, sınav sonucu ve öğretmen notları kontrollü bildirimlerle paylaşılır.",
  },
  {
    icon: ClipboardCheck,
    title: "Öğretmen paneli",
    description: "Öğretmenler sınıflarını, ödevlerini, sınav kayıtlarını ve öğrenci geri bildirimlerini izler.",
  },
  {
    icon: LayoutDashboard,
    title: "Kurum yönetim paneli",
    description: "Yönetim ekibi kampüs, sınıf, öğretmen, öğrenci ve süreç performansını tek yerden takip eder.",
  },
  {
    icon: BarChart3,
    title: "Raporlama ve analiz",
    description: "Kazanım analizi, sınıf karşılaştırmaları ve gelişim raporları karar süreçlerini hızlandırır.",
  },
  {
    icon: Megaphone,
    title: "Duyuru ve bildirim sistemi",
    description: "Kurum duyuruları hedef kitleye göre planlanır, teslim ve görüntülenme durumu izlenir.",
  },
];

const workflow = [
  {
    title: "Kurumu yapılandırın",
    description: "Kampüs, sınıf, seviye, öğretmen, öğrenci ve veli kayıtlarını kurumsal yapınıza göre tanımlayın.",
  },
  {
    title: "Eğitim süreçlerini işletin",
    description: "Ders programı, ödev, sınav, devamsızlık ve duyuruları günlük akışın parçası haline getirin.",
  },
  {
    title: "Karne ve portal paylaşın",
    description: "Karne ve portal görünümleriyle öğrenci, veli ve öğretmen aynı güncel veriye ulaşır.",
  },
  {
    title: "Raporlayın ve iyileştirin",
    description: "Yönetim panelinde gelişim, performans ve iletişim kalitesini düzenli takip edin.",
  },
];

const trustValues = [
  "Dershane, özel okul ve kurs merkezi süreçlerine uygun yapı",
  "Kolay kullanım ve kısa adaptasyon süreci",
  "Zaman tasarrufu sağlayan merkezi operasyon",
  "Daha güçlü veli iletişimi",
  "Ölçülebilir öğrenci gelişimi",
  "Kurumsal dijital dönüşüm için sürdürülebilir temel",
];

const reportHighlights = [
  { label: "Sınav görünümü", value: "Sınıf, öğrenci ve kazanım bazında sonuç takibi" },
  { label: "İletişim görünümü", value: "Duyuru, bildirim ve veli bilgilendirme kayıtları" },
  { label: "Operasyon görünümü", value: "Devamsızlık, ödev, ders programı ve kurum performansı" },
];

const faqs = [
  {
    question: "o-okul hangi kurumlar için uygundur?",
    answer:
      "Dershaneler, özel okullar, kurs merkezleri ve çok şubeli eğitim kurumları için tasarlanmıştır. Kurum, öğretmen, öğrenci ve veli akışlarını birlikte yönetir.",
  },
  {
    question: "Demo sürecinde ne gösterilir?",
    answer:
      "Demo görüşmesinde kurum paneli, öğrenci takip akışı, sınav ve başarı raporları, veli bilgilendirme, öğretmen paneli ve örnek kurum yönetimi senaryoları gösterilir.",
  },
  {
    question: "Veliler ve öğretmenler ayrı panel kullanabilir mi?",
    answer:
      "Evet. Öğrenci, veli, öğretmen ve kurum yöneticileri kendi rollerine uygun görünümle çalışır; yetkiler kurum ihtiyaçlarına göre ayrıştırılır.",
  },
  {
    question: "Mevcut kurum süreçlerine uyum sağlanabilir mi?",
    answer:
      "Sınıf, seviye, kampüs, ders programı, sınav ve duyuru yapıları eğitim kurumlarının günlük işleyişine göre modellenmiştir.",
  },
  {
    question: "Güvenlik ve operasyonel hazırlık nasıl ele alınıyor?",
    answer:
      "Rol bazlı erişim, audit kayıtları ve Production readiness kapıları ile kurum verisinin güvenli ve izlenebilir yürütülmesi hedeflenir.",
  },
];

export default function HomePage() {
  return (
    <main className="next-marketing">
      <section className="next-marketing-hero" aria-labelledby="home-title">
        <picture>
          <source srcSet="/images/landing-hero-education-ops.webp" type="image/webp" />
          <img
            className="next-marketing-hero__image"
            src="/images/landing-hero-education-ops.png"
            width={1440}
            height={810}
            alt=""
            aria-hidden="true"
            decoding="async"
            fetchPriority="high"
            loading="eager"
          />
        </picture>
        <div className="next-marketing-hero__overlay" aria-hidden="true" />
        <nav className="next-marketing-nav" aria-label="Landing navigasyonu">
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <div className="next-marketing-nav__links">
            <a href="#faydalar">Faydalar</a>
            <a href="#ozellikler">Özellikler</a>
            <a href="#sss">SSS</a>
          </div>
          <Link className="uh-button uh-button--secondary uh-button--md" href="/login">
            Giriş
          </Link>
        </nav>

        <div className="next-marketing-hero__content">
          <p className="next-marketing-kicker">Dershane, özel okul ve kurs merkezleri için</p>
          <h1 id="home-title">{appBrand.name}</h1>
          <p className="next-marketing-hero__headline">
            Eğitim kurumları için öğrenci takip ve kurum yönetimini tek platformda birleştirir.
          </p>
          <p className="next-marketing-hero__copy">
            Öğrenci takibi, veli iletişimi, öğretmen verimliliği, sınav başarısı ve kurum operasyonunu
            aynı güvenilir veri akışında yönetin.
          </p>
          <div className="next-marketing-actions">
            <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="Demo iste">
              <span>Demo Talep Et</span>
              <ArrowRight size={18} aria-hidden="true" />
            </a>
            <a className="uh-button uh-button--secondary uh-button--lg" href="#ozellikler">
              <span>Özellikleri İncele</span>
            </a>
          </div>
          <div className="next-marketing-hero__proof" aria-label="Platform kapsamı">
            {heroMetrics.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="next-marketing-band" aria-label="Değer önerisi">
        {trustValues.slice(0, 3).map((item) => (
          <div key={item}>
            <CheckCircle2 size={18} aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </section>

      <section className="next-marketing-section next-marketing-section--problem" aria-labelledby="problem-title">
        <div className="next-marketing-section__header">
          <span>Kurumlar için problem ve çözüm</span>
          <h2 id="problem-title">Dağınık eğitim operasyonunu ölçülebilir ve takip edilebilir hale getirin.</h2>
          <p>
            {appBrand.name}, kurum yöneticilerinin günlük operasyonu görmesini, ekiplerin aynı veriden çalışmasını
            ve velilerin zamanında bilgilendirilmesini sağlar.
          </p>
        </div>
        <div className="next-marketing-problem-grid">
          {problemSolutions.map((item) => (
            <article className="next-marketing-problem" key={item.problem}>
              <div>
                <span>Bugün</span>
                <p>{item.problem}</p>
              </div>
              <ArrowRight size={20} aria-hidden="true" />
              <div>
                <span>{appBrand.name} ile</span>
                <p>{item.solution}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="faydalar" className="next-marketing-section" aria-labelledby="audience-title">
        <div className="next-marketing-section__header">
          <span>Kullanıcı tiplerine göre avantajlar</span>
          <h2 id="audience-title">Her rol için net fayda, kurum için tek merkez.</h2>
          <p>
            Öğrenci, veli ve öğretmen günlük ihtiyaçlarını sade panellerden takip ederken kurum yönetimi
            bütün resmi aynı ekranda görür.
          </p>
        </div>
        <div className="next-marketing-audience-grid">
          {audienceBenefits.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <article className="next-marketing-card" key={benefit.title}>
                <span className="next-marketing-icon">
                  <Icon size={22} aria-hidden="true" />
                </span>
                <h3>{benefit.title}</h3>
                <p>{benefit.description}</p>
                <ul>
                  {benefit.items.map((item) => (
                    <li key={item}>
                      <CheckCircle2 size={16} aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section id="ozellikler" className="next-marketing-section next-marketing-section--surface" aria-labelledby="features-title">
        <div className="next-marketing-section__inner">
          <div className="next-marketing-section__header">
            <span>Ana özellikler</span>
            <h2 id="features-title">Kurum yönetimi, eğitim takibi ve iletişim için eksiksiz modüller.</h2>
            <p>
              Modüller birbirinden kopuk değil; öğrenci kaydından sınav sonucuna, veli bilgilendirmeden kurum
              raporuna kadar aynı veri modeliyle çalışır.
            </p>
          </div>
          <div className="next-marketing-feature-grid">
            {coreFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className="next-marketing-card next-marketing-card--compact" key={feature.title}>
                  <span className="next-marketing-icon next-marketing-icon--muted">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="next-marketing-section" aria-labelledby="workflow-title">
        <div className="next-marketing-section__header">
          <span>Nasıl çalışır?</span>
          <h2 id="workflow-title">Kurulumdan rapora kadar sade bir işletim akışı.</h2>
        </div>
        <div className="next-marketing-workflow">
          {workflow.map((step, index) => (
            <article className="next-marketing-step" key={step.title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="next-marketing-section next-marketing-section--reporting" aria-labelledby="report-title">
        <div className="next-marketing-section__header">
          <span>Raporlama ve takip</span>
          <h2 id="report-title">Karar vericiler için güncel, anlaşılır ve aksiyona dönük raporlar.</h2>
          <p>
            Kurum yöneticileri sınav başarısını, devamsızlığı, ödev takibini, duyuru erişimini ve sınıf
            performansını düzenli göstergelerle takip eder.
          </p>
        </div>
        <div className="next-marketing-report">
          <div className="next-marketing-report__visual" aria-hidden="true">
            <div className="next-marketing-report__topline">
              <span>Genel başarı</span>
              <strong>%82</strong>
            </div>
            <div className="next-marketing-report__bars">
              <span style={{ "--bar-size": "78%" } as CSSProperties} />
              <span style={{ "--bar-size": "64%" } as CSSProperties} />
              <span style={{ "--bar-size": "88%" } as CSSProperties} />
              <span style={{ "--bar-size": "56%" } as CSSProperties} />
              <span style={{ "--bar-size": "72%" } as CSSProperties} />
            </div>
            <div className="next-marketing-report__legend">
              <span>Matematik</span>
              <span>Fen</span>
              <span>Türkçe</span>
            </div>
          </div>
          <div className="next-marketing-report__list">
            {reportHighlights.map((item) => (
              <div key={item.label}>
                <FileText size={18} aria-hidden="true" />
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="next-marketing-section next-marketing-section--trust" aria-labelledby="trust-title">
        <div className="next-marketing-section__header">
          <span>Güven ve değer önerisi</span>
          <h2 id="trust-title">Eğitim kurumlarının gerçek işleyişine uygun tasarlandı.</h2>
        </div>
        <div className="next-marketing-trust-grid">
          {trustValues.map((value) => (
            <div key={value}>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="next-marketing-section next-marketing-section--contact" aria-labelledby="contact-title">
        <div>
          <span>Demo çağrısı</span>
          <h2 id="contact-title">Kurumunuzun takip, iletişim ve raporlama sürecini birlikte değerlendirelim.</h2>
          <p>
            Demo görüşmesinde mevcut işleyişinizi dinleyip {appBrand.name} öğrenci, veli, öğretmen ve kurum
            yönetimi akışlarını kurum senaryonuz üzerinden gösteririz.
          </p>
          <p className="next-marketing-contact-note">
            Kapalı beta başvurusu ve demo talepleri aynı kurum keşif sürecinde değerlendirilir.
          </p>
        </div>
        <div className="next-marketing-contact-actions">
          <a className="uh-button uh-button--primary uh-button--lg" href={demoRequestHref} title="Demo iste">
            <span>Demo Talep Et</span>
            <ArrowRight size={18} aria-hidden="true" />
          </a>
          <Link className="uh-button uh-button--secondary uh-button--lg" href="/login">
            <span>Müşteri Girişi</span>
          </Link>
        </div>
      </section>

      <section id="sss" className="next-marketing-section next-marketing-section--faq" aria-labelledby="faq-title">
        <div className="next-marketing-section__header">
          <span>SSS</span>
          <h2 id="faq-title">Demo öncesi sık sorulan sorular.</h2>
        </div>
        <div className="next-marketing-faq-list">
          {faqs.map((faq) => (
            <details key={faq.question}>
              <summary>
                <NotebookTabs size={18} aria-hidden="true" />
                <span>{faq.question}</span>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="next-marketing-footer">
        <div>
          <Link className="next-brand" href="/" aria-label={appBrandHomeAriaLabel}>
            <span className="next-brand-mark">{appBrand.mark}</span>
            <span>{appBrand.name}</span>
          </Link>
          <p>Dershaneler, özel okullar ve kurs merkezleri için eğitim kurumu yönetim platformu.</p>
        </div>
        <nav aria-label="Footer navigasyonu">
          <a href="#faydalar">Faydalar</a>
          <a href="#ozellikler">Özellikler</a>
          <a href="#demo">Demo</a>
          <Link href="/login">Giriş</Link>
        </nav>
      </footer>
    </main>
  );
}
