"use client";

const roleCards = [
  {
    title: "Öğretmen Portalı",
    route: "/ogretmen",
    account: "TEACHER + subjectType TEACHER",
    scope: "Ders programı, kapsamındaki öğrenciler, yoklama, not, ödev kontrolü ve raporlar",
    demo: "teacher-a@example.test",
  },
  {
    title: "Öğrenci Portalı",
    route: "/ogrenci",
    account: "STUDENT + subjectType STUDENT",
    scope: "Profil, devamsızlık, duyuru, ödev, destek talebi, sınav raporu ve hata kitapçığı",
    demo: "student-a@example.test",
  },
  {
    title: "Veli Portalı",
    route: "/veli",
    account: "GUARDIAN + subjectType GUARDIAN",
    scope: "Bağlı öğrenci, ödeme görünümü, bildirim tercihleri, duyuru, destek ve raporlar",
    demo: "guardian-a@example.test",
  },
] as const;

const accessRules = [
  "Kurum admin portalları normal sol menü rotası olarak görmez.",
  "Portal route'u kişi hesabı ve doğru subjectType ister.",
  "Veli yalnız bağlı öğrencinin verisini görür.",
  "Öğretmen yalnız sorumlu öğrenci veya ders programı kapsamını görür.",
  "Öğrenci yalnız kendi /me/student verisini görür.",
] as const;

const evidenceChecks = [
  "pnpm --filter @uzman-hocam/web exec playwright test -c playwright.next.config.ts e2e-next/login-next.spec.ts -g \"Next rol portalları bağlı kişi verisini gösterir\"",
  "pnpm --filter @uzman-hocam/api exec vitest run src/me/me-access-matrix.e2e.test.ts",
  "pnpm identity-link:audit",
] as const;

export function RolePreviewPage() {
  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>Rol Önizleme</h1>
          <p>Kurum admin için öğretmen, öğrenci ve veli portal kapsamlarını güvenli şekilde izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="Rol önizleme özeti">
        <article className="next-metric">
          <span>Portal</span>
          <strong>3 rol</strong>
        </article>
        <article className="next-metric">
          <span>Erişim</span>
          <strong>Kişi hesabı</strong>
        </article>
        <article className="next-metric">
          <span>Kapsam</span>
          <strong>/me bağlı</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="Rol portal kartları">
        <h2>Portal Kapsamları</h2>
        {roleCards.map((role) => (
          <article key={role.title}>
            <h3>{role.title}</h3>
            <p>{role.account}</p>
            <p>{role.scope}</p>
            <code>{role.route}</code>
            <p>{role.demo}</p>
          </article>
        ))}
      </section>
      <RolePreviewList title="Erişim Kuralları" ariaLabel="Rol erişim kuralları" items={accessRules} />
      <RolePreviewList title="Kanıt Komutları" ariaLabel="Rol önizleme kanıt komutları" items={evidenceChecks} />
    </>
  );
}

function RolePreviewList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
