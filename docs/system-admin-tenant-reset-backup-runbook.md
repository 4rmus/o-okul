# CLEAN_SETUP_V1 envanteri ve geri dönüş paketi

Gate 3 yalnız okuma, yedekleme ve izole geri yükleme hazırlığıdır. Kaynak tenantı askıya
almaz, hiçbir kaynak satırını/nesnesini silmez; reset worker veya reset başlatma ucu yoktur.
Mevcut BACKUP işi ve 5.000 satırlık kullanıcı export'u bu paketin doğrulama kanıtı değildir.

## Önizleme

`GET /tenants/:id/clean-reset-preview` yalnız `SYSTEM_ADMIN` ve `tenant:clean-reset`
yetkisiyle çalışır; `system` hedefi reddedilir. Yanıt sabit kategoriler, korunan/silinecek/
bloklanan kayıt sayıları, owner sayısı, nesne sayısı/boyutu, lifecycle sürümü ve digest taşır.
`blockerCounts` bilinen kayıt/iş sayısını gösterir; doğrulanamayan kaynaklarda `count=null`
kullanılır. Ham satır, kullanıcı kimliği, iletişim bilgisi ve object key dönmez.

71 tablonun tamamı (64 canonical tenant tablosu, SecretDeliveryOutbox ve altı global/dolaylı
tablo) sabit katalogdadır. Prisma ve canlı PostgreSQL tablo/kolon sınırı farklıysa işlem
başarılı sayılmaz. AuditLog child partitionları gerçek `pg_inherits` ilişkisiyle tanınır.
PasswordResetToken kullanıcı üzerinden, ConsumedRefreshToken session ailesi üzerinden;
nullable tenantId'li teslim kayıtları invitation/reset kaynakları üzerinden seçilir.

Tüm aktif, tutarlı owner hesapları ve yalnız canonical owner üyelikleri korunacak şekilde
sayılır. Owner + geçerli öğretmen ek rolü desteklenir; auxiliary üyelik ve profil temizlenecek
kategoridedir. Aktif öğrenci/veli/çelişkili staff birleşimi mevcut auth/DB projection kuralını
bozuyorsa normalize edilebilir kabul edilmez, `OWNER_PROJECTION_MISMATCH` ile bloklanır.

Finans, destek ve izin kayıtları soft-delete durumuna bakılmadan bloklar. İzin geçmişi
sonradan temizlenebildiği için StudentContact kayıtları `CONSENT_HISTORY_UNVERIFIED` ile
bloklanır. İlk sürüm, WhatsApp'ın UNRECORDED placeholder kayıtlarını da muhafazakâr olarak
bloklar; bunları gerçek kayıtlarla karıştırıp temizlemeye izin vermez.

**Legal-hold kaynağı henüz yoktur.** Her önizlemede `LEGAL_HOLD_UNVERIFIED` ve `allowed=false`
vardır. Bir env boolean veya işlem referansı hukuki onay sayılmaz. İleride kurum/veri sorumlusu
kararına bağlı, kapsamı ve sürümü doğrulanabilen yetkili kayıt kaynağı bağlanmalıdır.
Bu hukuki/reset blockerları, eksiksiz ve güvenli bir yedeğin alınmasını tek başına engellemez.

Yedi BullMQ kuyruğu gerçek `QUEUE_PREFIX` ile okunur; PDF işi `snapshot.tenantId` üzerinden
atanır. Failed dahil yeniden çalıştırılabilen işler bloklanır; scheduler/repeat sahipliği
kanıtlanamıyorsa bloklanır. DB teslim/import/backup durumları ayrı blocker sayılarıdır.

## Paket içeriği ve tutarlılık

Kaynak DB yalnız `REPEATABLE READ READ ONLY` transaction içinde okunur; silinmiş satırlar
dahildir, satır limiti yoktur. PostgreSQL `to_jsonb(row)::text` metni aynen korunur: Decimal,
büyük JSON sayıları ve zaman hassasiyeti JS sayı dönüşümüne uğramaz. JSON yalnız önizleme
metadatası için ayrı bir kopyada ayrıştırılır. Kaynak snapshot ID'sine bağlı `pg_dump`
şema arşivi ve tam `_prisma_migrations` geçmişi pakettedir.

