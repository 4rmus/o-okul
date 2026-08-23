# Almanak 2.0 Legacy Temizlik Envanteri

Tarih: 23 Ağustos 2026

Bu envanter `DEC-20260823-01` kararını uygular: yeni ürün yapısı kanoniktir, eski ürüne geri dönüş
yapılmaz. Temizlik küçük dilimlerle ilerler; mevcut kayıtlar yeni yapıya taşınmadan fiziksel veri
silinmez. Ürün/veri sahibinin ayrı ve açık onayıyla, kişi verisi taşımadığı canlı sayımla doğrulanan
sentetik tenant kümesi bu genel kuralın tek seferlik istisnası olarak temizlenmiştir.

## Durum

| Alan | Durum | Aktif bağımlılık | Sonraki güvenli işlem |
|---|---|---|---|
| `/kurum/uat-rollback` ekranı | `REMOVED_LOCAL_TESTED` | Yok; UAT sözleşmesi belge, template ve checker ile doğrulanıyor | CI; staging/production `EXTERNAL_NOT_RUN` |
| `/kurum/operasyon-ve-kanit` | `CANONICAL` | Yetkiye göre yedek, güvenlik, sağlık ve yayın araçlarını listeliyor | Korunur |
| Eski `/k/{tenantSlug}/giris` yolu | `CONSUMERS_MIGRATED_LOCAL_TESTED` | Yalnız 30 günlük geçiş uyumluluğu, route envanteri ve doğrudan uyumluluk testi kullanıyor | CI ve gerçek tenant hostunda `307/410` kanıtı; kesim tarihinden sonra route kaldırma |
| Eski kurum navigasyonu | `REMOVED_LOCAL_TESTED` | Yok; yedi gruplu yeni navigasyon kanonik | CI; staging/production `EXTERNAL_NOT_RUN` |
| `web.ia-v2` / `web.shell-v2` bayrakları | `REMOVED_LOCAL_TESTED` | Shell artık rollout cevabına bağlı değil | Eski config anahtarları fail-closed reddedilir; staging env preflight `EXTERNAL_NOT_RUN` |
| Önceki 11 sentetik tenant | `REMOVED_PRODUCTION_DB_RUNTIME_VERIFIED` | Yok; aktif kullanıcı/oturum ve öğrenci/veli/contact verisi `0` | Audit null-tenant kanıtı `PASS`; tekrar işlem yapılmaz |
| Guardian/veli ekranları | `ACTIVE_TRANSITION` | Portal, destek, duyuru, rapor ve ödeme akışları kullanıyor | Önce StudentContact/self-service hedefi ve veri taşıma planı |
| `Guardian` / `GuardianStudent` veri yapıları | `ACTIVE_DATA` | API, RLS, rapor, destek ve portal ilişkileri kullanıyor | Tenant bazlı sayım, yeni modele taşıma, doğrulanmış yedek; sonra migration |
| Legacy `SYSTEM_ADMIN` tenant erişim kalıntıları | `PARTIAL_SECURITY_DEBT` | Bazı route ve rol uyumluluk testleri sürüyor | Route ailesi bazında exact capability/control-plane kesimi |

## Güncel dilimin sınırı

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
