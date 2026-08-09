# Almanak 2.0 Gate D Yerel Kanıtı

## Kapsam

Gate D'nin bu yerel dilimi, mevcut optik ve rapor yeteneklerini sınav çalışma alanı içinde sabit
`examId` bağlamıyla birleştirir. `web.exam-workspace-v2` kapalıysa iç içe rotalar mevcut bağımsız
optik ve rapor URL'lerine geri döner.

Kurulum ilerlemesi artık tarayıcıdan yedi ayrı liste isteği yapmak yerine `GET /me/setup-readiness`
üzerinden tek, salt okunur ve tenant-kapsamlı bir özet alır. Yanıt yedi kurulum adımının sayısını,
tamamlanma durumunu ve toplam ilerleme yüzdesini taşır.

## Güvenlik ve veri sınırı

- Kurulum özeti yalnız `setup:manage` capability'sine sahip kurum rolleri için açılır.
- Campus-kapsamlı operasyon personeli tenant-geneli özetten fail-closed reddedilir; yalnız tenant
  kapsamlı operasyon rolü bu özeti alabilir.
- İstek query'sindeki tenant override dikkate alınmaz; aktif tenant bağlamı korunur.
- Yanıt kişi, telefon, e-posta, TCKN veya kayıt kimliği taşımaz; yalnız adım kimliği, sayı ve
  tamamlanma bilgisi döner.
- Yedi mevcut tenant-aware servis birer kez ve paralel çağrılır; yeni tablo, migration veya yazma
  işlemi yoktur.
- İç içe optik ve rapor rotalarında sınav seçimi URL'deki `examId` değerine kilitlidir.
- Flag yokluğu, süresi dolması veya rollout hatası mevcut bağımsız akışa fail-closed dönüş verir.

## Yerel kanıt

- Hedefli API: 11 dosya, 169 test `PASS`; sınav, optik, rapor, öğrenci, IAM ve kurulum kapsamı dahil.
- Tam API paketi: 142 dosya, 1.040 test `PASS`; 2 dosya ve 4 ortam bağımlı test skipped.
- Worker paketi: 34 dosya, 209 test `PASS`; 1 dosya ve 8 ortam bağımlı test skipped.
- Kurulum readiness unit/E2E: 2 dosya, 6 test `PASS`; rol, campus scope, tenant override ve
  PII-negatifleri dahil.
- Route manifest ve mimari sözleşme: 84 route, 19 module decision `PASS`.
- Route family: 90 test ve dört zorunlu viewport `PASS`; iç içe bağlam ve rollback dahil.
- Optik, rapor, kurulum ve çalışan erişimi tarayıcı sözleşmeleri: 29 test `PASS`.
- Web erişilebilirlik: 11 test `PASS`; karne görsel sözleşmesi: 1 test `PASS`.
- RLS: 64 tenant tablosu; idempotency: 45 operation `PASS`.
- OpenAPI: 235 path ve kurulum yanıtında PII alanlarını reddeden contract `PASS`.
- UI ölçüm baseline'ı: 3 görev, görev başına 5 örnek ve güncel kaynak digest'i `PASS`.
- Production build, 235-path OpenAPI ve `NEXT_E2E_PORT=43120 pnpm run ci` `PASS`.

Bu sonuçlar `LOCAL_STATIC` ve mocked API/rollout kullanılan tarayıcı akışları için
`LOCAL_SYNTHETIC` kanıttır. Gate D'nin repo ve yerel kabul dilimi `LOCAL_GATE_PASS` durumundadır.

## Dış kanıt durumu

- Gerçek iSEM fixture'larıyla Postgres/Redis/MinIO optik pipeline smoke: `EXTERNAL_NOT_RUN`
  (zorunlu `.txt` ve cevap anahtarı fixture'ları bu worktree'de yok).
- Staging'de optik yükleme -> quarantine probe -> değerlendirme -> rapor/PDF/Excel tam çevrimi:
  `EXTERNAL_NOT_RUN`.
- Gerçek UI-worker, job kuyruğu ve staging artifact doğrulaması: `EXTERNAL_NOT_RUN`.
- Pilot tenant kurulum, öğrenci/IAM görevleri ve gerçek kullanıcı gözlemi: `EXTERNAL_NOT_RUN`.
- Production activation veya rollout: `EXTERNAL_NOT_RUN`.

Bu dış kanıtlar tamamlanmadan Gate D'nin tam staging/pilot kabulü veya production readiness iddiası
yapılamaz. Genel Gate D kararı bu nedenle `PARTIAL`; yalnız repo/yerel dilim geçmiştir.
