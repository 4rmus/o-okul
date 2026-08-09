# Almanak 2.0 Gate E Yerel İlerleme Kanıtı

## Tamamlanan yerel dilimler

Gate E içindeki ilk ürün dilimi `TP-01` öğretmen günlük özetidir.
`GET /api/v1/me/teacher/daily-brief?date=YYYY-MM-DD` öğretmenin gün içi ders, yoklama, ödev, destek ve
son hazır rapor durumunu tek read modelde toplar. Öğretmen portalı bu read modeli yalnız
`web.teacher-portal-v2` tenant rollout'u açıkken overview yüzeyinde kullanır.

Flag yoksa, süresi dolmuşsa veya rollout çözümü hata verirse mevcut öğretmen portalı korunur.
Rollout açık overview ayrıntı listelerini indirmez; en fazla üç öncelikli aksiyon gösterir. Alt
rotalar mevcut scoped endpointlerini kullanmaya devam eder.

İkinci ürün dilimi `SP-01` öğrenci günlük özetidir. `GET /api/v1/me/student/daily-brief` öğrencinin
okunmamış duyuru, ödev ataması, devamsızlık/geç kalma, açık destek ve son hazır rapor durumunu
tek self-scoped read modelde toplar. Öğrenci portalı bu modeli yalnız `web.student-portal-v2`
rollout'u açık overview yüzeyinde kullanır. Rollout yoksa veya çözüm hata verirse mevcut öğrenci
portalı korunur; rollout açıkken ayrıntı listeleri indirilmez ve en fazla üç aksiyon gösterilir.

Üçüncü ürün dilimi `SP-02` öğrenci alt rotalarıdır. Rapor, ödev, devamsızlık ve destek sayfaları
yalnız görünür panelin mevcut self-scoped endpointlerini yükler. Alt rotalar overview rollout
çözümünü ve daily brief'i beklemez; rapor/ödev/destek sayfalarında kullanılmayan profil verisi
indirilmez. Devamsızlık sayfası görünür profil, yoklama özeti, öğretmen notu ve lookup bağlamını
korur. Bu daraltma yeni route, API, tablo veya mutation eklemez.

## Güvenlik ve veri sınırı

- Endpoint yalnız gerçek veya read-only preview `TEACHER` subject contextinde çalışır; tenant admin,
  öğrenci ve system admin `403` alır.
- Tenant query override'ı aktif request contextini değiştirmez; bypass context fail-closed reddedilir.
- Altı mevcut tenant/assignment-aware servis birer kez ve paralel çağrılır; dinamik N+1 yoktur. Gerçek
  Postgres sorgu bütçesi bu dilimde ölçülmemiştir; yeni tablo, migration veya yazma işlemi yoktur.
- Yanıt kişi adı, öğrenci/öğretmen/tenant/requester kimliği, telefon, e-posta, TCKN, destek mesajı
  veya ödev içeriği taşımaz.
- Tarih strict ISO günüdür; geçersiz takvim tarihi `400 DAILY_BRIEF_DATE_INVALID` döndürür.
- Rollout default-off kalır; bu değişiklik hiçbir tenantı kendiliğinden aktive etmez.

Öğrenci daily brief ek olarak:

- Yalnız gerçek veya read-only preview `STUDENT` subject contextinde çalışır; öğretmen, tenant admin
  ve system admin `403` alır. Tenant query override'ı self-scope'u değiştirmez; bypass fail-closed'dur.
- Duyuru, yoklama özeti, ödev ataması, rapor indeksi ve destek servisleri aynı öğrenci contextiyle
  birer kez ve paralel okunur. Read-only preview'da receipt ve requester kapsamı admin actor yerine
  hedef öğrencinin tenant içindeki bağlı hesabına fail-closed bağlanır. Fan-out sabittir; gerçek
  Postgres sorgu bütçesi bu dilimde ölçülmemiştir. Yeni sorgu katmanı, tablo, migration veya yazma
  işlemi yoktur.
