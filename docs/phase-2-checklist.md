# Faz 2 Uygulama Checklist'i

Bu dosya Faz 2 program, etüt ve ödev kapsamını küçük ve doğrulanabilir parçalara böler. Canlı dış
ortam kanıtları repo gate içinde ayrıca takip edilir.

## Varsayımlar

- İlk Faz 2 dilimi, planın ilk maddesi olan ders programı zaman çizelgesidir.
- Lokal Compose/Postgres smoke kanıtı repo gate içinde takip edilir.
- Etüt, materyalden ödev ve ödev kontrol ekranı bu fazda ayrı dilimler olarak ele alınır.
- Program kayıtları varsayılan olarak demo in-memory store ile tutulur; `SCHEDULE_STORE=postgres`
  opt-in DB yolu vardır. Tenant izolasyonu CI'da kırmızı çizgidir.
- Etüt kayıtları varsayılan olarak demo in-memory store ile tutulur; `STUDY_SESSION_STORE=postgres`
  opt-in DB yolu vardır.

## PR Sırası

| PR | Hedef | Sahip | Değişecek alan | Kanıt |
|---|---|---|---|---|
| 1 | Ders programı API temeli | backend-architect | `apps/api/src/program` | Kısmi: `schedule-lessons` tenant izole CRUD eklendi; class/teacher tenant doğrulaması, öğretmen saat çakışması `409` ve teacher okur-yazamaz RBAC e2e ile kanıtlandı |
| 2 | Etüt planlama API | backend-architect | `apps/api/src/program` | Kısmi: `study-sessions` tenant izole CRUD eklendi; sınıf/öğretmen/öğrenci tenant doğrulaması, kapasite, saat çakışması ve teacher okur-yazamaz RBAC e2e ile kanıtlandı |
| 3 | Bağımsız ve materyalden ödev API | backend-architect | `apps/api/src/homework` | Kısmi: materyalsiz class bağlı ödev CRUD ve demo materyalden ödev oluşturma eklendi; tenant liste/tekil erişim, class/material tenant doğrulaması, eksik classId/materialId, başka tenantId/class/material ve teacher yazamaz RBAC e2e ile kanıtlandı |
| 4 | Program grid ve ödev kontrol UI | frontend-architect | `apps/web` | Kısmi: dashboard altında ders programı, etüt planı ve ödev kontrol panelleri eklendi; Playwright ile görünüm ve backend check-status akışı kanıtlandı |
| 5 | Faz 2 kalite kapanışı | quality-engineer | testler, doküman | Tamam: Faz 2 DB şema/RLS zemini `ScheduleLesson`, `StudySession`, `StudySessionStudent`, `HomeworkMaterial`, `Homework` tablolarıyla eklendi; `SCHEDULE_STORE=postgres`, `STUDY_SESSION_STORE=postgres` ve `HOMEWORK_STORE=postgres` opt-in store yolları statik RLS kontrolü ve `pnpm postgres-stores:smoke` canlı DB kanıtıyla doğrulandı |

## Bu Turun Kanıtı

- `GET /schedule-lessons` tenant A için sadece tenant A program kayıtlarını döner.
- Tenant admin kendi tenant'ında ders programı create/update/delete yapabilir.
- Tenant A, tenant B class veya teacher ile ders programı oluşturamaz.
- Aynı öğretmenin çakışan saat aralığı `409 SCHEDULE_TEACHER_CONFLICT` ile engellenir.
- `GET /homework` tenant A için sadece tenant A ödevlerini döner.
- Tenant admin kendi tenant class'ı için bağımsız ödev create/update/delete yapabilir.
- Tenant A başka `tenantId` veya başka tenant class ile ödev oluşturamaz.
- Ödev başka tenant class kaydına taşınamaz; silinen ödev tekrar okununca `404` döner.
- `GET /homework/materials` tenant A için sadece tenant A demo materyallerini döner.
- Tenant admin kendi tenant materyalinden kendi tenant class'ına ödev oluşturabilir.
- Tenant A başka tenant class veya başka tenant materyali ile materyalden ödev oluşturamaz.
- Materyalden ödevde eksik `materialId` ve geçersiz `dueAt` reddedilir.
- `GET /study-sessions` tenant A için sadece tenant A etütlerini döner.
- Tenant admin kendi tenant'ında etüt create/update/delete yapabilir.
- Tenant A başka tenant `classId`, `teacherId`, `studentId` veya `tenantId` ile etüt oluşturamaz.
- Etüt kapasitesi öğrenci sayısını karşılamazsa istek reddedilir.
- Aynı öğretmenin çakışan etüt saatleri `409 STUDY_SESSION_TEACHER_CONFLICT` ile engellenir.
- Teacher rolü ders programı, ödev ve etüt kayıtlarını okuyabilir, ancak create/update/delete isteklerinde `403` alır.
- Web dashboard ders programı, etüt planı ve ödev kontrol panellerini gösterir.
- `PATCH /homework/:id/check-status` teacher rolüyle tenant içi ödev kontrol durumunu `checkedAt/checkedBy`
  olarak işaretler ve temizler.
