# O-Okul Durum

Son güncelleme: 2026-08-05
İnceleme snapshotı: `agent/tenant-subdomain-login` / `6f9c9cbce`; `origin/main` üç commit ileride
Kanıt düzeyi: kirli yerel çalışma ağacı; production teknik aktivasyonu canlı doğrulandı, tam go-live kanıtı tamamlanmadı

5 Ağustos 2026 ürün kararları: giriş kurum subdomaini + tenant-local kimliktir; guardian ürün
kapsamından çıkarılacaktır; hukuk/KVKK incelemesi bu fazda repo uygulamasını ve pilot hazırlığını
bloklamaz ancak production purge/go-live için hukuk kanıtı sayılmaz. Kapasite tenant başına 2.000
aktif çalışan hesabı runtime üst sınırı ve 1.000 çalışan yük kabul hedefi olarak netleştirilmiştir.

Bu dosya tamamlanan işleri, açık işleri ve release kanıt seviyesini tek yerde tutar. Tarihsel
planlar ve faz günlükleri kaldırılmıştır; güncel ürün kapsamı ve release sözleşmeleri aşağıdaki
kanonik dosyalardadır.

## Doğruluk Hiyerarşisi

1. Çalışan kod, Prisma şeması, migration ve testler.
2. `AGENTS.md` ve makine tarafından denetlenen repo sözleşmeleri.
3. `docs/DECISIONS.md` ve `docs/product-journeys-v1.md`.
4. Bu dosya ve `docs/llm-wiki/README.md`.
5. `docs/phase-6-production-readiness.md` ile `docs/phase-6-ops-runbook.md`.

Yerel `PASS`, staging veya production kanıtı sayılmaz. Canlı durum yalnız SHA, image etiketi,
ortam ve tarih içeren kalıcı evidence ile yükseltilir.

## Tamamlanan İşler

- Kullanıcı tarafından iptal edilen dört ürün kapsamı uygulama, shared type, OpenAPI, runtime
  ayarı, evidence zinciri ve aktif dokümanlardan çıkarıldı.
- Eski ana plan, modernizasyon/UI planları, `claudedocs` arşivi, faz checklist ve faz raporları
  kaldırıldı. Aktif release sözleşmeleri ve dar teknik kontratlar korundu.
- Rapor üretim anahtarı istemciden kaldırıldı. API sınav/rapor/filtre kapsamını, worker ise gerçek
  sonuç anahtarları ile answer-key/parser/engine sürümlerini SHA-256 kimliğine katar. Aynı gerçek
  girdi aynı snapshotı, değişen sonuç içeriği veya sürümü yeni snapshotı üretir.
- Zorunlu admin MFA için kısa ömürlü enrollment yanıtı ve doğrulama endpoint'i eklendi. Normal
  oturum TOTP doğrulamasından önce üretilmiyor; etkinleştirme atomik koşulla tekrar tüketime kapalı.
  Üyelik sürümü Prisma şeması ve migration ile kalıcılaştırıldı.
- KVKK öğrenci/öğretmen envanteri, ham değerleri döndürmeden TCKN, telefon, e-posta ve fotoğraf
  varlığını kategori olarak izler; purge alanları ve audit örneklemiyle hizalıdır.
- `withBypassRlsQuery` kullanımları dosya ve fonksiyon bazlı allowlist ile fail-closed denetleniyor.
- Karantina çözümleme işi tenant kapsamlı ve deterministik queue kimliği kullanıyor. Enqueue sonrası
  DB yazımı kesilirse retry aynı BullMQ işini hedefler; yeni genel outbox katmanı eklenmedi.
- SMS enqueue içeriği deterministik queue kimliği ve delivery report ile repo içi tekrarları
  sınırlar. Netgsm upstream idempotency anahtarı sunmadığı için provider çağrısı sonrası process
  çökmesi bakımından davranış `at-least-once` olarak kabul edilir; `exactly-once` iddiası yoktur.

## Production Teknik Aktivasyonu — 2026-08-05

- Mevcut sunucu kullanıldı; yeni VPS kurulmadı. `DOMAIN`, uygulama URL'leri, CORS ve Sentry ortam adı
  `o-okul.com` / `production` olarak aktive edildi.
- Web, API, worker ve queue-board aynı image SHA ile çalışıyor:
  `3e460783b35436dbd33dbc534ce57e2139d40f3f`. `/login`, `/health` ve `/health/ready` apex üzerinde
  `200`; wildcard host üzerinde `/health` ve `/health/ready` `200`, `/login` beklenen `307 /giris`.
- Cloudflare authoritative DNS üzerinde `*.o-okul.com A 212.108.107.190`, `DNS only`, TTL `Auto`
  kaydedildi. 1.1.1.1 ve 8.8.8.8 ilk sorguda aynı IP'yi döndürdü.
