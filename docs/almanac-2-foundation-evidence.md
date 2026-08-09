# Almanak 2.0 Gate B Foundation Kanıtı

## Kapsam

Bu paket yalnız Gate B temelini kurar: kabul edilmiş mimari kararlar, aktif route/architecture
checker'ları, default-off tenant feature rollout sözleşmesi, PII-safe product event şeması ve yerel
sentetik ölçüm baseline'ı. Yeni shell, sınav çalışma alanı, analytics gönderimi veya tenant rollout'u
açılmaz.

Mevcut control-plane realm ayrımı ile legacy `SYSTEM_ADMIN` tenant-role borcu `PARTIAL`dır. Üç
salt sunum bileşeni için isimli architecture allowlist'i vardır; tenant auth/API/veri adapter'ı bu
allowlist'e dahil değildir. Bunların taşınması `UI-01`, realm/breakglass uygulaması `CP-01`
kapsamındadır.

## Yerel kapılar

```sh
pnpm web:architecture:check
pnpm route-manifest:check
pnpm feature-rollout:check
pnpm product-analytics-schema:check
pnpm web:measurement-baseline:check
```

Ölçüm artifact'i `docs/measurement-baselines/gate-b-local-synthetic.json` içindedir. Üç kritik görev
için sabit Chromium/viewport, mocked API, tek worker, sıfır retry ve görev başına beş ham örnek taşır.
Artifact `LOCAL_SYNTHETIC` ve `BASELINE_RECORDED` olarak etiketlenir; süre eşiği veya gerçek kullanıcı
performansı PASS iddiası değildir. Artifact base commit'i, kaynak worktree durumunu, ölçüm
harness/config/collector/checker kaynak digest'ini ve tek kullanımlık run kimliğini taşır. Toplayıcı
önce eski parçaları temizler ve farklı run parçalarını birleştirmez. Ölçüm modu dış base URL'leri
yok sayar; `43119` portunda server reuse kapalı olarak koşulsuz dedicated Next build çalıştırır.
Yeniden üretim komutu:

```sh
pnpm web:measurement-baseline:collect
```

## Rollout güven sınırı

Feature katalogundaki dokuz anahtar default-off'tur. Opsiyonel `FEATURE_ROLLOUTS_JSON` yalnız API
prosesinde okunur; bilinmeyen anahtar veya bozuk kayıt başlangıçta fail eder. Kayıtlar zorunlu
`FEATURE_ROLLOUT_ENVIRONMENT`, `tenantId`, `startsAt`/`expiresAt` ve PII içermeyen `reference`
taşır, en fazla 90 gün geçerlidir. Client
yalnız kendi tenant bağlamında çözülmüş `enabledFeatureKeys` değerini alır. Enabled exposure audit'i
yazılamazsa sonuç açılmaz. Flag, RBAC/RLS kontrolünün yerine geçmez.

## Dış kanıt durumu

- 5-8 gerçek kullanıcıyla görev gözlemi: `EXTERNAL_NOT_RUN`
- Staging/production RUM veya gerçek Core Web Vitals: `EXTERNAL_NOT_RUN`
- Staging/production tenant flag aktivasyonu, replica config parity ve rollback: `EXTERNAL_NOT_RUN`
- Analytics vendor transportu ve gerçek event teslimatı: `EXTERNAL_NOT_RUN`

Bu dış kanıtlar olmadan production rollout veya ölçülmüş kullanıcı başarısı iddiası yapılamaz.