- Tenant A başka tenant ödevinin kontrol durumunu değiştiremez; eksik `checked` body isteği `400` alır.
- Web ödev kontrol butonu backend check-status endpointine yazar ve sayaç response'taki `checkedAt`
  alanına göre güncellenir.
- Faz 2 DB zemini `ScheduleLesson`, `StudySession`, `StudySessionStudent`, `HomeworkMaterial` ve
  `Homework` tablolarını içerir.
- Faz 2 DB tablolarında FK, tenant indeksleri, `ENABLE/FORCE ROW LEVEL SECURITY`, `USING` ve
  `WITH CHECK` policy bulunur.
- `pnpm --filter @uzman-hocam/db db:rls:check` 12 tenant tablosunu statik olarak doğrular.
- Postgres store yolları `withTenantQuery` üzerinden transaction açar, `app.bypass_rls` ve
  `app.current_tenant_id` ayarlarını request context'e göre set eder; context yoksa DB erişimi
  reddedilir.
- Ders programı API varsayılan in-memory davranışı korur; `SCHEDULE_STORE=postgres` ile
  `ScheduleLesson` tablosuna giden opt-in store yolu vardır.
- Postgres schedule store SQL parametreleri unit test ile doğrulanır.
- Etüt API varsayılan in-memory davranışı korur; `STUDY_SESSION_STORE=postgres` ile
  `StudySession` ve `StudySessionStudent` tablolarına giden opt-in store yolu vardır.
- Postgres study session store SQL parametreleri unit test ile doğrulanır.
- Postgres schedule ve study session store yazımları aynı transaction içinde advisory lock alıp
  öğretmen/öğrenci saat çakışmasını insert/update öncesi yeniden kontrol eder; servis bu store
  hatalarını mevcut `409` hata kodlarına çevirir.
- `pnpm tenant-db:check`, tenant tablosuna ham SQL ile erişen API/worker dosyalarının
  `withTenantQuery` veya `withTenantDb` sarmalayıcısını kullanmasını statik olarak zorlar.
- Homework API varsayılan in-memory davranışı korur; `HOMEWORK_STORE=postgres` ile `Homework` ve
  `HomeworkMaterial` tablolarına giden opt-in store yolu vardır.
- Postgres homework store SQL parametreleri unit test ile doğrulanır.
- `pnpm postgres-stores:smoke` Class, Schedule, StudySession ve Homework/Material store yollarını
  canlı Postgres üzerinde create/update/list/check-status/soft-delete ve tenant izolasyonuyla
  doğrular.

## Kalan Riskler

- Program, etüt ve ödev API varsayılan olarak demo in-memory store kullanır; staging/prod env'de
  Postgres store değişkenleri zorunlu tutulur.
- Materyalden ödevde Postgres store ve dosya/atama DB yolu doğrulandı; ürün ekranındaki geniş
  materyal havuzu akışı hâlâ Faz 5 kapsamıdır.
- Prisma `$extends` ikinci savunması store katmanına taşınmadı; mevcut DB-backed yolda ikinci
  savunma RLS + `withTenantQuery`/`withTenantDb` statik kapısı ve servis katmanı tenant filtreleriyle
  sağlanır.
- Subagent bağımsız ödevi daha düşük riskli ilk dilim olarak önerdi; bu turda plan sırasına sadık kalıp
  program çizelgesi çekirdeği seçildi.