- Yanıt öğrenci/tenant/requester kimliği, kişi adı, telefon, e-posta, TCKN, duyuru/destek metni veya
  ödev notu taşımaz.
- `web.student-portal-v2` default-off kalır; rollout çözümü hatasında eski portal açılır, daily brief
  hatasında ayrıntı endpointleri çağrılmadan güvenli hata görünümü gösterilir.
- `SP-02` alt rotaları rapor, ödev, devamsızlık ve destek dışındaki öğrenci datasetlerini indirmez.
  Destek rotası read-only preview'da form ve mutation açmaz; preview tokenı self-scoped liste
  okumasında korunur.

## Yerel kanıt

- Teacher daily brief unit ve route E2E: 2 dosya, 5 test `PASS`.
- API, web ve shared-types typecheck `PASS`.
- OpenAPI: 237 path ve daily brief PII-negatif response contract `PASS`.
- Öğretmen portalı browser sözleşmesi: 9 test `PASS`; rollout açık overview yalnız
  `/me/teacher/daily-brief` okur, flag kapalı akış korunur.
- Dedicated `NEXT_E2E_PORT=43121` ile fresh production build üzerinden mobil/masaüstü sözleşme
  çalıştırılmıştır.
- `NEXT_E2E_PORT=43155 pnpm run ci`: lint, typecheck, 1052 başarılı API testi (4 PostgreSQL/fixture
  testi ortam bağımlılığı nedeniyle skip), 138 geniş UX, 90 route-family ve 32 görsel test, 84 rota,
  production build, 237 OpenAPI path ve 45 idempotent operation ile `PASS`.
- Student daily brief unit ve route E2E: 2 dosya, 7 test `PASS`; gerçek öğrenci ile read-only preview
  aggregate eşitliği doğrulanır.
- Öğrenci/veli browser sözleşmesi: 27 test `PASS`; rollout açık overview yalnız
  `/me/student/daily-brief` okur, preview token rollout ve brief okumalarında korunur; rollout ve brief
  hata durumları ile 390 px mobil sınır doğrulanır.
- `SP-02` browser sözleşmesi: dört alt rota x 320/414 px olmak üzere 8 view-specific query, yatay
  taşma, etiketsiz kontrol, kırpılmış metin ve PII-negatif test ile destek read-only preview negatifi
  dahil 9 yeni test `PASS`. Rapor, ödev ve destek gereksiz profil/rollout okumaz; devamsızlık
  görünür profil bağlamını korur. Bu testler Chromium ve WebKit üzerinde çalışan `web:ux-rc`
  kapısına dahil edilmiş ve kapı 52/52 test ile `PASS` olmuştur.

Bu kanıt düzeyi `LOCAL_STATIC` ve mocked rollout kullanan tarayıcı yolu için `LOCAL_SYNTHETIC`tir.
`TP-01`, `SP-01` ve `SP-02` yerel dilimleri `LOCAL_SLICE_PASS` durumundadır.

## Gate E durumu

Gate E geneli henüz `PARTIAL`dır. Öğretmen alt rota dilimi (`TP-02`),
portal/ops/control-plane staging UAT, provider teslimi, backup/restore ve rollback tatbikatı,
external monitoring ve exact-SHA UAT artifact zinciri bu dilimlerin kapsamı dışındadır.

- Gerçek tenantta `web.teacher-portal-v2` activation/expiry/rollback: `EXTERNAL_NOT_RUN`
- Gerçek tenantta `web.student-portal-v2` activation/expiry/rollback: `EXTERNAL_NOT_RUN`
- Gerçek öğretmen görev gözlemi ve ürün metriği: `EXTERNAL_NOT_RUN`
- Gerçek öğrenci görev gözlemi ve ürün metriği: `EXTERNAL_NOT_RUN`
- Staging/prod deploy veya provider mutation: `EXTERNAL_NOT_RUN`

Bu dış kanıtlar tamamlanmadan Gate E `Pilot Ready`, production rollout veya kullanıcı başarısı
olarak işaretlenemez.