- Traefik/Let's Encrypt origin sertifikası `o-okul.com` ve `*.o-okul.com` SAN'larını içeriyor;
  geçerlilik sonu 3 Kasım 2026. API router'ın redundant ACME isteği giderildi.
- Kesim öncesi env, compose, ACME ve PostgreSQL yedeği
  `/root/o-okul-cutover-backups/20260805T161400Z` altında; checksum ve `pg_restore --list` kontrolü geçti.
- Bu teknik aktivasyon go-live onayı değildir. `pnpm prod:env:check` canlı sunucuda hâlâ `FAIL`:
  notification provider/inbox smoke, güvenli harici S3, Sentry, WAL/off-host backup, pull edilebilir image
  rollback hedefi, restore tatbikatı, alerting/external monitoring, RLS/MFA/UAT/pilot ve go-live evidence
  hedefleri tamamlanmalıdır.

## Silinen Tarihsel Kayıtlar

- Kök plan ve `claudedocs` altındaki tarihsel tasarım/uygulama planları.
- Tarihli development, architecture, modernization, assessment ve tam modül audit belgeleri.
- Faz 0-6 raporları ve faz 0-2/A-E checklist dosyaları.
- Eski UI rollout planı; aktif kabul ölçütleri `docs/ui-ux-professionalization-contract.md` içinde.

Korunan aktif sözleşmeler:

- `docs/DECISIONS.md`
- `docs/product-journeys-v1.md`
- `docs/phase-6-production-readiness.md`
- `docs/phase-6-ops-runbook.md`
- `docs/ui-ux-professionalization-contract.md`
- `docs/phase-b-list-query-contract.md`
- `docs/llm-wiki/README.md`

## Açık İşler

Güncel sıralama `docs/account-management-architecture-plan.md` bölüm 6 içindedir:

1. P0: iSEM producer/checker sayımları ve UI-worker credential sözleşmesini tekleştirme.
2. P0: rank tabanlı RBAC ile legacy system-admin tenant erişimini exact capability/control-plane modeline kesme.
3. P1: StudentContact, guardian emekliliği, offboarding/import/cursor ve outbox grant revoke dilimleri.
4. Canlı SHA için CI parity; uygulamanın ürettiği davet/reset e-postası için gerçek provider/inbox ve MFA;
   rol bazlı UAT; pull edilebilir image rollback/restore; izleme, pilot ve go-live.

Guardian fiziksel silme, grant revoke, production deploy veya go-live; ilgili teknik güvenlik kapıları
ve gerçek ortam kanıtı olmadan yapılamaz. Workspace mailbox/alias testi tamamlanmıştır; exact-SHA
uygulama-provider teslim testi yerine geçmez. Şablon veya statik checker sonucu canlı kanıt yerine kullanılamaz.

## Doğrulama

2026-08-05 plan kontrolü:

- `pnpm agents:check`, `pnpm product-journeys:check`, `pnpm prod:plan:check`: `PASS`.
- API ve web typecheck: `PASS`.
- `pnpm prod:evidence:templates:check`: örnek/template sözleşmesi `PASS`; canlı kanıt değildir.
- Production domain/DNS/TLS ve temel endpoint kontrolleri canlı `PASS`; `pnpm prod:env:check` canlı `FAIL`.
- Tam `pnpm run ci`, uygulama-provider inbox, restore, UAT, pilot ve production evidence gate'leri çalıştırılmadı.
- Çalışma ağacında kullanıcıya ait support/notification/UI değişiklikleri korunmuştur.

2026-07-13 yerel sonuçları:

- `pnpm run ci`: `PASS`.
- API: 115/115 test dosyası, 752/752 test.
- Worker: 33/33 test dosyası, 173/173 test.
- Web: 6/6 a11y, 1/1 backup/restore paneli, 85/85 UX sözleşme testi.
- DB/RLS: 57 tenant tablo, 100 composite tenant FK.
- OpenAPI: 207 path; output contract `PASS`.
- Idempotency: 43 operasyon; header ve response envelope sözleşmesi `PASS`.
- Agent, journey, ops, Docker, evidence template, lint, typecheck ve production build: `PASS`.
- Son tenant/güvenlik re-review: P0/P1/P2 bulgu yok.
- Hedefsiz canlı durum kontrolü: `0/17`; bu sonuç dış kanıt olmadığını gösterir.

Değişikliklerin zorunlu kapanış zinciri:

```sh
pnpm agents:check
pnpm product-journeys:check
pnpm prod:plan:check
pnpm prod:evidence:templates:check
pnpm ops:check
pnpm docker:check
pnpm --filter @o-okul/shared-types typecheck
pnpm --filter @o-okul/api test
pnpm --filter @o-okul/worker test
pnpm openapi:generate
pnpm --filter @o-okul/web typecheck
pnpm run ci
git diff --check
```

Sonuçlar ancak komutlar bu çalışma ağacında yeniden çalıştırıldıktan sonra `PASS` olarak yazılır.
