# Almanak 2.0 Gate C İlk Dikey Dilim Kanıtı

> Tarihsel not: Bu kanıt `web.shell-v2` rollout dönemine aittir. 23 Ağustos 2026'da yeni shell
> kanonik hale getirilmiş ve `web.shell-v2`/`web.ia-v2` katalogdan kaldırılmıştır.

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

### 2026-11-02 güncellemesi: DEC-20261102-03

Yukarıdaki "operasyon çalışanı workspace'e yönlendirilmez" maddesi bu kayıtla daralan biçimde değişir:

- Tenant geneli OPERATIONS_STAFF (STAFF personası, üyelik kapsamı `TENANT`, `academic:manage`) sınav
  çalışma alanını, `GET /exams/:id/workspace` ucunu ve katılımcı, cevap anahtarı, optik yükleme,
  değerlendirme ve rapor adımlarını kullanır. Capability matrisi değişmez.
- Katılımcı ekleme ve sınıfla katılımcı yazımı için sınav servisinde sınava özel bir kural vardır.
  OPERATIONS_STAFF paylaşılan öğretmen ataması baypasına (`canBypassTeacherAssignment`) eklenmez; yoklama,
  ödev, not defteri, öğretmen notu, gelişim ve veli yollarının kapsamı genişlemez.
- Kampüs kapsamlı OPERATIONS_STAFF sınav servislerinden 403 ile dışarıda kalır. Kapsamı olmayan STAFF
  oturumu, rol önizlemesi ve OPERATIONS_STAFF+TEACHER çift rollü kullanıcı workspace'e alınmaz; çift rollü
  kullanıcının öğretmen atamasıyla daralan okumaları ayrı bir güvenlik dilimidir.
- Web oturumu kampüs kapsamı taşımadığından web kuralı rol/persona ile açar; kampüs kapsamlı üyelikte
  API 403 döner ve çerçeve nötr başlıkta kalır.
- `POST /exams` sınıf listesiyle çağrıldığında sınıflar ve çağıranın katılımcı kapsamı yazımdan önce
  doğrulanır; katılımcı ekleyemeyecek çağıran için sınav oluşturulmaz ve denetim kaydı yazılmaz.
  `PATCH /exams/:id` aynı ön doğrulamayı uygular.
- Kanıt: `apps/api/src/exam/exam.controller.e2e.test.ts`, `answer-key.controller.e2e.test.ts`,
  `raw-import.controller.e2e.test.ts`, `apps/api/src/report/report-generation.controller.e2e.test.ts`,
  `apps/api/src/rbac/capability-access.e2e.test.ts`, `gate-c-exam-workspace-next.spec.ts` ve
  `exam-workspace-consolidation-next.spec.ts` (LOCAL_TEST; Playwright doğrulaması ayrı aşamada).

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
