# Almanak 2.0 Legacy Temizlik Envanteri

Tarih: 23 Ağustos 2026

Bu envanter `DEC-20260823-01` kararını uygular: yeni ürün yapısı kanoniktir, eski ürüne geri dönüş
yapılmaz. Temizlik küçük dilimlerle ilerler; mevcut kayıtlar yeni yapıya taşınmadan fiziksel veri
silinmez.

## Durum

| Alan | Durum | Aktif bağımlılık | Sonraki güvenli işlem |
|---|---|---|---|
| `/kurum/uat-rollback` ekranı | `REMOVED_LOCAL_TESTED` | Yok; UAT sözleşmesi belge, template ve checker ile doğrulanıyor | CI; staging/production `EXTERNAL_NOT_RUN` |
| `/kurum/operasyon-ve-kanit` | `CANONICAL` | Yetkiye göre yedek, güvenlik, sağlık ve yayın araçlarını listeliyor | Korunur |
| Eski `/k/{tenantSlug}/giris` yolu | `ACTIVE_LEGACY` | Parola sıfırlama, onboarding ve canlı UI testleri hâlâ bu yolu kullanıyor | Canlı kullanım ve host geçişi doğrulanmadan kaldırılmaz |
| Eski kurum navigasyonu | `REMOVED_LOCAL_TESTED` | Yok; yedi gruplu yeni navigasyon kanonik | CI; staging/production `EXTERNAL_NOT_RUN` |
| `web.ia-v2` / `web.shell-v2` bayrakları | `REMOVED_LOCAL_TESTED` | Shell artık rollout cevabına bağlı değil | Eski config anahtarları fail-closed reddedilir; staging env preflight `EXTERNAL_NOT_RUN` |
| Guardian/veli ekranları | `ACTIVE_TRANSITION` | Portal, destek, duyuru, rapor ve ödeme akışları kullanıyor | Önce StudentContact/self-service hedefi ve veri taşıma planı |
| `Guardian` / `GuardianStudent` veri yapıları | `ACTIVE_DATA` | API, RLS, rapor, destek ve portal ilişkileri kullanıyor | Tenant bazlı sayım, yeni modele taşıma, doğrulanmış yedek; sonra migration |
| Legacy `SYSTEM_ADMIN` tenant erişim kalıntıları | `PARTIAL_SECURITY_DEBT` | Bazı route ve rol uyumluluk testleri sürüyor | Route ailesi bazında exact capability/control-plane kesimi |

## Bu dilimin sınırı

- Yalnız `/kurum/uat-rollback` sayfası, navigasyon kaydı, route manifest girdisi ve doğrudan testleri kaldırılır.
- UAT senaryo matrisi, UAT checker/template, restore ve forward-only deployment continuity kanıtları korunur.
- API, veritabanı, migration, tenant verisi ve canlı ortam değişmez.

## Fiziksel veri temizliği koşulu

Bir tablo veya kolon ancak aşağıdakiler aynı dilimde kanıtlandığında kaldırılır:

1. Aktif okuyucu/yazıcı kalmamıştır.
2. Tenant bazlı eski/yeni kayıt sayımları eşleşir.
3. Yanlış tenant erişimi negatif testle reddedilir.
4. Doğrulanmış yedek ve geri yükleme kanıtı vardır.
5. Migration, RLS, seed ve veri kanıtı birlikte güncellenir.

Bu maddeler ek bir ürün gate'i değil, geri dönüşsüz veri değişikliğinin kabul kriterleridir.
