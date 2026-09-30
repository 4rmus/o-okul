# Berrak UI/UX Yeniden Tasarım — İlerleme Kaydı

Plan: `docs/ui-ux-berrak-redesign-plan.md`. Her gate stacked branch'te yürür
(`berrak/gN-<ad>`), tek yazıcı kuralı geçerlidir. Kanıt sınıfları ayrı raporlanır:
`LOCAL_STATIC`, `LOCAL_TEST`, `CI`, `STAGING`, `PRODUCTION`, `EXTERNAL_NOT_RUN`, `UNPROVEN`.
Local PASS staging kanıtı değildir. Secret değerleri bu dosyaya yazılmaz; yalnız ad ve saklama yeri.

## Ortam notları

- `.codex/config.toml` kullanıcıya ait commit'lenmemiş değişiklik taşır (`network_access = true`).
  Bu nedenle çalışma ağacında `pnpm agents:check` kırmızıdır; committed config ile temiz worktree'de
  koşulur ve PASS verir. Dosya hiçbir gate'te commit'lenmez.
- Docker bu makinede yok: Linux golden'ları `EXTERNAL_NOT_RUN`.

## Gate durumu

| Gate | Branch | Durum | PR |
|---|---|---|---|
| G0 Plan ve karar kayıtları | `berrak/g0-plan-kararlar` | Tamam | 4rmus/o-okul#109 |
| G1 Platform sağlık yüzeyleri | `berrak/g1-platform-saglik` | Tamam | draft PR |

## G0 — Plan ve karar kayıtları

- Hedef: Planı `docs/ui-ux-berrak-redesign-plan.md` olarak repoya koy; DEC-20260930-01/-02/-03
  yaz; ADR-0005'e runtime manifest notu ekle; UI/UX sözleşmesine "Berrak ile değişti" bölümü ekle.
- Sahip olunan yollar: `docs/**`.
- Yasak yollar: kod (`apps/**`, `packages/**`, `scripts/**`).
- Kabul: `pnpm agents:check`, `pnpm ui-ux-professionalization:completion:contract`.
- Doğrulama: yukarıdakiler + `pnpm ui-ux-redesign:local-gates`, `pnpm route-manifest:check`.

### G0 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `pnpm agents:check` (committed config, temiz worktree), `pnpm ui-ux-professionalization:completion:contract`, `pnpm route-manifest:check` (87 route) |
| `LOCAL_TEST` | PASS: `pnpm ui-ux-redesign:local-gates` (visual QA 31/31) |
| `CI` | PR CI'da izlenir |
| `STAGING` / `PRODUCTION` | `EXTERNAL_NOT_RUN` (yalnız doküman) |

Review (`o-okul-pr-review`, read-only): yalnız doküman değişikliği; P0/P1 bulgu yok.
Görsel kanıt: ekran değişmedi, gerekmez.

## G1 — Platform sağlık yüzeyleri (§10, DEC-20260930-02)

- Hedef: `/kurum/sistem-sagligi` ve `/kurum/gozlemlenebilirlik` tenant düzleminden emekli ve
  `/kurum/operasyon-ve-kanit`'e yönlenir; `/sistem/sistem-sagligi` canlı `/health` + `/health/ready`
  kartlarını alır (metrik kartı yok); `/sistem/gozlemlenebilirlik` izleme kabul maddelerini alır;
  `/metrics` dev rewrite'ı silinir; `/metrics` için `METRICS_SCRAPE_TOKEN` bearer guard'ı ve
  Prometheus bearer scrape; regresyon assert'i.
