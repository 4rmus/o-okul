# Almanak 2.0 Sentetik Tenant Temizlik ve Yayın Kanıtı

Tarih: 23–24 Ağustos 2026
Ortam: `o-okul.com` canlı veritabanı
Güncel çalışan image: `ce321b9274703e4c99c5d92893144353a6251b9f`
Sonuç: `PASS`
Kanıt sınıfı: `PRODUCTION_DB_RUNTIME` + `STAGING_DEPLOY` + `STAGING_RUNTIME`

Bu kayıt, ürün/veri sahibinin açık onayıyla daha önce kapatılan 11 sentetik tenantın yedeksiz
fiziksel temizliğini belgeler. Ham tenant kimliği, slug, kurum adı, kullanıcı adı, e-posta veya kişi
verisi taşımaz.

## Silme öncesi doğrulama

- Aday sayısı tam `11`; aday küme özeti `93f97738c14146381082aff2188a0ee4`.
- Her adayda tek kullanıcı vardır ve hesap durumu `DISABLED`dır.
- Hesapların gerçek kişiye değil Gate D onboarding denemelerine ait sentetik hesaplar olduğu
  `docs/almanac-2-gate-d-evidence.md` içindeki exact-SHA runtime kaydıyla sınıflandırılmıştır.
- Aktif kullanıcı ve aktif/geçerli oturum sayısı `0`; bulunan 5 tarihsel oturumun tamamı
  `REVOKED`dır.
- Öğrenci, guardian, StudentContact ve WhatsAppConsentEvent sayıları `0`dır.
- 11 SecretDeliveryOutbox kaydının 10'u `DELIVERED`, 1'i `FAILED`; tümünde şifreli payload
  temizlenmiştir.
- İlişkili tablo sayımları ve `Tenant` dış anahtarlarının silme davranışı doğrulanmıştır.

## Uygulanan işlem

- Önce aynı transaction bir prova olarak çalıştırılıp `ROLLBACK` edildi:
  `DRY_RUN_VERIFIED`, 11 aday, 67 korunacak denetim kaydı, 6 etkilenmeyecek tenant.
- Kalıcı transaction aynı aday sayısı, küme özeti, hesap/oturum durumu, kişi verisi yokluğu ve
  bağımlı tablo sayıları değişmedikçe fail-closed çalışacak şekilde uygulandı.
- Tenant dış anahtarı olmayan 11 terminal SecretDeliveryOutbox satırı açıkça silindi.
- 11 tenant ve yalnız bu tenantlara bağlı satırlar cascade ile silindi.
- 67 mevcut AuditLog satırı korundu ve `tenantId` alanı `NULL` oldu.
- PII içermeyen bağımsız `tenant.synthetic_purged` AuditLog kaydı yazıldı; kayıt kimliği özeti
  `5604c29d2b4f`.
- Kullanıcı kararı gereği backup alınmadı (`backupUsed=false`).

## Denetim sınıflandırması

- AuditLog satırları append-only bırakıldı; geçmiş kayıtların `diff` gövdeleri değiştirilmedi.
- Canlı salt-okunur sınıflandırma `227` toplam kayıt, `55` tenant bağlı kayıt ve `172` null-tenant
  kayıt buldu.
- Null-tenant dağılımı: `system=72`, `deletedTenant=100`, `unknown=0`.
- 67 yeni null-tenant satırı, 11 `tenant.created` kökü ve bunların `accountId` zinciriyle exact
  eşlendi. Diğer deletedTenant satırları silinmiş tenant-domain actor; system satırları mevcut sistem
  hesabı veya tenant-domain izi olmayan auth-only eski sistem actor kuralıyla ayrıldı.
- Kalıcı kanıt `/root/o-okul/artifacts/production/reports/audit-null-tenant-20260823.json` yolunda;
  SHA-256 `c7c34f1abfe936cdbd42b3b43b26486accabdcacd646b422f1b3cc56a369625d`.
- `AUDIT_NULL_TENANT_EVIDENCE_TARGET=file:///root/o-okul/artifacts/production/reports/audit-null-tenant-20260823.json pnpm audit-null-tenant:check`
  sonucu `PASS`.

## 24 Ağustos ownerless test tenant temizliği

- İlk exact-SHA deploy `32650654848`, account-management backfill içinde 6 aktif tenantın 3'ünde
  `TENANT_OWNER` olmadığı için `OWNER_VERIFICATION_REQUIRED` ile fail-closed durdu. Image aktivasyonu
  ve evidence işi yapılmadı; dört servis `8a3ec5e...` üzerinde sağlıklı kaldı.
- Ürün/veri sahibinin açık onayıyla yalnız 15–16 Ağustos test koşularında oluşturulan, test adı
  işareti taşıyan, aktif owner ve geçerli aktif oturumu olmayan 3 tenant seçildi. Aday küme özeti
  `21b80916e9c82446a9e5e50b5d6942ca`.
- Adaylarda 10 hesap, 10 membership, süresi dolmuş 2 session, 3 sentetik öğrenci, 2 sentetik
  Guardian ve 2 sentetik StudentContact bulunuyordu. Preflight guardian sınıflandırması
  `FIXTURE_ONLY`; SecretDeliveryOutbox ve WhatsAppConsentEvent sayıları `0`dı.
