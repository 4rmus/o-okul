# Yerel HTTP test dinleyicisi

## Gate6T-C — HTTP test kararsızlığı giderildi

**LOCAL_TEST PASS; iki normal tam API koşusunda1.247 PASS /18 skip.**
CI/STAGING/PRODUCTION çalıştırılmadı; uygulama ve güvenlik kodu değişmedi.

Kök neden uygulamanın403 üretmesi değildi: Supertest, dinlemeye başlamamış Nest
sunucusunu `listen(0)` ile wildcard IPv6 (`::`) adresinde açıyor, istek URL'sini
ise IPv4 `127.0.0.1` olarak kuruyordu. Yerel ortamda seçilen bazı portlarda IPv4
isteği başka dinleyiciye ulaşıyordu. NestJS'siz küçük HTTP örneği bunu doğruladı:
55275 portundaki başka servisin `Tier1` metni `HPE_INVALID_CONSTANT` üretirken,
59465 portundaki yerel filtre `not_allowed_local` gövdeli403 döndürdü.

43 HTTP test başlangıcında yalnız `await app.init()` yerine
`await app.listen(0, "127.0.0.1")` kullanıldı. Sunucu grup boyunca açık tutulur,
mevcut `app.close()` ile kapanır. Doğrulamalar, kimlik/rol/lisans/RLS politikaları,
üretim kodu ve yerel filtre ayarları aynen korundu. HTTP kullanmayan lifecycle
unit testlerinin başlatma davranışı değiştirilmedi.

Kanıtlar:
- Eski wildcard/otomatik port örneğinde30.000 istekte7 yanlış yanıt:4 ayrıştırma,
  3 filtre403. Hatalar aynı iki yerel dinleyiciye bağlandı.
- Açık loopback sabit dinleyicide10.000 istek PASS; açık loopback ile portu her
  istekte değiştiren ek kontrolde10.000 istek PASS.
- API typecheck PASS. Tanılama yaması olmadan normal tam API iki kez PASS:
  157 dosya,1.247 test;18 normal skip önceki bağımsız PG/MinIO kanıtına dönüştürülmedi.
- 43 dosyanın önce/sonra hash ve ters değişiklik kontrolü, yalnız başlangıç
  satırlarının değiştiğini doğruladı. `git diff --check` PASS.

Paket: `artifacts/tenant-http-test-regression/candidate.json`; önceki başarısız
koşular ve ham yanıt başlangıçları korunur. Bu bölüm Gate6T-B'deki çözülmemiş
HTTP kararsızlığı notunu günceller. Cihaz geri yükleme için
`restoreVerified=false` / `canRestore=false` sürer; canlı yayın yapılmadı.
**Sıradaki gate:** süreç çökmesi sonrası kalıcı DB+dosya uzlaştırması; gerçek
trigger davranışı, MFA/veri uygulama ve kontrollü pilot henüz tamamlanmadı.

Yeni Supertest/Nest HTTP fixture'larında uygulamayı loopback üzerinde bir kez
başlatın; gruptaki istekler aynı dinleyiciyi kullansın. Sonunda mutlaka `app.close()`
çağırın. Dinleyici başlamadan `getHttpServer()` verilirse Supertest kendi wildcard
port seçimine döner. Üretim sunucusunun bağlanma adresi bu test kararıyla değiştirilmez.