Lisans FK'lerinin ihtiyaç duyduğu PlatformAccount kayıtları **bağımlılık projectionıdır**:
yalnız gereken ID, sentetik login/name, boş e-posta/MFA ve giriş yapamayan passwordHash içerir.
Asıl platform hesap şifresi, MFA sırrı, e-posta, ad veya login yedeklenmez. PlatformSession
satırları alınmaz. Geri yüklemede tenant satırları byte/hash eşliğiyle, bu global bağımlılıklar
ise açıkça etiketlenmiş disabled projection eşliğiyle doğrulanır. Platform hesabı geri
kazanımı bu tenant paketinin kapsamı değildir.

RawImport, HomeworkMaterialFile, SupportTicketAttachment ve Student.photoKey nesneleri
paginated tam bucket envanteriyle eşleştirilir. Öğrenci fotoğrafında tenant segmenti yoktur;
sahiplik Student ID üzerinden doğrulanır. Yinelenen aynı dosya referansı tek nesne sayılır.
Bilinmeyen/orphan key, eksik nesne veya hash farkı paketi başarısız yapar. Inline base64
ekler DB satırlarının içinde korunur. Dış `logoUrl` profil değeri aynen korunur; URL'ye GET
atılmaz. Sahip olunan bucket içinde katalog dışı logo nesnesi varsa unknown key blockerıdır.

Nesnenin gerçek GET baytları SHA-256 ile doğrulanır; ETag içerik hash'i kabul edilmez.
Toplama sonrası ve geri yükleme sonunda yeni kaynak DB snapshot'ı ve yeni object GET'leriyle
kaynak digest'i yeniden karşılaştırılır. Kaynak tenant önceden `SUSPENDED` olmalıdır.
Receipt geçmiş snapshot eşliğini kanıtlar; sonradan kaynak değişmeyeceği garantisi değildir.
Gate 4 ayrıca taze policy/queue/digest kontrolü ve yazma kilidi sağlamalıdır.

Paket schema + raw rows + nesne baytları + SHA-256 manifestini AES-256-GCM ile şifreler.
Off-host hedefe yalnız şifreli içerik yazılır; geri okunup hash/decryption doğrulanmadan
restore başlamaz. Kütüphane arşivi bellekte tutar; 512 MiB üstünde açık hata verir, hiçbir
satırı/nesneyi kırpıp başarılı sonuç üretmez. Daha büyük tenant için streaming arşiv gerekir.

## Operasyon önkoşulları

Gerçek yedek ve restore hedefi yazmaları için **işlem anında açık kullanıcı onayı gerekir**.
Bu geliştirme sırasında gerçek PG/S3 operasyonu çalıştırılmadı. Aşağıdaki env kontrolleri
operatör hatasını azaltır; kullanıcı onayının yerine geçmez.

- Kaynak için `DATABASE_URL` ve mevcut `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` kullanılır.
- Ayrı hedefler `TENANT_RESET_BACKUP_S3_*` ve `TENANT_RESET_RESTORE_S3_*` önekleriyle aynı
  alanları ister. S3 endpointleri HTTPS olmalı; userinfo/query/fragment kabul edilmez.
  Backup hostname/IP'si kaynak DB ve S3'ten ayrı ve public off-host olmalıdır.
- Bucket private ACL, policy status ve dört public-access-block ayarı provider GET'leriyle
  doğrulanır. Bunları desteklemeyen S3 uyumluluğu **UNPROVEN/BLOCKED** kalır; env bypass yoktur.
- `TENANT_RESET_BACKUP_OPERATION_ID`: 32 küçük hexadecimal karakter. Restore database adı
  `o_okul_reset_drill_<operationId>`, bucket adı `o-okul-reset-drill-<operationId>` olmalı.
  Restore DB ve S3 bucket (versions/delete markers/multipart dahil) boş olmalı.
- `TENANT_RESET_RESTORE_DATABASE_URL`: kaynak host/IP'sinden farklı, TLS `sslmode=require`
  veya `verify-full` kullanan disposable DB bağlantısı. Kaynak/backup/restore bucketları ayrı.
- `TENANT_RESET_BACKUP_KEY_BASE64`: ayrı güvenli kanaldan sağlanan 32 bayt AES anahtarı;
  kaynak tenant erişimine veya paket/receipt içine konmaz.
