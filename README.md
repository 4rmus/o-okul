# o-okul

Çok kiracılı (multi-tenant) dershane ve kurum yönetim SaaS platformu. Kurumlar birbirinin verisini asla göremez; 10.000+ öğrenci ölçeğinde tasarlanmıştır.

## Mimariye Genel Bakış

```
o-okul/
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
# Bu cihazdaki provider'sız single-node staging/pilot koşusu
API_NODE_ENV=staging \
WORKER_NODE_ENV=staging \
API_RATE_LIMIT_ENABLED=true \
API_RATE_LIMIT_STORE=redis \
LOGIN_ATTEMPT_LIMITER_STORE=redis \
REPORT_PDF_RENDERER=worker \
SUPPORT_ATTACHMENT_STORAGE=s3 \
HOMEWORK_MATERIAL_FILE_STORAGE=s3 \
SMS_ALLOW_NOOP_IN_PRODUCTION=true \
NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION=true \
docker compose --env-file .env.local up -d

# Gerçek domain ile HTTPS edge koşusu.
DOMAIN=o-okul.com \
APP_URL=https://o-okul.com \
API_URL=https://o-okul.com \
WEB_URL=https://o-okul.com \
NEXT_PUBLIC_API_URL=https://o-okul.com \
COOKIE_SECURE=true \
CF_DNS_API_TOKEN_FILE=./secrets/cloudflare_dns_api_token \
LEGACY_TENANT_LOGIN_CUTOFF_AT=2099-01-01T00:00:00.000Z \
ACME_EMAIL=admin@o-okul.com \
API_NODE_ENV=staging \
WORKER_NODE_ENV=staging \
API_RATE_LIMIT_ENABLED=true \
API_RATE_LIMIT_STORE=redis \
LOGIN_ATTEMPT_LIMITER_STORE=redis \
REPORT_PDF_RENDERER=worker \
SUPPORT_ATTACHMENT_STORAGE=s3 \
HOMEWORK_MATERIAL_FILE_STORAGE=s3 \
SMS_ALLOW_NOOP_IN_PRODUCTION=true \
NOTIFICATION_ALLOW_NOOP_IN_PRODUCTION=true \
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.traefik.yml up -d --build web api worker queue-board traefik

# Tek-node varsayılan stack: web, api, worker, queue-board, postgres, redis, minio
docker compose up -d

# Upload AV/ClamAV kanıtı veya fail-closed tarama gerektiğinde
docker compose --profile av up -d

# Traefik HTTPS kontrolü
pnpm traefik:https:smoke

# Domain HTTPS smoke için
TRAEFIK_HTTPS_SMOKE_URL=https://o-okul.com/health \
TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE=artifacts/single-node-2026-06-14/traefik-https-smoke.json \
pnpm traefik:https:smoke

# Üretim hazırlık denetimi
pnpm prod:readiness:check
```

Bu repo varsayılan compose değerlerini 4 vCPU / 8 GiB RAM sınıfı tek VPS için sınırlar. ClamAV,
observability ve external monitoring varsayılan açılışa dahil değildir; ilgili kanıt veya staging
doğrulaması sırasında profil/override ile çalıştırılır.

Gerçek domain için `docker-compose.traefik.yml`, `DOMAIN=o-okul.com` ve `ACME_EMAIL`
ile Let's Encrypt modu kullanılır.

Geçici off-site backup modeli provider kullanmaz: sunucuda üretilen
`artifacts/single-node-2026-06-14/kurum-cihazi-yedek-2026-06-14.dump` dosyası ve yanındaki
`.sha256` dosyası kurum yetkilisinin kendi cihazına indirilerek sunucu dışı kopya oluşturulur.
Bu model S3/provider off-site smoke yerine geçmez; domain/provider hazırlığı tamamlanınca kalıcı
off-host hedef ayrıca doğrulanır.

Host üzerinde çalışan pnpm scriptleri `DATABASE_URL`/`REDIS_URL` ile `localhost` bağlantılarını
kullanır. Docker Compose servisleri ise container ağı içinde `DOCKER_DATABASE_URL`,
`DOCKER_DIRECT_DATABASE_URL` ve `DOCKER_REDIS_URL` değerlerini kullanır.

## Test & CI

```bash
# Tüm kontrolleri çalıştır (CI'da kullanılan komut)
pnpm run ci

# Sadece birim/entegrasyon testleri
pnpm test

# Tip denetimi
pnpm typecheck

# RLS politika doğrulaması
pnpm db:rls:check

# OpenAPI JSON sözleşmesi (CI build sonrasında artifacts/openapi.json üretir)
pnpm build
pnpm openapi:generate

# Smoke testleri (canlı ortam gerektirir)
pnpm live:smoke
```

## Dokümantasyon

- [`status.md`](status.md) — güncel uygulama ve release durumu
- [`docs/llm-wiki/README.md`](docs/llm-wiki/README.md) — kod ajanları için hızlı yön bulma
- [`docs/product-journeys-v1.md`](docs/product-journeys-v1.md) — ürün kapsamı ve UAT matrisi
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — mimari karar kayıtları (ADR)
- [`docs/ADR-0001-multi-tenancy.md`](docs/ADR-0001-multi-tenancy.md) — çok kiracılılık kararı
- [`docs/ADR-0002-deployment.md`](docs/ADR-0002-deployment.md) — dağıtım stratejisi

## Güvenlik

Güvenlik açığı bildirimleri için lütfen doğrudan iletişime geçin. Public issue açmayın.

## Lisans

Private — tüm hakları saklıdır.
