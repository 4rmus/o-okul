# Almanak 2.0 Gate E Yerel İlerleme Kanıtı

## Seçilen dilim

Gate E içindeki ilk eksik ürün dilimi `TP-01` öğretmen günlük özetidir.
`GET /api/v1/me/teacher/daily-brief?date=YYYY-MM-DD` öğretmenin gün içi ders, yoklama, ödev, destek ve
son hazır rapor durumunu tek read modelde toplar. Öğretmen portalı bu read modeli yalnız
`web.teacher-portal-v2` tenant rollout'u açıkken overview yüzeyinde kullanır.

Flag yoksa, süresi dolmuşsa veya rollout çözümü hata verirse mevcut öğretmen portalı korunur.
Rollout açık overview ayrıntı listelerini indirmez; en fazla üç öncelikli aksiyon gösterir. Alt
rotalar mevcut scoped endpointlerini kullanmaya devam eder.

## Güvenlik ve veri sınırı

- Endpoint yalnız gerçek veya read-only preview `TEACHER` subject contextinde çalışır; tenant admin,
  öğrenci ve system admin `403` alır.
- Tenant query override'ı aktif request contextini değiştirmez; bypass context fail-closed reddedilir.
- Altı mevcut tenant/assignment-aware servis birer kez ve paralel çağrılır; N+1 sorgu, yeni tablo,
  migration veya yazma işlemi yoktur.
- Yanıt kişi adı, öğrenci/öğretmen/tenant/requester kimliği, telefon, e-posta, TCKN, destek mesajı
  veya ödev içeriği taşımaz.
- Tarih strict ISO günüdür; geçersiz takvim tarihi `400 DAILY_BRIEF_DATE_INVALID` döndürür.
- Rollout default-off kalır; bu değişiklik hiçbir tenantı kendiliğinden aktive etmez.

## Yerel kanıt

- Daily brief unit ve route E2E: 2 dosya, 5 test `PASS`.
- API, web ve shared-types typecheck `PASS`.
- OpenAPI: 236 path ve daily brief PII-negatif response contract `PASS`.
- Öğretmen portalı browser sözleşmesi: 9 test `PASS`; rollout açık overview yalnız
  `/me/teacher/daily-brief` okur, flag kapalı akış korunur.
- Dedicated `NEXT_E2E_PORT=43121` ile fresh production build üzerinden mobil/masaüstü sözleşme
  çalıştırılmıştır.
- `NEXT_E2E_PORT=43125 pnpm run ci`: lint, typecheck, 1045 API testi, web sözleşmeleri, 84 rota,
  production build, 236 OpenAPI path ve 45 idempotent operation ile `PASS`.

Bu kanıt düzeyi `LOCAL_STATIC` ve mocked rollout kullanan tarayıcı yolu için `LOCAL_SYNTHETIC`tir.
`TP-01` yerel dilimi `LOCAL_SLICE_PASS` durumundadır.

## Gate E durumu

Gate E geneli henüz `PARTIAL`dır. Öğrenci daily brief (`SP-01`), portal/ops/control-plane staging
UAT, provider teslimi, backup/restore ve rollback tatbikatı, external monitoring ve exact-SHA UAT
artifact zinciri bu dilimin kapsamı dışındadır.

- Gerçek tenantta `web.teacher-portal-v2` activation/expiry/rollback: `EXTERNAL_NOT_RUN`
- Gerçek öğretmen görev gözlemi ve ürün metriği: `EXTERNAL_NOT_RUN`
- Staging/prod deploy veya provider mutation: `EXTERNAL_NOT_RUN`

Bu dış kanıtlar tamamlanmadan Gate E `Pilot Ready`, production rollout veya kullanıcı başarısı
olarak işaretlenemez.
