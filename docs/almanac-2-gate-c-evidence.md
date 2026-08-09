# Almanak 2.0 Gate C Yerel Kanıtı

## Kapsam

Gate C, mevcut kurum kabuğunu ve sınav yönetimini default-off tenant rollout ile genişleten ilk
dikey dilimdir. `web.shell-v2`, `web.ia-v2` ve `web.exam-workspace-v2` birlikte açık olduğunda
yedi alanlı kurum bilgi mimarisi ile `/kurum/sinavlar/:examId` çalışma alanı görünür. Anahtarlardan
biri kapalıysa veya rollout isteği hata verirse mevcut kabuk ve `examId` sorgusunu koruyan eski sınav
ekranı kullanılır.

## Güvenlik ve veri sınırı

- `GET /exams/:examId/workspace` yalnız `academic:read` capability'si ile açılır.
- Sınav, cevap anahtarı, katılımcı ve snapshot sorguları tenant bağlamında ve sabit sayıda çalışır.
- Yanıt yalnız sınav özeti, toplu katılımcı sayıları ve rapor hazırlığını taşır; öğrenci kimliği,
  ham optik veri veya dosya bilgisi taşımaz.
- Yetkisiz öğrenci rolü `403`, başka tenant sınavı `404` alır.
- Çalışma alanı salt okunurdur; mevcut optik ve rapor akışlarına sınav bağlamını koruyan bağlantılar
  verir.

## Yerel kanıt

- Hedefli API: 2 dosya, 24 test `PASS`.
- Route manifest: 82 route ve 19 module decision `PASS`.
- UX contract: 123 test `PASS`.
- Route family: 86 test ve dört zorunlu viewport `PASS`; rollout açık ve rollback senaryoları dahil.
- Görsel smoke: 32 test `PASS`.
- Tam API paketi: 140 dosya, 1.034 test `PASS`; 2 dosya ve 4 test mevcut ortam gereği skipped.
- Worker paketi: 34 dosya, 209 test `PASS`; 1 dosya ve 8 test mevcut ortam gereği skipped.
- Production build ve 234-path OpenAPI contract `PASS`.
- `NEXT_E2E_PORT=43120 pnpm run ci` `PASS`.

Bu sonuçlar `LOCAL_STATIC` ve mocked rollout kullanılan tarayıcı akışları için `LOCAL_SYNTHETIC`
kanıttır; gerçek tenant aktivasyonu değildir.

## Dış kanıt durumu

- Gerçek iç tenant rollout ve süre sonu davranışı: `EXTERNAL_NOT_RUN`
- Staging/prod activation ve rollback: `EXTERNAL_NOT_RUN`
- Gerçek kullanıcı görev gözlemi ve RUM: `EXTERNAL_NOT_RUN`

Bu dış kanıtlar tamamlanmadan Gate C production rollout'u veya kullanıcı başarısı iddiası yapılamaz.
