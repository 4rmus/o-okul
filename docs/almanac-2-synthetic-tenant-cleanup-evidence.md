# Almanak 2.0 Sentetik Tenant Temizlik Kanıtı

Tarih: 23 Ağustos 2026 15:01:49 UTC
Ortam: `o-okul.com` canlı veritabanı
Çalışan image: `8a3ec5e640f4e29d66a6ad66d869d8159e1e021e`
Sonuç: `PASS`
Kanıt sınıfı: `PRODUCTION_DB_RUNTIME`

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

## Silme sonrası doğrulama

- `system` tenant sayısı `1`.
- Kalan non-system tenant sayısı `6`; küme özeti `c8ff8a961690a413f1a258c7cdfe83ce`.
- Silinen zaman aralığında kalan tenant sayısı `0`.
- Yetim SecretDeliveryOutbox satırı sayısı `0`.
- `https://o-okul.com/health`, `/health/ready` ve `/login` HTTP `200`.
- Web, API, worker ve queue-board aynı `8a3ec5e...` image ailesinde çalışmaya devam etti; bu işlem
  bir uygulama deploy'u değildi.

## Kapsam dışı

- Sistem tenantı ve platform/system admin verisi.
- Kalan 6 tenant ve bunlara bağlı tüm kayıtlar.
- Ürün içinde hâlâ aktif olan Guardian/GuardianStudent modeli ve yüzeyleri.
- PR #79 merge/deploy ve Gate F pilot başlangıcı.
- Korunan audit kayıtlarının nihai saklama/imha süresi; privacy/go-live kararı olarak açıktır.
