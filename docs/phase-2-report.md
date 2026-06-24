# Faz 2 Durum Raporu

## Tamamlanan repo içi kapsam

- `schedule-lessons` için tenant izole ders programı CRUD API eklendi.
- Program create/update akışında `classId` ve `teacherId` mevcut tenant context'iyle doğrulanıyor.
- Aynı öğretmenin çakışan ders saatleri `409 SCHEDULE_TEACHER_CONFLICT` ile engelleniyor.
- `homework` için materyalsiz, class bağlı bağımsız ödev CRUD API eklendi.
- Ödev create/update akışında `classId` mevcut tenant context'iyle doğrulanıyor.
- `homework` içinde tenant izole demo materyal kaynağı ve materyalden ödev oluşturma akışı eklendi.
- Materyalden ödev create akışında `classId` ve `materialId` mevcut tenant context'iyle doğrulanıyor.
- Tenant A demo teacher kullanıcısı eklendi; teacher rolünün program/ödev okuduğu ama yazamadığı e2e
  ile doğrulandı.
- `study-sessions` için tenant izole etüt planlama CRUD API eklendi.
- Etüt create/update akışında `classId`, `teacherId` ve `studentIds` mevcut tenant context'iyle
  doğrulanıyor.
- Etüt kapasitesi ve öğretmen saat çakışması e2e ile kanıtlandı.
- Teacher rolünün etütleri okuduğu ama yazamadığı e2e ile doğrulandı.
- Program API için Supertest e2e kapsamı eklendi.
- Homework API için Supertest e2e kapsamı eklendi.
- Study Session API için Supertest e2e kapsamı eklendi.
- Web dashboard'a ders programı, etüt planı ve ödev kontrol panelleri eklendi.
- `PATCH /homework/:id/check-status` ile ödev kontrol durumu `checkedAt/checkedBy` olarak backend'de
  işaretleniyor ve temizleniyor.
- Ödev kontrol butonu backend response'uyla `Kontrol edildi` durumunu ve kontrol sayacını güncelliyor.
- Faz 2 DB şema/RLS zemini eklendi: `ScheduleLesson`, `StudySession`, `StudySessionStudent`,
  `HomeworkMaterial`, `Homework`.
- Yeni Faz 2 tabloları için FK, tenant indeksleri, app role grant'i ve RLS policy'leri migration'a
  eklendi.
- Statik RLS kontrolü 7 tablodan 12 tenant tablosuna genişletildi; canlı RLS script'i de Faz 2
  fixture'larını deneyecek şekilde güncellendi.
- Ders programı API için `SCHEDULE_STORE=postgres` opt-in store yolu eklendi.
- `PostgresScheduleStore`, `ScheduleLesson` tablosu için SQL parametre testleriyle doğrulandı;
  default API davranışı in-memory store ile aynı kaldı.
- Etüt API için `STUDY_SESSION_STORE=postgres` opt-in store yolu eklendi.
- `PostgresStudySessionStore`, `StudySession` ve `StudySessionStudent` tabloları için SQL parametre
  testleriyle doğrulandı; default API davranışı in-memory store ile aynı kaldı.
- Homework API için `HOMEWORK_STORE=postgres` opt-in store yolu eklendi.
- `PostgresHomeworkStore`, `Homework` ve `HomeworkMaterial` tabloları için SQL parametre testleriyle
  doğrulandı; default API davranışı in-memory store ile aynı kaldı.
- `pnpm postgres-stores:smoke`, `Class`, `ScheduleLesson`, `StudySession`,
  `HomeworkMaterial`, `HomeworkMaterialFile`, `HomeworkMaterialAssignment` ve `Homework` store
  yollarını canlı Postgres üzerinde tenant izolasyonuyla doğrular.
- Postgres store yolları `withTenantQuery` ile request context'e bağlı RLS ayarlarını set eder:
  normal tenant için `app.current_tenant_id`, system admin için `app.bypass_rls=true`; context yoksa
  DB erişimi hata verir.
- API hata yanıtları global filtreyle `{ error: { code, message, details? } }` zarfını kullanır.
- API kaynak endpointleri `/api/v1` altında sunulur; health endpointleri altyapı sinyali olarak kökte
  kalır.
- API başarılı yanıtları uygulama konfigürasyonunda liste için `{ data, meta }`, tekil yanıt için
  `{ data }` zarfını kullanır; web istemcisi bu zarfı okuyacak şekilde güncellendi.

## Çalıştırılan doğrulamalar

- `pnpm --filter @o-okul/api typecheck`
- `pnpm --filter @o-okul/api test`
- `pnpm --filter @o-okul/api test -- api-error`
- `pnpm --filter @o-okul/api test -- api-response`
- `pnpm --filter @o-okul/api test -- api-version`
- `pnpm --filter @o-okul/api test -- tenant-query class-store schedule-store study-session-store homework-store`
- `pnpm --filter @o-okul/api test -- schedule`
- `pnpm --filter @o-okul/api test -- schedule-store`
- `pnpm --filter @o-okul/api test -- study-session`
- `pnpm --filter @o-okul/api test -- study-session-store`
- `pnpm --filter @o-okul/api test -- homework`
- `pnpm --filter @o-okul/api test -- homework-store`
- `pnpm --filter @o-okul/db lint`
- `pnpm --filter @o-okul/db db:rls:check`
- `pnpm postgres-stores:smoke`
- `node --check packages/db/scripts/check-rls-live.mjs`
- `pnpm --filter @o-okul/web test`
- `pnpm --filter @o-okul/web test:e2e`
- Lokal Playwright smoke: canlı local web+api ile program, etüt ve ödev kontrol panelleri görünür;
  kontrol sayacı `1/1` olur.
