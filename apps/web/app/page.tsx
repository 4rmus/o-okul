import Link from "next/link";

export default function HomePage() {
  return (
    <main className="next-auth-layout">
      <section className="next-auth-panel" aria-labelledby="home-title">
        <div className="next-brand">
          <span className="next-brand-mark">UH</span>
          <span>Uzman Hocam</span>
        </div>
        <div className="next-form">
          <h1 id="home-title">Uzman Hocam</h1>
          <Link className="next-button" href="/login">
            Girişe geç
          </Link>
        </div>
      </section>
    </main>
  );
}
