import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, FileText, LockKeyhole, Mail, ScanLine, ShieldCheck, UsersRound } from "lucide-react";

const workflow = [
  {
    icon: ScanLine,
    title: "Optik import",
    description: "TXT/DAT dosyaları cevap anahtarı, kitapçık hizalama ve karantina akışıyla işlenir.",
  },
  {
    icon: BarChart3,
    title: "Kazanım analizi",
    description: "Sınıf, öğrenci ve branş kırılımları aynı rapor snapshot'ında izlenir.",
  },
  {
    icon: FileText,
    title: "Karne ve portal",
    description: "Kurum, öğretmen, öğrenci ve veli aynı güvenilir rapor verisini görür.",
  },
];

const trustSignals = [
  "Çok kiracılı RLS izolasyonu",
  "TR datacenter kanıt zinciri",
  "KVKK purge ve audit izleri",
  "S3 dosya saklama ve AV tarama",
];

const outcomes = [
  { label: "UAT senaryosu", value: "21" },
  { label: "OpenAPI path", value: "175" },
  { label: "API test", value: "551" },
  { label: "Worker test", value: "152" },
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
          <div className="next-brand">
            <span className="next-brand-mark">UH</span>
            <span>Uzman Hocam</span>
          </div>
          <Link className="uh-button uh-button--secondary uh-button--md" href="/login">
            Giriş
          </Link>
        </nav>
        <div className="next-marketing-hero__content">
          <p className="next-marketing-kicker">Dershane yönetimi ve optik analiz platformu</p>
          <h1 id="home-title">Uzman Hocam</h1>
          <p>
            Optik okuma, sınav analizi, karne, veli görünümü, ödeme takibi ve kurum operasyonunu tek
            üretim disiplininde birleştirir.
          </p>
          <div className="next-marketing-actions">
            <Link className="uh-button uh-button--primary uh-button--lg" href="/login">
              <span>Panele giriş</span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a className="uh-button uh-button--secondary uh-button--lg" href="mailto:demo@uzmanhocam.local?subject=Uzman%20Hocam%20demo">
              <Mail size={18} aria-hidden="true" />
              <span>Demo iste</span>
            </a>
          </div>
        </div>
      </section>

      <section className="next-marketing-band" aria-label="Üretim kanıtları">
        {outcomes.map((item) => (
          <div key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </section>

      <section className="next-marketing-section" aria-labelledby="workflow-title">
        <div className="next-marketing-section__header">
          <span>Optik döngü</span>
          <h2 id="workflow-title">Sınav dosyasından veliye anlaşılır karneye kadar.</h2>
        </div>
        <div className="next-marketing-workflow">
          {workflow.map((item) => {
            const Icon = item.icon;
            return (
              <article className="next-marketing-card" key={item.title}>
                <Icon size={24} aria-hidden="true" />
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="next-marketing-section next-marketing-section--split" aria-labelledby="ops-title">
        <div className="next-marketing-section__header">
          <span>Operasyon ve güven</span>
          <h2 id="ops-title">Pilot kuruma çıkmadan önce kanıt isteyen kurumlar için.</h2>
        </div>
        <div className="next-marketing-proof">
          <div>
            <ShieldCheck size={28} aria-hidden="true" />
            <h3>Production readiness kapıları</h3>
            <p>
              CI, RLS, OpenAPI, Sentry, pino log, rate limit, idempotency, backup ve UAT kanıtları aynı
              release zincirinde izlenir.
            </p>
          </div>
          <ul>
            {trustSignals.map((signal) => (
              <li key={signal}>
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="next-marketing-section next-marketing-section--contact" aria-labelledby="contact-title">
        <div>
          <span>V1 teklif</span>
          <h2 id="contact-title">Tek veya çok şubeli dershaneler için kapalı beta.</h2>
          <p>
            İlk kurulum, rol bazlı eğitim, optik rapor döngüsü, KVKK/audit kontrolleri ve üretim kanıt
            checklist'i birlikte yürütülür.
          </p>
        </div>
        <div className="next-marketing-contact-actions">
          <a className="uh-button uh-button--primary uh-button--lg" href="mailto:demo@uzmanhocam.local?subject=Kapali%20beta%20basvurusu">
            <UsersRound size={18} aria-hidden="true" />
            <span>Kapalı beta başvurusu</span>
          </a>
          <Link className="uh-button uh-button--secondary uh-button--lg" href="/login">
            <LockKeyhole size={18} aria-hidden="true" />
            <span>Müşteri girişi</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