- Bağlı fixture envanteri ayrıca 2 ödeme planı/taksit/transaction, 2 destek kaydı/eki/yorumu,
  2 ödev/materyal/dosya/atama, 3 raw import ve 3 report snapshot içeriyordu. Bu satırlar exact
  test-marker tenant FK grafiğindeydi ve tenant cascade ile temizlendi.
- Aynı silme önce transaction içinde uygulanıp `DRY_RUN_VERIFIED` sonrasında `ROLLBACK` edildi:
  3 aday, 2 korunacak AuditLog, 3 etkilenmeyecek tenant.
- Kalıcı transaction tam aday sayısı/küme özeti, owner yokluğu, geçerli aktif oturum yokluğu ve
  bağımlı tablo sayıları değişmedikçe fail-closed çalıştı. 3 tenant ve yalnız bağlı sentetik grafiği
  silindi; 2 AuditLog korundu ve PII içermeyen `tenant.ownerless_test_purged` kaydı yazıldı.
- Cleanup zamanı `2026-08-24 16:09:17 UTC`, audit kimliği özeti `16073e792423`; kullanıcı kararı
  gereği backup alınmadı.
- Silme sonrası `system=1`, non-system tenant `3`, ownerless tenant `0`, owner-backed tenant `3`,
  yetim outbox `0`; kalan tenant küme özeti `9f5deeb0b91a10339e084cf284d9265a`.
- Nesne depolama preflight'ı mevcut tenant kimliğiyle eşleşmeyen yalnız 2 raw-import nesnesi buldu:
  toplam `3.838` bayt, korunacak nesne `0`. Exact raw-import prefix'i yedeksiz silindi; sonrasında
  bucket nesne sayısı `0` olarak doğrulandı. Ham object key kanıta yazılmadı.
- Exact `ce321b927...` API image'ıyla dry-run backfill `READY`: activeTenants/existingOwners `3/3`,
  missing `0`, plannedWrites `0`, blockers/gaps `[]`.

## Güncel denetim sınıflandırması

- İkinci temizlikten sonra canlı salt-okunur sınıflandırma `228` toplam, `53` tenant bağlı ve
  `175` null-tenant AuditLog buldu.
- Null-tenant dağılımı: `system=72`, `deletedTenant=103`, `unknown=0`.
- AuditLog append-only bırakıldı. Kalıcı kanıt
  `/root/o-okul/artifacts/production/reports/audit-null-tenant-20260824.json` yolunda;
  SHA-256 `bb56be0d95c83f6576450c4c091ee5a10eed39ae19a36ab378a2ae917570413d`.
- `pnpm audit-null-tenant:check` sonucu `PASS`; 23 Ağustos artifact'i tarihsel ilk temizlik
  checkpoint'i olarak kalır.

## PR #79 ve exact-SHA yayın

- PR #79 exact source `1619bd32d...`, üç PR CI işi `PASS`; squash merge
  `ce321b9274703e4c99c5d92893144353a6251b9f`.
- Source ve squash-merge ağaçları eşdeğer; main CI `32649882436` üç işte `PASS`.
- Başarılı workflow dispatch `32749363674`, release image tag `ce321b927...` ve rollback image tag
  `8a3ec5e640f4e29d66a6ad66d869d8159e1e021e` ile çalıştı.
- Account-management backfill `PASS/APPLY`: activeTenants/existingOwners `3/3`, missing `0`,
  tenantAccounts `7/7`, memberships `6/6`, blockers/gaps `[]`.
- Deployment cutover artifact'i `PASS`; web, API, worker ve queue-board image'ları exact
  `ce321b927...`.
- Traefik HTTPS, alert webhook, WAL archive smoke ve first-gates manifest `PASS`, gaps `[]`.
- Public `/health`, `/health/ready`, `/login`, `sistem.o-okul.com/giris` ve tenant `/giris` HTTP
  `200`; legacy `/k/{slug}/giris` HTTP `307` ve location exact tenant `/giris`.

## Silme sonrası doğrulama

- `system` tenant sayısı `1`.
- İlk temizlik sonrasında non-system tenant sayısı `6`; ikinci temizlik/yayın sonrasında `3`.
- Silinen zaman aralığında kalan tenant sayısı `0`.
- Yetim SecretDeliveryOutbox satırı sayısı `0`.
- `https://o-okul.com/health`, `/health/ready` ve `/login` HTTP `200`.
- İlk temizlik deploy değildi; 24 Ağustos exact-SHA zinciri sonrasında dört servis
  `ce321b927...` image ailesinde çalışır.

## Kapsam dışı

- Sistem tenantı ve platform/system admin verisi.
- Kalan, owner-backed 3 tenant ve bunlara bağlı tüm kayıtlar.
- Ürün içinde hâlâ aktif olan Guardian/GuardianStudent modeli ve yüzeyleri.
- Gate F pilot başlangıcı ve production go-live kararı.
- Korunan audit kayıtlarının nihai saklama/imha süresi; privacy/go-live kararı olarak açıktır.
