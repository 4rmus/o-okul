# Almanak 2.0 Legacy Temizlik Envanteri

Tarih: 24 Ağustos 2026

Bu envanter `DEC-20260823-01` kararını uygular: yeni ürün yapısı kanoniktir, eski ürüne geri dönüş
yapılmaz. Temizlik küçük dilimlerle ilerler; mevcut kayıtlar yeni yapıya taşınmadan fiziksel veri
silinmez. `DEC-20260823-02` kişi verisi taşımayan 11 sentetik tenantı; `DEC-20260824-01` ise exact
test-marker, `FIXTURE_ONLY`, owner/geçerli aktif session taşımayan 3 tenantı ayrı ve dar yedeksiz
istisnalar olarak kaydeder. Bu kararlar genel Guardian veya gerçek müşteri verisi silme izni değildir.

## Durum

| Alan | Durum | Aktif bağımlılık | Sonraki güvenli işlem |
|---|---|---|---|
| `/kurum/uat-rollback` ekranı | `REMOVED_STAGING_DEPLOY_VERIFIED_RUNTIME_UNPROVEN` | Yok; UAT sözleşmesi belge, template ve checker ile doğrulanıyor | Yetkili canlı route probe ayrı |
| `/kurum/operasyon-ve-kanit` | `CANONICAL` | Yetkiye göre yedek, güvenlik, sağlık ve yayın araçlarını listeliyor | Korunur |
| Eski `/k/{tenantSlug}/giris` yolu | `CONSUMERS_MIGRATED_STAGING_RUNTIME_VERIFIED` | Yalnız 30 günlük geçiş uyumluluğu, route envanteri ve doğrudan uyumluluk testi kullanıyor | Canlı `307` exact tenant `/giris`; kesim tarihinden sonra `410` ve route kaldırma |
| Eski kurum navigasyonu | `REMOVED_STAGING_DEPLOY_VERIFIED_RUNTIME_UNPROVEN` | Yok; yedi gruplu yeni navigasyon kanonik | Yetkili canlı UI probe ayrı |
| `web.ia-v2` / `web.shell-v2` bayrakları | `REMOVED_STAGING_DEPLOY_VERIFIED_RUNTIME_UNPROVEN` | Shell rollout cevabına bağlı değil | Yetkili canlı config probe ayrı |
| Önceki 11 sentetik tenant | `REMOVED_PRODUCTION_DB_RUNTIME_VERIFIED` | Yok; aktif kullanıcı/oturum ve öğrenci/veli/contact verisi `0` | Audit null-tenant kanıtı `PASS`; tekrar işlem yapılmaz |
| Ownerless 3 test tenant | `REMOVED_PRODUCTION_DB_RUNTIME_VERIFIED` | Yok; owner/geçerli aktif oturum `0`, fixture grafiği doğrulandı | Audit null-tenant `unknown=0`; tekrar işlem yapılmaz |
| Guardian/veli ekranları | `ACTIVE_TRANSITION` | Portal, destek, duyuru, rapor ve ödeme akışları kullanıyor | Önce StudentContact/self-service hedefi ve veri taşıma planı |
| `Guardian` / `GuardianStudent` veri yapıları | `ACTIVE_DATA` | API, RLS, rapor, destek ve portal ilişkileri kullanıyor | Tenant bazlı sayım, yeni modele taşıma, doğrulanmış yedek; sonra migration |
| Legacy `SYSTEM_ADMIN` tenant erişim kalıntıları | `PARTIAL_SECURITY_DEBT` | Bazı route ve rol uyumluluk testleri sürüyor | Route ailesi bazında exact capability/control-plane kesimi |

## Tenant giriş geçişi diliminin sınırı

- Parola sıfırlama, auth state, onboarding, ana giriş, erişilebilirlik ve canlı UI testleri kanonik
  `{tenantSlug}.{domain}/giris` adresine taşındı.
- Eski `/k/{tenantSlug}/giris` route'u 30 günlük geçiş uyumluluğu için korunur; gerçek alan adında
  kesim öncesi `307`, kesim sonrasında `410` davranışı yerel sözleşme testiyle doğrulanır.
- Web ve API, gelecekteki cutoff'u bugünden en fazla 30 günle sınırlar; daha uzak tarih fail-closed
  reddedilir. API istek sözleşmesi, veritabanı, migration, tenant verisi, DNS, secret ve canlı ortam
  değişmez.
- Route'un fiziksel olarak kaldırılması gerçek staging/canlı geçiş ve kesim tarihi kanıtından sonra
  ayrı bir dilimdir.

## Fiziksel veri temizliği koşulu

Bir tablo veya kolon ancak aşağıdakiler aynı dilimde kanıtlandığında kaldırılır:

1. Aktif okuyucu/yazıcı kalmamıştır.
2. Tenant bazlı eski/yeni kayıt sayımları eşleşir.
3. Yanlış tenant erişimi negatif testle reddedilir.
4. Doğrulanmış yedek ve geri yükleme kanıtı vardır.
5. Migration, RLS, seed ve veri kanıtı birlikte güncellenir.

Bu maddeler ek bir ürün gate'i değil, geri dönüşsüz veri değişikliğinin kabul kriterleridir.
23 Ağustos 2026 tarihli 11 sentetik tenant temizliği, ürün/veri sahibinin yedeksiz silme onayı,
exact aday sayısı/küme özeti, kişi verisi yokluğu, rollback edilen prova ve bağımsız AuditLog kaydıyla
dar bir istisnadır. Kanıt: `docs/almanac-2-synthetic-tenant-cleanup-evidence.md`.
24 Ağustos 2026 tarihli 3 tenant temizliği ise `DEC-20260824-01` ile exact test-marker ve
`FIXTURE_ONLY` grafiğe, owner/geçerli aktif session yokluğuna, rollback edilen provaya ve açık
yedeksiz onaya bağlı ikinci dar istisnadır. Finans/destek/ödev/raw-import fixture satırları ve 2
yetim raw-import nesnesi bu exact grafikte temizlenmiştir; başka tenant veya aktif Guardian verisine
genişletilemez.
