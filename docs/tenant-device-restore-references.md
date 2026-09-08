# Geri yükleme etki planında ilişkiler

## Gate6T-H — korunan kayıtların gerçek FK ilişkileri

**LOCAL_TEST / LOCAL_RUNTIME PostgreSQL16 / yerel tarayıcı PASS. CI/STAGING/PRODUCTION çalıştırılmadı.**
Etki önizlemesi aynı READ ONLY snapshot içinde gerçek PostgreSQL FK metadatasını
okur. Aday veri kümesi, PRESERVE tablolarında güncel kayıtları; REPLACE tablolarında
arşiv kayıtlarını kullanır. Böylece mevcut ödeme planının öğrencisi yedekte yoksa,
finans kaydı değişmese bile kopacak ilişki bulunur; CASCADE olasılığı güvenli sayılmaz.

- Birleşik tenantId/id anahtarları, MATCH SIMPLE/FULL null davranışı ve eksik alanlar
  ayrılır. Kaybolacak ilişkiler tablo→hedef tablo bazında sayılır; kimlik, tutar veya
  satır içeriği yanıta çıkmaz. Panel kontrol edilen/çatışan/doğrulanamayan sayıları gösterir.
- Geçersiz/boş metadata, kapsam dışı hedef, projeksiyonda olmayan kaynak, bilinmeyen
  alan veya desteklenmeyen anahtar türü doğrulanmış sayılmaz.
- Sayısal FK değerlerinde JavaScript yuvarlamasına güvenilmez: iki farklı kesrin
  aynı sayıya dönüşmesi testle üretildi; bu türler kayıpsız SQL doğrulaması gelene
  kadar açıkça UNVERIFIED kalır. Metin/boolean anahtarları karşılaştırılır.
- FK kontrolü tamamlandığında genel korunan-bağımlılık engeli, ayrı domain ilişkisi
  incelemesine dönüşür. Polimorfik/iş-kuralı bağları otomatik onaylanmaz; `canApply=false`.

Doğrulama:5 yeni ilişki testi, hedefli18 test, normal API1.257 PASS/21 skip;
typecheck/build/OpenAPI250 path PASS. Gerçek PG'de PaymentPlan→Student birleşik FK
okundu, arşivden kaldırılan öğrencinin mevcut ödeme planıyla çatışması bulundu;
önizleme öncesi/sonrası kayıtlar aynı kaldı.7 cihaz PG testi çalıştı; nesne deposu
provası tekrarlanmadı. Web typecheck,11 erişilebilirlik testi, UX ve tarayıcı özeti PASS.
İlk mock uyumsuzluğu ve sayısal yuvarlama regresyonunun başarısız kanıtları korunur.

Kanıt: `artifacts/tenant-device-restore-references/candidate.json`, `postgres-runtime.json`
ve günlükler. Prova container'ı kaldırıldı; VM kapatıldı. Canlıya veya dna/demoo/system'a
işlem yapılmadı; API yetkileri ve güvenlik kontrolleri gevşetilmedi.

**Sınır:** FK eşleşmesi domain doğruluğu veya uygulama izni değildir. Arşiv dışında
korunan modellerin satırları/kimlik sırları okunmadığı için ilgili bağlar eksik olarak
bildirilir. Sayısal anahtarlar ve FK dışı kimlik/gönderim referansları hâlâ kapatılmalıdır.
`restoreVerified=false` / `canRestore=false` korunur; üretim işi/MFA/CI/staging/pilot yok.
**Sıradaki gate:** FK dışı kimlik ve gönderim referanslarını mevcut domain sözleşmeleriyle
kontrol edip kalan inceleme engellerini somutlaştırmak; sonra kalıcı onay/iş akışı.

`impact.references` isteğe bağlıdır: checkedLinks, conflicts[{table,references,links}]
ve unverified alanları içerir. Sayılar benzersiz kişi sayısı değil, FK bağlantısı
sayısıdır. Bir kaydın birden çok bozuk ilişkisi olabilir. `unverified` boş olması
FK dışındaki iş kurallarını doğrulamaz. Eski istemci sözleşmesi korunur.
