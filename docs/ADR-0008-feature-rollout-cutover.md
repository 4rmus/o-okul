# ADR-0008: Feature Rollout ve Cutover

## Durum

Emekli (2026-10-04, DEC-20261004-01). Aşağıdaki karar tarihsel kayıttır; kodda rollout mekanizması yoktur.

## Karar

Almanak dönüşüm flag'leri kod sahibi, default-off bir katalogda tanımlanır. Tenant allowlist yalnız
sunucu ortamından okunur; kayıt environment + tenant + başlangıç + bitiş aralığına bağlıdır. Bilinmeyen
flag, eksik tenant/environment, hatalı konfigürasyon ve süresi dolmuş kayıt
fail-closed davranır. Client yalnız kendi tenantı için çözülmüş boolean sonucu görür; allowlist'i,
tenant kimliklerini veya config kaynağını görmez.

Gate B'de runtime config mutationı ve rollout DB tablosu yoktur. Audit, enabled exposure kaydıdır;
config değişikliği deploy/config yönetimiyle izlenir. Yönetim UI'sı veya control-plane mutationı
gerektiğinde actor modeli, atomiklik, RLS ve step-up ayrı ADR/dilimle ele alınır.

## Gerekçe

İlk internal tenant rollout'u için kalıcı bir yönetim sistemi kurmak gereksiz güvenlik ve migration
yüzeyi açar. Server-only allowlist kontrollü aktivasyon ve cutover ihtiyacını davranış açmadan karşılar.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: `pnpm feature-rollout:check`, API negatif testleri

## Sonuçlar

- Her flag owner, expiry ve removal issue taşır.
- İlk catalog flag'lerinin tamamı default-off'tur.
- Staging/production tenant aktivasyonu ayrı dış ortam kararı ve kanıtıdır.
- `web.ia-v2` ve `web.shell-v2`, 23 Ağustos 2026'da yeni kurum navigasyonu kanonik hale geldiği için katalogdan kaldırılmıştır.
- `web.exam-workspace-v2`, 30 Eylül 2026'da (Berrak G6) sınav çalışma alanı sunucu hazırlığıyla kanonik hale geldiği
  için katalogdan kaldırılmıştır (EX-02). Eski `/kurum/optik?examId=` ve `/kurum/raporlar?examId=` bağlantıları
  `next.config.mjs` yönlendirmeleriyle çalışma alanına gider.
- `web.student-registry-v2` (ST-01) ve `product.guardian-read-only` (IAM-04), 3 Ekim 2026'da DEC-20261003-01
  ile katalogdan kaldırılmıştır (KV-1). Registry/StudentContact yolu ve veli yazma yolları koşulsuzdur;
  bu anahtarları taşıyan `FEATURE_ROLLOUTS_JSON` API açılışında `UNKNOWN_KEY` ile reddedilir, deploy öncesi
  staging/prod config'inden çıkarılmalıdır.
- `web.teacher-portal-v2` (TP-02), `web.student-portal-v2` (SP-02) ve `web.control-plane-v2` (CP-02),
  4 Ekim 2026'da DEC-20261004-01 ile kaldırılmıştır. Üçünün de API veya web'de tüketicisi yoktu; öğretmen,
  öğrenci ve sistem route'ları zaten koşulsuzdu. Katalog boşaldığı için mekanizma da emekliye ayrıldı:
  `/me/feature-rollouts`, `FeatureRolloutService`, `feature-rollout:read` yetkisi, `feature_rollout_exposed`
  analytics olayı, `featureFlags` event alanı, `FEATURE_ROLLOUT_ENVIRONMENT`/`FEATURE_ROLLOUTS_JSON` ve
  `pnpm feature-rollout:check` silindi. Yeni bir kademeli açılış gerekirse bu ADR'nin kuralları (server-only
  allowlist, tenant + environment + süre, fail-closed, enabled exposure auditi) yeni bir DEC ile yeniden kurulur.