- `TENANT_RESET_BACKUP_TENANT_ID`, `TENANT_RESET_BACKUP_APPROVAL_REFERENCE` ve
  `TENANT_RESET_BACKUP_ACTION=BACKUP_AND_ISOLATED_RESTORE` zorunludur.

Operatörün PostgreSQL sürümüyle uyumlu `pg_dump`/`pg_restore` araçları, hedef cluster'da
kaynak şemanın gerektirdiği roller/extension desteği ve restore yetkisi hazır olmalıdır.
Veritabanında mevcut uygulama tabloları olmamalıdır; boşluk kontrolü yazmadan önce tekrarlanır.
Source snapshot/schema okuma yetkisi gerekir. Eksik rol/extension/FK bağımlılığı başarısız
restore üretir; VERIFIED receipt verilmez. Kaynak sırları child process argv/loglarına yazılmaz.

Onaylı operasyon ortamında önce shared/db/API build alınır; iç araç:

```sh
node scripts/tenant-reset-backup.mjs
```

Araç `pg_restore pre-data → gerçek tablolara tam satırlar → pg_restore post-data` sırasını
izler. Mevcut triggerlar devre dışı bırakılmaz; FK/check/index/trigger kurulumu başarılı
olmalı, doğrulanmamış constraint kalmamalıdır. Ardından gerçek restore tabloları, migration
geçmişi ve restore bucket GET baytları manifest ile karşılaştırılır. Hata halinde kaynak
hiç değişmez; başarısız disposable hedefler operatör incelemesine bırakılır, otomatik silinmez.
Aynı hedefe kör retry yapılmaz. Receipt yalnız counts/hashes/operationId/time taşır; DSN,
object key ve PII içermez. Backup paketi anahtar olmadan okunamaz.

## Kanıt sınırı

Birim/adapter testleri injected PG/S3/process fixture'larıdır; gerçek PostgreSQL/S3 restore
kanıtı değildir. İlk gerçek kullanımda disposable iki-tenant DB/S3 envanteri, hassas sayı/zaman
örnekleri, schema/ledger/FK kontrolü, source-drift, object retry ve exact source isolation
kanıtı ayrı onaylı işlemde kaydedilmelidir. Gate 4 reset/silme ve Gate 6 staging/pilot
bu çalışmanın dışındadır.

## Gate 4 — aynı operasyonun yürütülmesi (yerel kaynak, canlı kullanım kapalı)

Reset başlatmadan önce Gate 2 ile kurum `SUSPENDED` olmalı, ardından yeni preview alınmalıdır.
`POST /tenants/:id/clean-reset-jobs` exact slug, sabit gerekçe, `CLEAN_SETUP_V1`, lifecycleVersion,
preflightDigest, zorunlu Idempotency-Key ve `TENANT_CLEAN_RESET` MFA kanıtı ister. MFA tenant,
preset, sürüm ve digest'e bağlıdır. Sistem kurumu/tenant rolleri reddedilir. Durum GET salt-okunurdur.
Aynı kabul edilmiş POST tekrarı aynı operasyonu uzlaştırır; farklı gövdeyle aynı key reddedilir.
202 yanıtı kaybolmuş ve operationId bilinmiyorsa yeni POST yapılmaz: aynı kullanıcı
`GET /tenants/:id/clean-reset-jobs` isteğinde özgün `Idempotency-Key` header'ını gönderir.
Lookup yalnız current actor + tenant + key eşleşmesini döndürür; missing/invalid key 400,
eşleşmeyen kayıt 404'tür. Henüz commit edilmemiş kayıt için 404 alınması isteğin kesin başarısız
olduğunu göstermez; aynı salt-okunur GET tekrar edilir. Operation ID öğrenilince mevcut
`GET /tenants/:id/clean-reset-jobs/:operationId` ile durum izlenir. Her iki GET de kayıt, audit
veya queue yazmaz. Arka plan dispatcher eksik Redis işini aynı deterministic job ID ile yeniden kurar. Policy nedeniyle
`BLOCKED` kayıtlar otomatik dispatcher tarafından yeniden yürütülmez.

