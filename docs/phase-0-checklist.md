# Faz 0 Uygulama Checklist'i

Bu dosya Faz 0'a başlamadan önce işi küçük, doğrulanabilir parçalara ayırır. Her PR sonunda
"kanıt" alanındaki komut, dosya veya test çıktısı güncellenir.

## Varsayımlar

- PRD kararları `docs/MASTER_PLAN.md` ve karar kayıtları üzerinden izlenir.
- Faz 0'da ürün kapsamı genişletilmez; hedef güvenli iskelet, login ve demo dashboard'dur.
- RLS zorunlu kalır; performans sorunu çıkarsa RLS kaldırılmaz, ölçülür ve optimize edilir.

## Kapsam Dışı

- Gerçek TXT/DAT parser implementasyonu.
- SMS sağlayıcı entegrasyonu.
- Ödeme/fatura entegrasyonu.
- Faz 1 CRUD ekranlarının tamamı.

## PR Sırası

| PR | Hedef | Sahip | Değişecek alan | Kanıt |
|---|---|---|---|---|
| 0 | Planı repoya sabitle | Ana agent | `docs/` | Tamamlandı: `docs/MASTER_PLAN.md`, bu checklist, ADR dosyaları |
| 1 | Monorepo iskeleti | Ana agent + system-architect inceleme | `apps/`, `packages/`, root config | Tamamlandı: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm run ci` |
| 2 | DB şema + RLS iskeleti | backend-architect | `packages/db` | Tamamlandı: `prisma validate`, `pnpm db:rls:check`, `pnpm db:migrate`, `pnpm db:rls:check:live` ve `pnpm run ci` geçti |
| 3 | Auth + tenant context + RBAC | backend-architect | `apps/api` | Tamamlandı: auth refresh cookie rotation/reuse/logout, ALS bearer context, RBAC guard ve tenant A/B Student Supertest uçları geçti (`pnpm --filter @o-okul/api test`, `pnpm run ci`) |
| 4 | Worker + queue temeli | backend-architect | `apps/worker`, `apps/api` | Tamamlandı: worker tenant job context, queue adları, tenant context'siz DB erişim fail testi, API producer defaultları ve `pnpm queue:smoke` geçti |
| 5 | Docker + CI | devops-architect | compose, workflow dosyaları | Kısmi: `Dockerfile`, `docker-compose.yml`, `docker-compose.traefik.yml`, GitHub Actions workflow, `/health` ve `/health/ready` eklendi; `docker compose ps`, `pnpm docker:check`, lokal mock `pnpm traefik:https:smoke` ve `pnpm run ci` geçti; canlı Traefik/HTTPS kanıtı staging domain bekliyor |
| 6 | Web shell + login + dashboard | frontend-architect | `apps/web`, `apps/api` | Tamamlandı: Vite React web shell, login formu, demo kurum paneli, API CORS ve Playwright smoke eklendi; `pnpm --filter @o-okul/web build`, `pnpm test:e2e`, `pnpm run ci` geçti |
| 7 | Güvenlik ve kalite kapanışı | security-engineer + quality-engineer | `apps/api`, `scripts`, `docs` | Kısmi: güvenlik header middleware'i, login kilidi, `/api/v1` kaynak prefix'i, API hata zarfı, ops kanıt dokümanı, `pnpm ops:check`, `pnpm backup:restore:smoke`, lokal mock `pnpm sentry:smoke` ve lokal mock `pnpm traefik:https:smoke` geçti; canlı HTTPS, gerçek Sentry DSN ve TR provider kaydı staging/prod bekliyor |

## Tenant İzolasyonu Test Matrisi

| Senaryo | Beklenen sonuç | Kanıt |
|---|---|---|
| Tenant A kullanıcısı Tenant B listesini ister | 0 kayıt veya 403 | Supertest |
| Tenant A kullanıcısı Tenant B tekil kaydını ister | 403 veya 404 | Supertest |
| Tenant A kullanıcısı Tenant B `tenantId` ile create dener | 403/422 ve DB'de kayıt yok | Supertest + DB assertion |
| Tenant A kullanıcısı kaydın `tenantId` değerini update etmeye çalışır | 403/422 | Supertest |
| App DB role ile doğrudan yanlış tenant read/write denenir | Veri okunamaz/yazılamaz | DB integration test |
| Worker job tenant context olmadan çalışır | Job fail olur, tenant verisine dokunmaz | Worker test |
| SYSTEM_ADMIN bypass kullanır | İşlem audit log ile kayıtlanır | Supertest + audit assertion |

## CI Bloklayıcı Kapılar

- Lint, typecheck, unit test, integration test ve build geçer.
- Her tenant tablosunda RLS enabled/forced, `USING` ve `WITH CHECK` policy vardır.
- Auth refresh rotation, reuse detection, logout/revoke ve rol/tenant değişikliği testleri geçer.
- STUDENT/GUARDIAN kişi seviyesi RBAC testleri geçer.
- Docker healthcheck DB ve Redis hazır olmadan API'yi ready saymaz.
- HTTPS ve temel güvenlik header'ları staging üzerinde doğrulanır.
- Login rate-limit ve brute-force kilidi test edilir.
- API kaynak endpointleri `/api/v1` altında sunulur; `/health` ve `/health/ready` kökte kalır.
- API başarılı yanıtları liste için `{ data, meta }`, tekil yanıt için `{ data }` zarfını kullanır.
- API hata yanıtları `{ error: { code, message, details? } }` zarfını kullanır.
- Günlük `pg_dump` yedek işi ve geri yükleme denemesi kanıtlanır.
- Sentry PII maskeleme ayarıyla çalışır; test hatası doğru projeye düşer.
- TR datacenter seçimi sağlayıcı/region kaydıyla belgelenir.

## Env/Secret Sözleşmesi

Gerçek secret değerleri repoya yazılmaz. Faz 0 PR'ları en az `.env.example` ve gerekli CI secret
isimlerini ekler.

| Alan | Değişkenler | Kanıt |
|---|---|---|
| Runtime | `NODE_ENV`, `APP_URL`, `API_URL`, `WEB_URL`, `PORT`, `LOG_LEVEL` | `.env.example` |
| DB/RLS | `DATABASE_URL`, `DIRECT_DATABASE_URL`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `APP_DB_USER`, `APP_DB_PASSWORD`, `MIGRATION_DB_USER`, `MIGRATION_DB_PASSWORD` | `.env.example`, RLS integration test |
| Auth | `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `COOKIE_DOMAIN`, `COOKIE_SECURE` | auth testleri |
| Redis/Queue | `REDIS_URL`, `QUEUE_PREFIX` | worker testleri |
| S3/MinIO | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | upload smoke testi |
| Sentry | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_SEND_DEFAULT_PII=false` | test hata kaydı |
| Traefik/TLS | `DOMAIN`, `ACME_EMAIL`, `TRAEFIK_HTTPS_SMOKE_URL` | `pnpm traefik:https:smoke` staging TLS kontrolü |
| Backup/Ops | `BACKUP_BUCKET` veya `BACKUP_PATH`, `BACKUP_RETENTION_DAYS` | `pg_dump` + restore denemesi |
| CI/Deploy | `CI_DATABASE_URL`, `CI_REDIS_URL`, gerekirse `SENTRY_AUTH_TOKEN`, `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` | CI secret listesi |

## Komut Sözleşmesi

Bu komutlar Faz 0 boyunca package script olarak eklenir ve CI'da aynı isimlerle çalışır.

| Amaç | Komut | Beklenen kanıt |
|---|---|---|
| Kurulum | `pnpm install` | lockfile ve başarılı kurulum |
| Lint | `pnpm lint` | hata yok |
| Tip kontrolü | `pnpm typecheck` | hata yok |
| Test | `pnpm test` | unit/integration testleri geçer |
| Build | `pnpm build` | web/api/worker build geçer |
| DB migrate | `pnpm db:migrate` | migration lokal Postgres'te çalışır |
| Seed | `pnpm db:seed` | demo tenant ve kullanıcılar oluşur |
| RLS statik kontrol | `pnpm db:rls:check` | tenant tablolarında RLS enabled/forced ve `USING` + `WITH CHECK` policy vardır |
| RLS canlı kontrol | `pnpm db:rls:check:live` | migration uygulanmış lokal Postgres üzerinde app role ile tenant negatif read/write testleri geçer |
| Ops statik kontrol | `pnpm ops:check` | güvenlik/backup/Sentry/TR datacenter sözleşmesi repo içinde belgelenir |
| Deployment region | `pnpm deployment:region:check` | staging/prod provider, region ve TR datacenter kanıtı geçer |
| Lokal servis | `docker compose up -d postgres redis minio` | servisler healthy |
| Dev | `pnpm dev` | web/api/worker başlar |
| Health | `curl -f http://localhost:<api-port>/health` | 200 |
| Ready | `curl -f http://localhost:<api-port>/health/ready` | DB/Redis hazırken 200, değilken fail |
| Traefik HTTPS | `pnpm traefik:https:smoke` | staging/prod HTTPS `/health` ve HSTS kontrolü geçer |
| E2E | `pnpm test:e2e` | login + dashboard smoke testi geçer |
| CI toplam | `pnpm run ci` | docker config kontrolü, ops statik kontrolü, lint, typecheck, test, build geçer; RLS kontrol PR 2'de eklenir |

## Subagent Çıktı Formatı

Her subagent finalinde şunları yazar:

- Değişen dosyalar.
- Çalıştırılan doğrulamalar.
- Kalan riskler.
- Ana agent'ın onaylaması gereken kararlar.
