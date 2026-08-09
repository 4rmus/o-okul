# Almanak 2.0 Gate C İlk Dikey Dilim Kanıtı

Tarih: 2026-08-10
Branch: `agent/almanac-gate-a-local-20260809-2`
Başlangıç commit'i: `7e074e18905260b70f4abdaac95df0f6fe15e0af`
Kanıt düzeyi: `LOCAL_STATIC` ve `LOCAL_SYNTHETIC`
Dış durum: `EXTERNAL_NOT_RUN`

## Kapsam

Bu dilim Gate C'nin en küçük geri alınabilir dikey parçasıdır:

1. `web.shell-v2` ile tenant/session/persona bağlamında çözülen yedi gruplu kurum navigasyonu.
2. `web.exam-workspace-v2` ile açılan salt okunur sınav çalışma alanı.
3. Bayrak kapalı, bozuk yanıt veya rollout hatasında aynı sınava legacy dönüş.

Yeni yazma endpoint'i, DB migrationı, optik pipeline değişikliği, rapor üretim değişikliği veya gerçek
tenant aktivasyonu bu kapsamda değildir.

## Uygulama sözleşmesi

- API: `GET /api/v1/exams/:examId/workspace`; mevcut sınav ve katılımcı depolarından hazırlık adımları,
  sayısal katılımcı özeti ve sonraki önerilen işi üretir.
- Web: `/kurum/sinavlar/[examId]`; çalışma alanı yalnız sunucunun resolved rollout cevabından sonra
  istenir. Shell ve workspace rollout anahtarları query/localStorage ile açılamaz.
- Rollback: disabled/error/malformed rollout legacy shell'i korur; workspace request'i yapılmaz ve
  `examId` `/kurum/sinavlar?examId=...` üzerinde korunur.
- Runtime wiring: Compose API'ye yalnız `FEATURE_ROLLOUT_ENVIRONMENT` ve server-side
  `FEATURE_ROLLOUTS_JSON` geçirir. Tarayıcıya tenant allowlist veya public feature env verilmez.

## Güvenlik sınırı

- Controller `academic:manage` exact capability ister.
- Servis yalnız tenant sahibi/admin/assistant admin STAFF bağlamını kabul eder. Mevcut tek-rol legacy
  admin oturumu uyumluluk için staff kabul edilir; role-preview ve kampüs kapsamı yine reddedilir.
- Aynı ortak kural web linki, doğrudan route, workspace sorgusu ve API servisinde uygulanır;
  operasyon çalışanı ile TEACHER personasındaki çok-rol admin v2 workspace'e yönlendirilmez.
- Başka tenant sınavı 404 ile gizlenir. Öğretmen, öğrenci, veli ve sistem personaları 403 alır.
- Response öğrenci kimliği, participant numarası veya ham katılımcı listesi taşımaz.
- Bu workspace kampüs kapsamlı çalışana açılmaz. Önceden var olan kampüs kapsamlı rapor erişim borcu
  bu dilimin dışındadır ve kampüs pilotu/Gate D öncesi ayrı güvenlik kapısıdır.

## Yerel doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Workspace API e2e | `1 dosya / 26 test PASS` |
| Gate C Playwright rollout/rol/persona/legacy | `7 test PASS` |
| Gate C görünüm matrisi | `320 / 414 / 768 / 1024 / 1440 PASS` |
| UX sözleşmesi | `129 test PASS` |
| Route family smoke | `84 test PASS`; `82 route / 19 modül` |
| UI görsel sözleşmesi | `32 test PASS` |
| OpenAPI | `234 path PASS` |
| Measurement baseline | `3 görev x 5 örnek PASS`; `LOCAL_SYNTHETIC` |
| Docker/Compose | statik config `PASS` |
| Bağımsız güvenlik ve PR yeniden incelemesi | açık `P0/P1 yok` |
| Tam repo zinciri | `NEXT_E2E_PORT=43127 pnpm run ci PASS` |
| Diff whitespace | `git diff --check PASS` |

Port `43127`, çalışma ağacında önceden açık kalan port `3001` prosesini yeniden kullanmadan güncel Next
build'ini doğrulamak için seçildi. Bu yalnız test izolasyonudur.

## Dış kanıt durumu

Aşağıdakiler çalıştırılmadı ve bu yerel kapanış tarafından kanıtlanmış sayılmaz:

- GitHub Actions exact-SHA CI
- gerçek internal tenant allowlist/flag aktivasyonu
- staging deploy ve aynı-sınav parity/rollback kaydı
- gerçek kullanıcı UAT, RUM ve hata oranı
- pilot, production deploy veya go-live

Gate C kod ve yerel sözleşme düzeyinde hazırdır; tenant aktivasyonu için dış release kanıtı gerekir.