**İki bağımsız kapı bugün kapalıdır:** authoritative legal-hold kaynağı ve yazma duraklatma/drain
kanıtı yoktur. `RESET_LEGAL_HOLD_UNVERIFIED` ve `RESET_WRITE_QUIESCENCE_UNVERIFIED` varsayılan
reddidir. Env boolean, caller flag, paketin varlığı veya receipt JSON'u bunları açamaz. Gelecekte
legal-hold entegrasyonu tek başına yeterli değildir: başlamış HTTP yazımları, uploadlar ve tüm
queue producer/consumerları için kurum bazlı duraklatma ve drain kanıtı gerekir. Testte injected
otoriteler yalnız izole fixture kaynaklarını temsil eder; production readiness kanıtı değildir.

Runtime yapılandırma sınırları:

- `TENANT_RESET_DATABASE_URL` yalnız `o_okul_reset_worker` kimliğini kabul eder; destructive
  SQL için `DATABASE_URL` fallback'i yoktur. Migration rolü `NOLOGIN` oluşturur ve hiçbir parola
  kurmaz. Login/secret dağıtımı sonraki açık onaylı operasyon kapısına aittir.
- Rol superuser/BYPASSRLS/CREATEROLE/CREATEDB/replication, başka role üyelik, public schema CREATE,
  tablo sahipliği, Tenant/AuditLog delete/truncate ve blocker tablolarında DML yetkisi taşıyamaz.
  Existing PUBLIC bypass policy'lerini worker'a özel restrictive tenant policy sınırlar. Worker
  Tenant profil/lisans kolonlarını değiştiremez; AuditLog yalnız append edilir. Yeni operasyon
  tablosunda app DELETE yoktur; tek unfinished operasyon partial unique index ile korunur.
- `TENANT_RESET_BACKUP_SOURCE_DATABASE_URL` ayrı, global metadata/snapshot okuyabilen **salt-okunur**
  kaynak rolüdür. Worker bu bağlantıda public tablo DML/TRIGGER/sahiplik ve schema CREATE yetkilerini
  reddeder. Kaynak tenant yazma rolü backup/restore için kullanılmaz. `pg_dump` bu readonly kimlikle,
  `pg_restore` ayrı disposable hedef kimliğiyle çalışır. Kaynak ve restore kimlikleri farklıdır.
- `TENANT_RESET_SOURCE_S3_*` (endpoint/bucket/region/access key/secret key), API preview'nun `S3_*`
  kaynak endpoint/bucket kimliğiyle eşleşmelidir. Kaynak kimliği preflight hash'ine ve restore
  doğrulanmış manifest'e bağlıdır; credential değerleri digest'e veya kamuya açık yanıta girmez.
  Resume sırasında bucket/endpoint değişimi reddedilir. İlk sürüm versioning etkin/suspended
  kaynak bucket'ı reddeder; eski object version temizliği ayrıca kanıtlanmadan açılmaz.
- `TENANT_RESET_BACKUP_KEY_BASE64`, `TENANT_RESET_BACKUP_S3_*`, `TENANT_RESET_RESTORE_DATABASE_URL`
  ve `TENANT_RESET_RESTORE_S3_*` Gate 3'ün private/off-host/empty hedef şartlarını taşır. Operation ID
  32 hex olduğundan önceden hazırlanmış hedef isimleri bu kimliğe bağlıdır. Eksik hedefleri worker
  kendiliğinden kurmaz; `RESET_OPERATIONS_PREREQUISITE_REQUIRED` ile durur. Disposable DB
  sunucusunda dump policy hedeflerinin gerektirdiği NOLOGIN rol adları (özellikle
  `o_okul_reset_worker`) önceden hazırlanmalıdır; pg_dump cluster rollerini arşivlemez.
- Worker dedicated DSN yoksa başlatılmaz; diğer workerlar çalışmaya devam eder. Hata listenerı
  yalnız sabit kod yazar; job payload, key, DSN, MFA veya receipt loglanmaz.

Yürütme ve recovery:

1. Backend operasyon kaydını ve queued audit'ini tek transactionda oluşturur. Bir tenant için
   `QUEUED/RUNNING/BLOCKED/FAILED` durumlarından herhangi biri varken yeni reset ve Gate 2 ACTIVE
   geçişi kapalıdır. DB trigger da sıradan ACTIVE güncellemesini reddeder.