- Sahip olunan yollar: `kurum/sistem-sagligi`, `kurum/gozlemlenebilirlik`, `sistem/sistem-sagligi`,
  `sistem/gozlemlenebilirlik`, `_shared/navigation.ts`, `next.config.mjs`, route manifest + smoke
  spec, `scripts/check-route-manifest.mjs`, ilgili e2e spec'ler, `check-web-ux-baseline.mjs` pin'leri,
  `scripts/check-docker-config.mjs` (statik güvenlik assert'i), `apps/api/src/metrics/*`,
  `apps/api/src/app.module.ts` (middleware istisnası), Traefik/observability compose,
  `docker/prometheus/prometheus.yml`, `.env.example`, `staging-deploy.yml` ve bağlı staging/prod env
  sözleşme script'leri.
- Yasak yollar: diğer API modülleri; secret değerleri.
- Kabul: `route-manifest:check`, `web:architecture:check`, `docker:check` (Traefik/Next `/metrics`
  assert'i), `security:audit:check`, ilgili e2e spec'ler.

### G1 notları

- Plan §10 düzeltmesi: metrikler prod'da `/api/v1/metrics` altındaydı ve Traefik `/api` kuralıyla
  dışarı açıktı. Guard + Traefik `!PathPrefix(`/api/v1/metrics`)` ile kapatıldı (DEC-20260930-02'ye
  işlendi). Statik assert `scripts/check-docker-config.mjs` içinde (`pnpm run ci` → `docker:check`);
  `security:audit:check` bir kanıt-dosyası doğrulayıcısı olduğu için statik assert oraya konmadı.
- `RequestContextMiddleware` yalnız `GET metrics` için hariç tutuldu; scrape bearer'ı kullanıcı
  JWT'si olarak doğrulanmıyor. Production'da token yoksa guard fail-closed.
- Secret: `STAGING_METRICS_SCRAPE_TOKEN` — GitHub `staging` environment secret'ı (`openssl rand -hex 32`
  ile üretildi, `gh secret set` ile yazıldı). Deploy bunu alertmanager secret arşiviyle taşır,
  Prometheus için `prometheus_secrets` volume'üne ve API için uzak `.env.release`
  (`METRICS_SCRAPE_TOKEN`, mod 600) içine yazar.
- Config: `METRICS_SCRAPE_TOKEN` (`.env.example`, `docker-compose.yml` api env, prod env sözleşmesi).
- Route sayısı 87 → 85 (iki emekli route); smoke spec ve UX baseline sayıları buna göre güncellendi.
- Önceden var olan kırmızı: `login-next` içinde "kurum paneline geçer" (komut paleti "denetim"
  araması) ve "rol portalları bağlı kişi verisini gösterir" (çıkışta `/giris`) `main`'de de yerelde
  kırmızı; G1 değişikliğinden bağımsız. G1'in değiştirdiği adımlar geçiyor.

### G1 kanıt

| Sınıf | Sonuç |
|---|---|
| `LOCAL_STATIC` | PASS: `route-manifest:check` (85 route), `web:architecture:check`, `web:ux-baseline:check`, `docker:check` (+ negatif senaryo: Traefik kuralı geri alınınca kırmızı), `ops:check`, `prod:evidence:templates:check`, `check-prod-env --contract .env.example`, `security:audit:check` (örnek kanıt), `openapi:generate`, web/api typecheck |
| `LOCAL_TEST` | PASS: `@o-okul/api test` (1275), governance + system-tenant + route-family smoke + app-context e2e, `ui-ux-redesign:local-gates` (visual QA 31/31) |
| `CI` | PR CI'da izlenir |
| `STAGING` | `EXTERNAL_NOT_RUN` (secret yazıldı; deploy son gate sonunda) |
| `PRODUCTION` | kapsam dışı |

Görsel kanıt: `artifacts/ui-ux-redesign/berrak/g1/{before,after}/` (375/1440, açık tema).

Review (`o-okul-pr-review` + `tenant_security_reviewer`, read-only): P0/P1 yok. İki P2 gate içinde
düzeltildi (release env dosyası `umask 077` ile oluşturulur; token karakter kümesi
`[A-Za-z0-9._~-]{32,}`). Açık kalan düşük önemli bulgular:
- P2: bu değişiklikten önceki bir API image'ına rollback edilirse eski image scrape bearer'ını JWT
  sanıp 401 döner; rollback süresince metrikler kör kalır.
- P3: Traefik `PathPrefix` büyük/küçük harf duyarlı; `/api/v1/Metrics` API'ye ulaşır (guard 401
  döner, yalnız bir savunma katmanı eksik).
- P3: `NODE_ENV` production dışı ve token yoksa guard açık kalır (Traefik hariç tutması geçerli).
- Test boşlukları: redirect status'ü (`permanent: false`) için test yok; controller seviyesinde
  prod+token-yok testi yok (fonksiyon testi var).