- `pnpm --filter @o-okul/db db:rls:check:live`

## Subagent notu

Subagent Faz 2 için en düşük riskli ilk dilimin bağımsız ödev API'si olmasını önerdi. Bu doğru ve
küçük bir alternatif olarak kaydedildi. Bu turda Faz 2 planındaki ilk madde olan ders programı zaman
çizelgesi seçildi; etüt ve ödev sonraki dilimlerde ele alınacak.

Sonraki subagent kontrolü bağımsız ödev kapsamını materyalsiz, class bağlı CRUD ile sınırlamayı
önerdi. Bu dilim eklendi; öğretmen rolüne özel yazma negatifi demo teacher kullanıcısı olmadığı için
ayrı kapsamda kaldı.

Program/ödev UI kontrolü için son subagent mevcut tek sayfalık web yüzeyinin korunmasını, yeni
router/refactor açılmamasını ve Playwright route mock'larıyla kanıt alınmasını önerdi. Bu turda
program/etüt/ödev panelleri aynı dashboard'a eklendi; ilk dilimde kontrol durumu local UI state ile
sınırlıydı, sonraki dilimde backend check-status endpointine bağlandı.

Ödev kontrol backend kontrolü için son subagent tek ödev bazlı `checkedAt/checkedBy` alanının yeterli
olduğunu, öğrenci bazlı teslim/kontrol modelinin ayrı ve daha büyük kapsam olduğunu belirtti. Bu
turda `PATCH /homework/:id/check-status` eklendi; teacher rolü tenant içi kontrol durumunu
işaretleyebilir, normal homework CRUD yazma yetkisi hâlâ tenant admin ile sınırlı kaldı.

Materyalden ödev için son subagent yeni materials modülü açılmamasını, Faz 2'de `homework` içinde
tenant izole demo materyal kaynağıyla kalınmasını önerdi. Bu turda `GET /homework/materials` ve
`POST /homework/from-material` eklendi; gerçek materyal havuzu, dosya yükleme ve kişiye özel materyal
atama sonra `homework` altında gerçek materyal havuzu endpointlerine taşındı.

Faz 2 DB/RLS kontrolü için son subagent beş tabloluk minimum seti önerdi: `ScheduleLesson`,
`StudySession`, `StudySessionStudent`, `HomeworkMaterial`, `Homework`. Bu tablo seti Prisma schema,
init migration, app role grant ve statik RLS kontrol listesine eklendi. Canlı DB olmadığı için servisler
ilk turda bu tablolara bağlanmadı; sonraki store dilimleri ve `pnpm postgres-stores:smoke` ile runtime
kanıtı alındı.

İlk DB-backed slice için son subagent `Homework` store interface + in-memory/Postgres store yolunu
önerdi. Bu slice içinde `HomeworkMaterial` okuma da store'a alındı; `ScheduleLesson` ve
`StudySession` DB geçişi sonra ayrı store dilimleriyle tamamlandı.

Sonraki subagent mevcut Faz 2 persistence risklerini karşılaştırdı ve `ScheduleLesson` store'u
önerdi; tek tablo olduğu için `StudySession` + `StudySessionStudent` geçişinden daha küçük ve
daha düşük riskli bulundu. Bu turda `ScheduleStore` eklendi; canlı Postgres/RLS kanıtı ayrı kapı
olarak kaldı ve sonra `pnpm postgres-stores:smoke` içinde alındı.

Sonraki subagent `StudySession` store tasarımında API yüzeyindeki `studentIds` alanının korunmasını,
Postgres store'da `StudySessionStudent` join tablosunun aggregate edilmesini ve create/update
akışlarında join satırlarının SQL parametre testiyle kilitlenmesini önerdi. Bu turda opt-in
`StudySessionStore` eklendi; transaction/atomiklik kanıtı unit test ve canlı DB smoke kapsamına alındı.

Sonraki subagent MASTER_PLAN'daki RLS tenant context şartına göre store metodlarına context parametresi
yaymak yerine `Queryable` wrapper kullanılmasını önerdi. Bu turda Postgres store SQL'leri
`withTenantQuery` ile sarıldı; gerçek Postgres üzerinde RLS davranışı `pnpm postgres-stores:smoke`
ile doğrulandı.

## Sonradan kapanan işler

- Faz 3 başlangıcı için worker tarafındaki saf ScoringEngine dilimi `docs/phase-3-report.md`
  altında takip edilmeye başlandı.
- DB-backed çakışma kontrolü `ScheduleLesson` ve `StudySession` Postgres store yazımlarında
  transaction içi advisory lock + insert/update öncesi overlap sorgusuyla sertleştirildi.
- Prisma `$extends` ikinci savunması yerine mevcut DB-backed yolda RLS, `withTenantQuery` /
  `withTenantDb` sarmalayıcıları ve `pnpm tenant-db:check` statik kapısı kullanılıyor.
- Demo materyal kaynağı gerçek materyal havuzu akışına taşındı: `POST /homework/materials`,
  materyal dosyası ekleme ve öğrenciye materyal atama endpointleri e2e test ve Postgres store SQL
  testiyle doğrulanıyor.

## Kalan işler

- Repo içi Faz 2 kapsamında açık geliştirme işi kalmadı; staging/prod kanıtları Faz 6 altında
  takip ediliyor.