2. Worker aynı operasyon için dedicated bağlantıda advisory session lock alır. Bağlantı kaybında
   sonraki DB yazımı veya her object aksiyonu öncesi canlı fence sorgusu başarısız olur. Queue'da
   yalnız kendi exact job ID + tenant + operation kaydı dışlanır; diğer çalışma/scheduler bloktur.
3. Tam raw satırlar yedekte tutulur. Data drift digest'i yalnız bu operasyon satırını ve aynı
   operation ID'ye bağlı `tenant.reset.queued/phase/completed` audit kayıtlarını dışlar; eski audit,
   receipt ve iş verileri hash kapsamındadır. Her raw tablo ayrıca bağımsız SHA-256 ile doğrulanır.
4. Gerçek restore doğrulamasından sonra receipt operation/tenant/version/preflight ve immutable
   encrypted package hash'ine bağlanır; worker anahtarıyla HMAC imzalanır. Canonical JSON hash'i
   PostgreSQL JSONB key sırasına bağımlılığı kaldırır. Request gövdesi receipt/key listesi kabul etmez.
   `pg_restore --section=post-data` ve tam doğrulama bittikten sonra private off-host hedefe
   operation/package/restore-target bağlı, HMAC imzalı immutable restore-completion attestation
   yazılır ve readback doğrulanır. Bundan sonra DB receipt kaybolursa aynı paket + attestation
   okunur ve **gerçek restore DB/object verileri yeniden kontrol edilir**. Eksik/bozuk attestation
   (post-data öncesi ya da attestation yazımından önce crash dahil) `RESET_RESTORE_ATTESTATION_UNVERIFIED`
   ile manuel recovery ister; satır/sayım eşliği tek başına eksik constraint/trigger kurulumunu
   kanıtlamaz. Partial hedefin üstüne yazılmaz ve kaynak purge başlamaz.
5. Tek PostgreSQL transaction tüm token/outbox selectors'ını parent silinmeden çözer; owner dahil
   AuthSession/ConsumedRefreshToken/PasswordResetToken/IdentityInvitation/device kayıtlarını siler.
   Owner olmayan ve userId=NULL Employee kayıtları temizlenir. Bütün geçerli aktif owner
   User + canonical Membership + Employee kayıtları korunur; auxiliary teacher persona ve kampüs
   scope kaldırılır, membership/user sürümü birlikte artar ve mustChangePassword=true olur.
   Exam self-FK önce NULL yapılır, sonra sabit child-first tablo listesi uygulanır.
6. Audit, owner postcondition veya herhangi bir SQL hatası purge transactionını geri alır; S3
   çağrısı yapılmaz. `OBJECTS` checkpoint'i purge ile **aynı commit** içindedir. Belirsiz commit
   sonucu aynı operation yeniden okunur; checkpoint varsa DB purge tekrar edilmez.
7. S3 yalnız authenticated manifest'teki exact key listesinde GET/hash ve ETag koşuluyla silinir.
   Beklenen 404 idempotent başarıdır; farklı içerik, yetki/network hatası başarı sayılmaz. Hata
   halinde tenant SUSPENDED kalır. Object yokluğu ve DB owner/sıfır-veri koşulları doğrulanınca
   operation COMPLETED ve tenant ACTIVE + lifecycleVersion artışı aynı transactionda yazılır.

Migration additive'dir; veri backfill'i veya seed kurum reseti gerektirmez. LicenseUsage mevcut
Student/Enrollment triggerları devrede kalır: güncel active count sıfırlanabilir, önceki peak ve
lisans geçmişi korunur. Hiçbir constraint/trigger devre dışı bırakılmaz. Normal owner parola
zorunluluğu mevcut restricted-token/password-change akışını kullanır.

`LOCAL_STATIC`/`LOCAL_TEST` kanıtları planda kayıtlıdır. `CI`, gerçek PostgreSQL rollback/concurrency,
rol grant/RLS ve S3 restore/delete deneyi, ingress/upload/queue drain, legal-hold entegrasyonu,
`STAGING` ve `PRODUCTION` bu Gate 4 çalışmasında yapılmadı ve `UNPROVEN` durumundadır.
