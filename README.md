# Uzman Hocam

Çok kiracılı (multi-tenant) dershane ve kurum yönetim SaaS platformu. Kurumlar birbirinin verisini asla göremez; 10.000+ öğrenci ölçeğinde tasarlanmıştır.

## Mimariye Genel Bakış

```
uzman-hocam/
├── apps/
│   ├── web/       # Next.js 16 (App Router) — kullanıcı arayüzü
│   ├── api/       # NestJS 11 — REST API + BullMQ producer
│   └── worker/    # BullMQ standalone processor (CPU-yoğun işler izole)
├── packages/
│   ├── db/           # Prisma şeması, migrasyonlar (RLS dahil), seed
│   ├── shared-types/ # Zod şemaları → TS tipleri (frontend↔backend tek kaynak)
│   ├── ui/           # shadcn/ui bileşen kütüphanesi
│   ├── config/       # ESLint, tsconfig paylaşımlı yapılandırma
│   └── sms-adapter/  # SMS sağlayıcı soyutlaması
├── docker/        # Loki, Alloy, Prometheus yapılandırmaları
├── scripts/       # Smoke testleri ve üretim hazırlık kontrolleri
└── docs/          # ADR'lar, faz raporları ve checklist'ler
```

**Monorepo:** pnpm workspaces + Turborepo  
**Dağıtım:** Docker Compose + Traefik (self-hosted / VPS)  
**Veri ikametgâhı:** KVKK uyumlu, Türkiye datacenter hedefli

## Temel Özellikler

### Güvenlik & Çok Kiracılılık
- **Postgres Row-Level Security (RLS)** — kiracı izolasyonu veritabanı katmanında zorlanır
- **Prisma `$extends` ikinci savunma katmanı** — RLS devre dışı kalsa bile uygulama filtresi
- **JWT access + refresh token** ile HttpOnly cookie oturum yönetimi
- **Token family rotation** — refresh token çalınma tespiti
- **Brute-force koruması** — login denemesi sınırlayıcı (rate limiter)
- **Şifreli PII depolama** — öğrenci kişisel verisi AES-256 ile şifrelenir
- **RBAC** — `SYSTEM_ADMIN`, `TENANT_ADMIN`, `TEACHER`, `STUDENT`, `GUARDIAN` rolleri
- **CSRF koruması** — logout ve yenileme uç noktalarında
- **Güvenlik başlıkları** — CSP, HSTS, X-Frame-Options vb.

### Okul Yönetimi
- Sınıf ve şube yönetimi, öğrenci sınıf geçmişi
- Öğretmen atama ve öğretmen notları
- Veli-öğrenci bağlama (granüler izin sistemi)
- Öğrenci kayıt kotası (hard-block aşım kontrolü)
- Kimlik daveti sistemi (identity-invitation)

### Sınav & Değerlendirme
- Optik form TXT/DAT içe aktarma (ham import)
- Konfigüre edilebilir parser (soru ağırlıkları, cevap anahtarı)
- Puanlama motoru + rapor üretimi
- Karantina mekanizması (hatalı import satırları)
- Öğrenim çıktıları (learning outcomes) takibi

### Devam Takibi & Program
- Ders programı (schedule) yönetimi
- Devamsızlık kayıtları
- Çalışma seansı takibi (study sessions)

### Ödev & Materyal
- Ödev oluşturma, atama ve kontrol işareti
- Dosya yüklemeli materyal yönetimi (S3 uyumlu depolama)
- Antivirüs tarama desteği (upload AV)

### İletişim
- SMS toplu gönderimi (SMS batch) — sağlayıcı bağımsız adaptör
- Duyuru modülü
- Mesaj şablonu yönetimi
- Destek talebi sistemi (support tickets + ekler)

### Ödeme Takibi
- Ödeme planı ve taksit yönetimi
- Finansal kayıt saklama (KVKK uyumlu retention)

### Gözlemlenebilirlik (Observability)
- **Prometheus** metrik toplama
- **Grafana** dashboard + alerting
- **Loki + Grafana Alloy** log toplama
- **Sentry** hata izleme
- Denetim kaydı (audit log) — bölümlenmiş tablo (`created_at` bazlı partition)

### Async İşlem (Worker)
- BullMQ + Redis kuyruk mimarisi
- Rapor üretimi, SMS gönderimi ve içe aktarma işleri kuyrukta yürür

## Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| API | NestJS 11, Express, Zod, BullMQ |
| Worker | BullMQ, Node.js |
| Veritabanı | PostgreSQL 16, Prisma ORM, RLS |
| Kuyruk | Redis, BullMQ |
| Depolama | S3 uyumlu (AWS SDK v3) |
| SMS | Sağlayıcı-bağımsız adaptör |
| İzleme | Prometheus, Grafana, Loki, Sentry |
| CI/CD | GitHub Actions |
| Altyapı | Docker Compose, Traefik (HTTPS) |
| Monorepo | pnpm workspaces, Turborepo |

## Hızlı Başlangıç

### Gereksinimler
- Node.js ≥ 22
- pnpm 11.5.0
- Docker + Docker Compose

### Kurulum

```bash
# Bağımlılıkları yükle
pnpm install

# Ortam değişkenlerini yapılandır
cp .env.example .env
# .env dosyasını düzenle

# Docker servisleri başlat (Postgres, Redis)
docker compose up -d postgres redis

# Veritabanı migration ve seed
pnpm db:migrate
pnpm db:seed

# Geliştirme sunucusunu başlat
pnpm dev
```

Uygulamalar:
- **Web:** http://localhost:3001
- **API:** http://localhost:3100

### Üretim Dağıtımı

```bash
# Docker Compose ile tam stack
docker compose up -d

# Traefik HTTPS kontrolü
pnpm traefik:https:smoke

# Üretim hazırlık denetimi
pnpm prod:readiness:check
```

## Test & CI

```bash
# Tüm kontrolleri çalıştır (CI'da kullanılan komut)
pnpm ci

# Sadece birim/entegrasyon testleri
pnpm test

# Tip denetimi
pnpm typecheck

# RLS politika doğrulaması
pnpm db:rls:check

# Smoke testleri (canlı ortam gerektirir)
pnpm live:smoke
```

## Dokümantasyon

- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) — kapsamlı mimari ve yol haritası
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — mimari karar kayıtları (ADR)
- [`docs/ADR-0001-multi-tenancy.md`](docs/ADR-0001-multi-tenancy.md) — çok kiracılılık kararı
- [`docs/ADR-0002-deployment.md`](docs/ADR-0002-deployment.md) — dağıtım stratejisi

## Güvenlik

Güvenlik açığı bildirimleri için lütfen doğrudan iletişime geçin. Public issue açmayın.

## Lisans

Private — tüm hakları saklıdır.
