# Multi-Tenant RBAC — Tasarım & Gap Analizi

**Tarih:** 2026-06-03
**Kapsam:** Kullanıcı grupları, yetki matrisi, veri mimarisi (Multi-Tenant + RBAC)
**Komut:** `/sc:design` — bu doküman tasarım + gap analizidir; implementasyon kararı için aşağıdaki "Önerilen Uygulama Planı" bölümüne bakın.

---

## 0. Yönetici Özeti — Kritik Bulgu

İstenen mimarinin **~%75'i zaten mevcut ve olgun** durumda. Sistem sıfırdan tasarlanacak bir
proje değil; RLS ile sertleştirilmiş, 44 migration'lı, e2e + canlı RLS testleri olan bir
kod tabanı. Dolayısıyla doğru yaklaşım "yeniden yazmak" değil, **gerçek boşlukları hedefli
şekilde kapatmak** ("bu yapıyı bozmadan" talebinizle birebir örtüşür).

**Zaten var olanlar (sağlam):**
- ✅ Gerçek tenant izolasyonu — PostgreSQL RLS + `set_config('app.current_tenant_id')` + composite FK'ler (`@@unique([tenantId, id])`). Sadece query-filter değil, DB seviyesinde zorlama.
- ✅ `SYSTEM_ADMIN` → `bypassRls` ile tenant'sız çalışıyor (`request-context.middleware.ts:23`).
- ✅ Roller: `SYSTEM_ADMIN, TENANT_ADMIN, TEACHER, STUDENT, GUARDIAN` + `TenantMembership` + `AuthSession`.
- ✅ Veli çoklu-çocuk self-service: `/me/guardian/students/:studentId/...` (finans, devamsızlık, karne, öğretmen notu, destek). Çocuklar arası geçiş `studentId` path param ile zaten çalışıyor.
- ✅ Finans erişimi doğru: `payment-plans` yalnız `TENANT_ADMIN`; veli kendi planını `/me` üzerinden görüyor; öğretmen/öğrenci kör.
- ✅ `TeacherAssignment` modeli (context-validation altyapısı), `GuardianStudent` (`canViewFinance`, `isPrimary`, bildirim tercihleri), `IdentityInvitation` (aktivasyon altyapısı).

**Gerçek boşluklar (bu dokümanın odağı):**
1. 🔴 **Müdür Yardımcısı rolü yok** — enum `TENANT_ADMIN`'den doğrudan `TEACHER`'a atlıyor.
2. 🔴 **Tenant lisans/paket modeli yok** — `Tenant` yalnız `status` taşıyor; paket, lisans bitişi, koltuk limiti yok.
3. 🟡 **Veli hesabı otomasyonu yok** — `StudentService.create()` veli/User auto-provision etmiyor (altyapı var, tetik yok).
4. 🟡 **Devamsızlık kritik-eşik uyarısı yok** — eşik/uyarı mekanizması bulunamadı.
5. 🟡 **Yapılandırılmış mentorluk/gelişim puanlaması yok** — `TeacherNote` tek `body` + `developmentStatus` string; periyodik kriter-bazlı puanlama tablosu değil.
6. 🟢 **Öğretmen context-validation** — `assertSubjectAccess` öğrencide var; not/ödev düzenlemede `TeacherAssignment` zorlaması doğrulanmalı/sertleştirilmeli.

---

## 1. Mevcut Mimari Haritası

### 1.1 Yetkilendirme katmanı
```
Request → SecurityHeaders → RequestContextMiddleware (JWT decode → AsyncLocalStorage ctx)
        → MetricsMiddleware → RolesGuard (APP_GUARD, global)
        → Controller (@Roles(...) decorator) → Service (assertAccess / assertSubjectAccess)
        → Store → withTenantQuery (BEGIN; set_config app.current_tenant_id; ... COMMIT)
                  └─ PostgreSQL RLS politikaları
```

- `RequestContext`: `{ userId, tenantId, roles[], bypassRls, subjectType?, subjectId? }`
- **RBAC modeli bugün: rank-based.** `roleRank: SYSTEM_ADMIN=5 > TENANT_ADMIN=4 > TEACHER=3 > STUDENT=2 > GUARDIAN=1`. `hasRole(roles, req)` → herhangi bir rolün rank'i ≥ gerekli ise geçer. Yani **kesin hiyerarşi**.

### 1.2 Rank-based modelin sınırı (Müdür Yardımcısı problemi)
Gereksinim: *Müdür Yardımcısı = akademik her şeyi yapar, finansa KÖR.*
Rank modeli bunu temsil **edemez**:
- Finans bugün `@Roles("TENANT_ADMIN")` (rank ≥ 4). Asistan rank 3.5 olursa finanstan otomatik bloklanır ✅ — *ama* öğretmen/sınıf/öğrenci oluşturma da bugün `TENANT_ADMIN` (rank 4) gated; asistan (3.5) **yanlışlıkla** bloklanır ❌.
- Tek bir rank değeri "admin eksi finans"ı ifade edemez. **Capability/permission tabanlı bir incelik gerekiyor.**

---

## 2. Gereksinim → Mevcut Durum Gap Matrisi

| # | Gereksinim | Durum | Aksiyon |
|---|-----------|-------|---------|
| 1 | SystemAdmin tenant'sız, kurumları yönetir | ✅ var (`bypassRls`) | Lisans modülü ekle (#3) |
| 2 | Tenant izolasyonu (DB/query seviyesi) | ✅ RLS + composite FK | — |
| 3 | Müdür (Kurum Sahibi) tüm modüller | ✅ `TENANT_ADMIN` | — |
| 4 | **Müdür Yardımcısı (akademik, finans hariç)** | 🔴 yok | **Yeni rol + capability RBAC** |
| 5 | Öğretmen atanan sınıf akademik süreçleri | ✅ `TEACHER` + `TeacherAssignment` | Context-validation sertleştir (#6) |
| 6 | Öğrenci kendi verisi | ✅ `/me/student/*` | — |
| 7 | Veli kendi öğrencisi, çoklu çocuk geçişi | ✅ `/me/guardian/students/:id/*` | — |
| 8 | Veli otomatik oluşturma (student create hook) | 🟡 altyapı var, tetik yok | **Provisioning servisi** |
| 9 | Sınav/gelişim: rol bazlı giriş; öğrenci/veli grafik+isimsiz sıralama | ✅ exam + report + progress | — |
| 10 | Ödev: öğretmen tanım, öğrenci teslim, veli izleme | ✅ homework + material assignments | — |
| 11 | Devamsızlık giriş + **kritik eşik uyarısı** | 🟡 giriş var, uyarı yok | **Eşik/uyarı mekanizması** |
| 12 | Finans: müdür plan; veli kendi; diğerleri kör | ✅ doğru gated | Asistan da kör kalmalı (#4) |
| 13 | Tenant isolation middleware (JWT→institution_id) | ✅ var | — |
| 14 | Context validation (öğretmen ↔ sınıf/ders) | 🟡 öğrencide var | not/ödev/yoklamada sertleştir |
| 15 | **Gelişim & mentorluk puanlama tablosu** | 🟡 `TeacherNote.developmentStatus` yetersiz | **Yapılandırılmış model** |

---

## 3. Hedef Tasarım

### 3.1 RBAC Evrimi: rank → rol + capability (en kritik karar)

**`TenantRole` enum'a `ASSISTANT_ADMIN` eklenir** (Prisma + `roles.ts`).

İki seçenek:

**Seçenek A — Minimal (rank + finans-capability eklentisi):**
- `ASSISTANT_ADMIN` rank = 3.5 (TEACHER ile TENANT_ADMIN arası, `roleRank`'ta 35/40 gibi tam sayı ölçek).
- Finans + lisans endpoint'leri `@Roles` yerine yeni bir `@RequireCapability("finance:manage")` ile gated → yalnız `TENANT_ADMIN`.
- Akademik yönetim endpoint'leri (teacher/class/student CRUD) `@Roles("ASSISTANT_ADMIN")`'a indirilir (rank ≥ 3.5 → admin + asistan geçer, öğretmen geçmez).
- **Trade-off:** Hızlı, mevcut guard'a minimal dokunuş. Ama "rank + tek capability" hibrit; uzun vadede yetki çeşitlenirse yine yetersiz.

**Seçenek B — Capability tabanlı (önerilen, sürdürülebilir):**
- Rol → capability seti eşlemesi (`role-capabilities.ts`). Örn:
  ```
  TENANT_ADMIN    : [*]  (academic:* , finance:* , staff:* , settings:*)
  ASSISTANT_ADMIN : [academic:* , staff:manage , student:manage , class:manage]   // finance:* YOK
  TEACHER         : [grade:write@assigned , homework:write@assigned , attendance:write@assigned , note:write]
  STUDENT         : [self:read]
  GUARDIAN        : [ward:read]
  ```
- Yeni `@RequireCapability(...)` decorator + `CapabilityGuard` (mevcut `RolesGuard` korunur, yanına eklenir; geriye dönük uyum).
- `@Roles` decorator'lı endpoint'ler aynen çalışır; kritik olanlar kademeli olarak capability'ye taşınır.
- **Trade-off:** Biraz daha fazla başlangıç eforu; ama yetki matrisi netleşir, test edilebilir, gelecekteki rol eklemeleri tek tabloda.

> **Öneri: Seçenek B.** Yetki matrisi gereksinimi (madde #4 + #12 çelişkisi) tam da rank modelinin kırıldığı yer; capability tablosu bunu temiz çözer ve mevcut `@Roles` guard'ını bozmaz.

**`request-context.ts` değişikliği:** ctx'e `capabilities: string[]` türetilmiş alan eklenir (rollerden hesaplanır; token'a yazmaya gerek yok, middleware'de türetilir).

### 3.2 Tenant Lisans/Paket Modeli (gap #2)

Prisma `Tenant` modeline alanlar:
```prisma
model Tenant {
  // ...mevcut...
  plan            String    @default("TRIAL")   // TRIAL | STANDARD | PRO
  licenseStartsAt DateTime?
  licenseEndsAt   DateTime?
  seatLimit       Int?                            // toplam kullanıcı/öğrenci limiti
  status          String    @default("ACTIVE")   // ACTIVE | SUSPENDED | EXPIRED
}
```
- `SYSTEM_ADMIN` için yeni `tenant.controller` (CRUD + lisans uzatma) — `bypassRls` ile.
- Lisans bitişi/expired kontrolü → `RequestContextMiddleware`'de tenant status guard (EXPIRED ise 402/403). Mevcut `PostgresTenantStore.findById` zaten `status = 'ACTIVE'` filtreliyor; `licenseEndsAt` kontrolü eklenir.
- `TenantStore.TenantRecord` `plan/license*` alanlarıyla genişletilir.

### 3.3 Veli Hesabı Otomasyonu (gap #8)

`StudentService.create()` içine, `input.guardian?` verildiğinde:
1. `GuardianStore.upsert` (tel/e-posta ile dedupe) → `Guardian` (Role: GUARDIAN niyeti).
2. `GuardianStudentStore.link(guardianId, studentId, { isPrimary, canViewFinance })`.
3. E-posta varsa `IdentityInvitationService.invite({ subjectType: "GUARDIAN", role: GUARDIAN, email })` → geçici şifre/aktivasyon (mock notification adapter zaten mevcut).
4. Hepsi aynı transaction + audit log (`guardian.auto_provisioned`).

> Mevcut `IdentityInvitation` + `notification-adapter` + `GuardianStudent` altyapısı bunu destekliyor; sadece `create()` akışına bağlanacak. Yeni model gerekmez.

### 3.4 Devamsızlık Kritik-Eşik Uyarısı (gap #11)

- Tenant/sınıf ayarına eşik (örn. dönemsel devamsızlık limiti) — minimal: `env`/sabit + sonra `AcademicTerm` veya tenant ayarı.
- `AttendanceService.record()` sonrası `summarizeStudent` → eşiğe yaklaşma/aşma kontrolü → `Announcement` veya `NotificationDevice` üzerinden sistem-içi uyarı (veli + ilgili admin/asistan).
- Yeni tablo gerekmez; mevcut announcement/notification altyapısı kullanılır. İstenirse `AttendanceAlert` audit kaydı.

### 3.5 Yapılandırılmış Gelişim & Mentorluk Modülü (gap #15)

Yeni modeller (mevcut `TeacherNote` korunur, yanına):
```prisma
model DevelopmentCriterion {        // tenant tanımlı esnek kriterler
  id        String @id @default(uuid())
  tenantId  String
  name      String                   // "Zihinsel disiplin", "Mücadele ruhu", "Odaklanma"
  scaleMin  Int    @default(1)
  scaleMax  Int    @default(5)
  sortOrder Int    @default(0)
  deletedAt DateTime?
  @@unique([tenantId, id])
  @@index([tenantId, deletedAt])
}

model DevelopmentAssessment {        // periyodik değerlendirme başlığı
  id         String @id @default(uuid())
  tenantId   String
  studentId  String
  teacherId  String
  termId     String?
  periodLabel String                 // "2026 Mart", "1. Dönem"
  mentorNote String?                 // veliye iletilecek mentorluk notu
  visibility String @default("GUARDIAN")  // INTERNAL | GUARDIAN
  createdAt  DateTime @default(now())
  @@index([tenantId, studentId, createdAt])
}

model DevelopmentScore {            // kriter bazlı puan
  id           String @id @default(uuid())
  tenantId     String
  assessmentId String
  criterionId  String
  score        Int
  @@unique([tenantId, assessmentId, criterionId])
}
```
- Öğretmen yazar (`@RequireCapability("note:write")` + context-validation: öğrenciye atanmış mı).
- Veli/öğrenci `visibility=GUARDIAN` olanları `/me/...` üzerinden grafik trendiyle görür (mevcut report progress paternine benzer).

### 3.6 Öğretmen Context-Validation Sertleştirme (gap #14)

`TeacherAssignment` üzerinden ortak bir `assertTeacherAssigned(context, { classId?, courseId?, studentId? })` helper'ı:
- Not/net girişi (exam), ödev (homework), yoklama (attendance), gelişim notu yazımında çağrılır.
- `TENANT_ADMIN`/`ASSISTANT_ADMIN` bypass (yönetim rolleri); `TEACHER` için atama zorunlu.
- Salt `institution_id` (tenant) kontrolüne ek katman — gereksinim #14 ile birebir.

---

## 4. Tam Yetki Matrisi (hedef)

| Modül / Aksiyon | SysAdmin | Müdür (TENANT_ADMIN) | Md.Yrd (ASSISTANT_ADMIN) | Öğretmen | Öğrenci | Veli |
|---|---|---|---|---|---|---|
| Kurum/Lisans yönetimi | CRUD | — | — | — | — | — |
| Öğretmen/Personel CRUD | — | CRUD | CRUD | — | — | — |
| Sınıf / Öğrenci CRUD | — | CRUD | CRUD | R (atanan) | R (kendi) | R (çocuk) |
| Sınav tanım + not/net | — | CRUD | CRUD | CRU (atanan) | R (kendi) | R (çocuk) |
| Gelişim trendi / sıralama | — | R | R | R (atanan) | R (kendi, isimsiz) | R (çocuk, isimsiz) |
| Ödev tanım / dosya | — | CRUD | CRUD | CRUD (atanan) | teslim | R (çocuk) |
| Devamsızlık giriş | — | CRUD | CRUD | CRU (atanan) | R (kendi) | R (çocuk) |
| Devamsızlık eşik uyarısı | — | alır | alır | — | — | alır |
| Mentorluk/Gelişim puanı | — | CRUD | CRUD | CRU (atanan) | R (kendi) | R (çocuk) |
| **Finans / Ödeme planı** | — | **CRUD** | **— (KÖR)** | **— (KÖR)** | **— (KÖR)** | **R (kendi çocuk)** |

> Md.Yrd'nın finansa körlüğü, capability tablosunda `finance:*`'in `ASSISTANT_ADMIN`'e verilmemesiyle sağlanır.

---

## 5. Önerilen Uygulama Planı (fazlı, kırılımsız)

| Faz | İçerik | Risk | Migration |
|-----|--------|------|-----------|
| **F1** | `ASSISTANT_ADMIN` enum + capability tablosu + `CapabilityGuard` + finans/staff endpoint'lerini capability'ye taşı | Orta (RBAC çekirdeği) | 1 (enum) |
| **F2** | Tenant lisans/paket alanları + SystemAdmin tenant controller + expiry guard | Düşük | 1 |
| **F3** | Veli auto-provisioning (`create()` hook + invitation) | Düşük (altyapı hazır) | 0 |
| **F4** | Öğretmen context-validation helper'ı (`assertTeacherAssigned`) tüm akademik yazımlara | Orta (regresyon riski) | 0 |
| **F5** | Devamsızlık eşik uyarısı | Düşük | 0 |
| **F6** | Gelişim/mentorluk modülü (3 model + controller + /me görünüm) | Orta | 1 |

Her faz: Prisma migration → store/service → controller guard → unit + e2e test → `db:rls:check`. Mevcut testler korunur; yeni roller için e2e access-matrix testleri (`me-access-matrix.e2e.test.ts` paterni) eklenir.

---

## 6. Kararlaştırılan Tasarım Seçimleri (onaylı — 2026-06-03)

1. **RBAC modeli:** ✅ **Seçenek B — Capability tabanlı.** Rol→yetki tablosu + `CapabilityGuard`; `finance:*` `ASSISTANT_ADMIN`'e verilmez. Mevcut `@Roles` guard'ı korunur, kritik endpoint'ler kademeli olarak `@RequireCapability`'ye taşınır.
2. **Müdür Yardımcısı enum adı:** ✅ **`ASSISTANT_ADMIN`** (mevcut `TENANT_ADMIN` ile tutarlı).
3. **Uygulama kapsamı:** ✅ **Tüm fazlar F1–F6.** Sıra ve bağımlılıklar §5'teki tabloya göre; F1 (RBAC çekirdeği) diğerlerinin önkoşuludur.

> Not: Bu doküman **yalnızca plandır**; implementasyon ayrı bir oturumda, faz faz (migration → store/service → guard → unit+e2e test → `db:rls:check`) yürütülecektir.

---

## 7. Faz Bağımlılık Grafiği ve Dosya Etki Listesi (uygulama referansı)

```
F1 (RBAC çekirdeği) ─┬─> F2 (lisans: SystemAdmin capability'leri F1'e dayanır)
                     ├─> F4 (context-validation: admin/asistan bypass F1 rollerine dayanır)
                     ├─> F5 (uyarı alıcıları admin/asistan rollerine dayanır)
                     └─> F6 (gelişim modülü guard'ları F1 capability'lerine dayanır)
F3 (veli otomasyon) ── F1'den bağımsız başlatılabilir (paralel)
```

**Faz bazında dokunulacak başlıca dosyalar:**

- **F1:** `packages/db/prisma/schema.prisma` (enum), yeni migration (`ALTER TYPE "TenantRole" ADD VALUE 'ASSISTANT_ADMIN'`), `apps/api/src/rbac/roles.ts`, yeni `rbac/role-capabilities.ts`, `rbac/capability.decorator.ts`, `rbac/capability.guard.ts`, `context/request-context.ts` (+`capabilities`), `context/request-context.middleware.ts`, `payment/payment.controller.ts` (+ staff/lisans controller'ları → capability), yeni `rbac/capability.guard.e2e.test.ts`, `prisma/seed.ts` (asistan demo hesabı).
- **F2:** `schema.prisma` (`Tenant` alanları) + migration, `tenant/tenant-store.ts` (record genişletme), yeni `tenant/tenant.controller.ts` + `tenant.service.ts` (SystemAdmin), `tenant/tenant-store.ts` expiry filtresi (`licenseEndsAt`).
- **F3:** `student/student.service.ts` (`create()` hook), `school/guardian-store.ts` (upsert), `school/guardian-student-store.ts` (link), `identity-invitation/identity-invitation.service.ts` (invite çağrısı), audit log.
- **F4:** yeni `rbac/teacher-assignment.guard.ts` veya `school/assert-teacher-assigned.ts` helper; çağrı noktaları: `exam/exam.service.ts` (not/net), `homework/homework.service.ts`, `attendance/attendance.service.ts`, F6 gelişim servisi.
- **F5:** `attendance/attendance.service.ts` (`record()` sonrası eşik), eşik ayarı (`config/env.ts` veya tenant ayarı), `announcement`/`notification-device` üzerinden uyarı, audit (`attendance.threshold_warned`).
- **F6:** `schema.prisma` (3 model) + migration + RLS grant, yeni `development/` modülü (store + service + controller), `me/me.controller.ts` (öğrenci/veli trend görünümü), `shared-types`.

**Test stratejisi:** Her faz kendi unit testleri + access-matrix e2e (`me-access-matrix.e2e.test.ts` paterni). Tüm fazlar sonunda `pnpm typecheck && pnpm test && pnpm db:rls:check`. ASSISTANT_ADMIN'in finansa körlüğü ve öğretmenin atanmamış sınıfa yazamaması açık negatif test senaryolarıyla doğrulanır.

---

## 8. Uygulama İlerleme Notu

**2026-06-03 — F1a tamamlandı (RBAC çekirdeği ilk dilim)**

- `TenantRole` enum'una `ASSISTANT_ADMIN` eklendi.
- Prisma migration eklendi: `20260603120000_add_assistant_admin_role`.
- Rol listesi ve rank modeli `ASSISTANT_ADMIN`'i `TENANT_ADMIN` ile `TEACHER` arasına alacak şekilde genişletildi.
- Capability altyapısı eklendi:
  - `rbac/role-capabilities.ts`
  - `rbac/capability.decorator.ts`
  - `rbac/capability.guard.ts`
- `RequestContextMiddleware`, rollere göre capability listesini request context'e türetiyor.
- `CapabilityGuard`, `APP_GUARD` olarak bağlandı.
- Finans endpoint'leri `@Roles("TENANT_ADMIN")` yerine `@RequireCapability("finance:manage")` ile korunmaya başladı.

**Bilinçli kapsam dışı bırakılanlar / sonraki F1 adımı**

- Staff/akademik yönetim endpoint'leri henüz capability'ye taşınmadı.
- `ASSISTANT_ADMIN` demo seed hesabı henüz eklenmedi.
- Access-matrix testleri henüz yazılmadı/çalıştırılmadı.

**Sıradaki önerilen adım: F1b**

Staff ve akademik yönetim yüzeyleri capability'ye taşınmalı:

- öğretmen/personel yönetimi: `staff:manage`
- sınıf/şube yönetimi: `class:manage`
- öğrenci yönetimi: `student:manage`
- akademik operasyonlar: `academic:manage`

Bu adımın negatif kabul testi: `ASSISTANT_ADMIN` finans endpoint'lerinde 403 almalı, ama öğretmen/sınıf/öğrenci yönetiminde yetkili olmalı.

**2026-06-03 — F1b tamamlandı (seçili akademik/staff CRUD kapıları)**

- Öğretmen ve öğretmen ataması yazma/silme uçları `staff:manage` ile korunmaya başladı.
- Sınıf, kampüs ve kademe yazma/silme uçları `class:manage` ile korunmaya başladı.
- Ders ve akademik takvim yazma/silme uçları `academic:manage` ile korunmaya başladı.
- Öğrenci kayıt, import, profil, enrollment ve silme uçları `student:manage` ile korunmaya başladı.
- Veli oluşturma/güncelleme ve öğrenci-veli bağlantı uçları `student:manage` ile korunmaya başladı.
- Sınav, cevap anahtarı, ödev ve rapor üretim işi başlatma uçları `academic:manage` ile korunmaya başladı.

**F1b'de bilerek müdürde bırakılan hassas uçlar**

- Öğretmen/öğrenci/veli PII purge uçları hâlâ `TENANT_ADMIN`.
- Öğrenciyi tenant değiştirme ucu hâlâ `TENANT_ADMIN`.
- Kullanıcı rol atama / tenant user management hâlâ `TENANT_ADMIN`.
- Identity invitation uçları hâlâ `TENANT_ADMIN`; Md.Yrd davet yetkisi gerekiyorsa rol yükseltme riskini engelleyen ek kontrolle açılmalı.
- Raw import ve parser config yönetimi bu dilimde açılmadı; bunlar ayrı akademik altyapı kararı olarak ele alınmalı.

**Sıradaki önerilen adım: F1c**

- `ASSISTANT_ADMIN` demo seed hesabı ekle.
- `CapabilityGuard` için unit test yaz.
- Access-matrix e2e testi ekle:
  - `ASSISTANT_ADMIN` finans endpoint'lerinde 403 alır.
  - `ASSISTANT_ADMIN` öğretmen/sınıf/öğrenci/akademik yönetim uçlarında geçer.
  - `TEACHER` capability gerektiren yönetim uçlarında 403 alır.

**2026-06-03 — F1c kısmen tamamlandı (seed + unit test iskeleti)**

- Demo seed'e `assistant@demo.local` / `Demo Müdür Yardımcısı` kullanıcısı eklendi.
- `role-capabilities.test.ts` eklendi:
  - `TENANT_ADMIN` finans + akademik yönetim capability'sine sahip.
  - `ASSISTANT_ADMIN` akademik/staff/student yönetimine sahip, finansı yok.
  - `TEACHER` yönetim capability'lerine sahip değil.
- `capability.guard.test.ts` eklendi:
  - capability varsa geçiş verir.
  - `ASSISTANT_ADMIN` finans capability'sinde 403 alır.
  - `ASSISTANT_ADMIN` akademik capability ile geçer.

**F1c'de kalan doğrulama işi**

- Unit testler henüz çalıştırılmadı.
- Access-matrix e2e testi eklendi ama henüz çalıştırılmadı.
- Demo login için seed sonrası canlı `/auth/login` smoke henüz yapılmadı.

**2026-06-03 — F1c e2e kapsamı eklendi**

- In-memory auth fixture'a `assistant-a@example.test` eklendi.
- `capability-access.e2e.test.ts` eklendi:
  - `ASSISTANT_ADMIN` `/payment-plans` üzerinde 403 alır.
  - `ASSISTANT_ADMIN` `/exams` üzerinde akademik yazma yapar.
  - `TEACHER` aynı akademik yazma endpoint'inde 403 alır.

**2026-06-03 — F2a tamamlandı (tenant lisans/paket çekirdeği)**

- `Tenant` modeline lisans alanları eklendi:
  - `plan`
  - `licenseStartsAt`
  - `licenseEndsAt`
  - `seatLimit`
- Prisma migration eklendi: `20260603123000_add_tenant_license_fields`.
- `TenantStore` genişletildi:
  - `list`
  - `findForAdmin`
  - `create`
  - `update`
  - `findById` artık yalnız `ACTIVE` ve lisansı bitmemiş tenant döndürür.
- `RequestContextMiddleware`, bearer token içindeki tenant için aktif/lisans geçerli kontrolü yapıyor; geçersiz tenant `TENANT_INACTIVE_OR_EXPIRED` ile kapanır.
- SystemAdmin tenant yönetim yüzeyi eklendi:
  - `GET /tenants`
  - `GET /tenants/:id`
  - `POST /tenants`
  - `PATCH /tenants/:id`
- Bu tenant yönetim yüzeyi `tenant:manage` capability'si ve servis içinde ek `SYSTEM_ADMIN` kontrolüyle korunur.
- F2 unit test iskeletleri eklendi:
  - `tenant-store.test.ts`
  - `tenant.service.test.ts`

**F2a'da kalan doğrulama işi**

- Migration henüz çalıştırılmadı.
- Unit/e2e/typecheck henüz çalıştırılmadı.
- SystemAdmin canlı login + `/tenants` smoke henüz yapılmadı.

**Sıradaki önerilen adım: F2b**

- SystemAdmin tenant controller için endpoint-level e2e testi ekle:
  - `SYSTEM_ADMIN` `/tenants` görebilir.
  - `TENANT_ADMIN` `/tenants` göremez.
  - expired/suspended tenant normal bearer request'te kapanır.
- İstenirse tenant lisans güncellemesi için audit log ekle.

**2026-06-03 — F2b tamamlandı (tenant endpoint e2e kapsamı)**

- In-memory tenant fixture'a expired demo tenant eklendi: `tenant-expired`.
- In-memory auth fixture'a expired tenant kullanıcısı eklendi: `expired-tenant@example.test`.
- `tenant.controller.e2e.test.ts` eklendi:
  - `SYSTEM_ADMIN` tenant listesini görür.
  - `SYSTEM_ADMIN` tenant oluşturur ve lisans/status alanlarını günceller.
  - `TENANT_ADMIN` tenant yönetim endpoint'lerine giremez.
  - expired tenant bearer token ile normal request başlatamaz.

**F2b'de kalan doğrulama işi**

- E2E test henüz çalıştırılmadı.
- Typecheck henüz çalıştırılmadı.
- Canlı DB migration/smoke henüz yapılmadı.

**Sıradaki önerilen adım: F2c**

- Tenant lisans güncellemesi için audit log ekle.
- F1/F2 odaklı doğrulama komutlarını çalıştır:
  - RBAC/tenant unit testleri
  - tenant controller e2e
  - typecheck

**2026-06-03 — F2c tamamlandı (tenant lisans audit izi)**

- `TenantService.create()` artık `tenant.created` audit kaydı yazar.
- `TenantService.update()` artık `tenant.updated` audit kaydı yazar.
- Audit kaydı hedef tenant id'si, SystemAdmin actor id'si, entity bilgisi ve lisans/status diff alanlarını içerir.
- `tenant.service.test.ts` içinde create + lisans update audit beklentisi eklendi.

**F2 genel kalan doğrulama işi**

- F1/F2 unit testleri henüz çalıştırılmadı.
- Tenant controller e2e testi henüz çalıştırılmadı.
- Typecheck henüz çalıştırılmadı.
- Canlı DB migration/smoke henüz yapılmadı.

**Sıradaki önerilen adım: F3**

- `StudentService.create()` içinde veli auto-provisioning akışını ekle.
- Yeni model açmadan mevcut `Guardian`, `GuardianStudent` ve `IdentityInvitation` altyapısını kullan.
- Kabul testi:
  - öğrenci oluştururken guardian bilgisi verilirse veli kaydı oluşur veya mevcut veli bulunur.
  - veli-öğrenci link'i kurulur.
  - e-posta varsa invitation üretilir.
  - işlem tenant sınırını aşmaz.

**2026-06-03 — F3a tamamlandı (veli auto-provisioning çekirdeği)**

- `StudentService.create()` artık `guardian` alanı verilirse veli otomasyonu çalıştırır.
- Mevcut modelde `Guardian` e-posta alanı taşımadığı için dedupe telefon üzerinden yapılır.
- Telefon eşleşirse mevcut veli tekrar kullanılır.
- Telefon eşleşmezse yeni `Guardian` oluşturulur.
- `GuardianStudent` link'i mevcut store üzerinden kurulur.
- E-posta verilirse ve veli henüz kullanıcıya bağlı değilse `IdentityInvitationService.create()` ile guardian invitation üretilir.
- `guardian.auto_provisioned` audit kaydı yazılır.
- `ASSISTANT_ADMIN` için servis katmanı tenant/subject helper'ı da yönetici kapsamına alındı; capability kapısından geçen Md.Yrd servis katmanında gereksiz 403 almaz.
- `student.service.test.ts` eklendi:
  - yeni veli + link + invitation + audit
  - telefon eşleşince mevcut veli reuse

**F3a'da bilinçli sınırlar**

- E-posta bazlı veli dedupe yapılmadı; bunun için `Guardian` modeline e-posta alanı eklemek gerekir.
- Öğrenci oluşturma, veli oluşturma, link ve invitation henüz tek DB transaction altında değil; mevcut store mimarisi bu işlemleri ayrı çağrılarla yapıyor.
- Unit test henüz çalıştırılmadı.

**Sıradaki önerilen adım: F3b**

- Guardian e-posta alanı isteniyorsa küçük migration + store/shared type genişletmesiyle e-posta dedupe ekle.
- Alternatif olarak önce mevcut F3a kapsamını test/typecheck ile doğrula.

**2026-06-03 — F4a tamamlandı (öğretmen atama helper'ı)**

- Ortak `assertTeacherAssigned` helper'ı eklendi.
- Helper davranışı:
  - `SYSTEM_ADMIN`, `TENANT_ADMIN`, `ASSISTANT_ADMIN` için atama aramaz.
  - `TEACHER` için `subjectType=TEACHER` ve `subjectId` ister.
  - Atanmış sınıf, öğrenci veya ders kapsamı yoksa `FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE` döner.
  - Hedef kapsam verilmezse `TEACHER_ASSIGNMENT_SCOPE_REQUIRED` döner.
- Unit test eklendi: `assert-teacher-assigned.test.ts`.

**F4a'da bilinçli sınırlar**

- Helper henüz attendance/homework/exam/teacher-note yazma noktalarına bağlanmadı.
- Çağrı noktalarını tek tek bağlamak regresyon riski taşıdığı için F4b/F4c olarak ayrıldı.

**Sıradaki önerilen adım: F4b**

- `AttendanceService.create/update/delete` yazma yollarına `assertTeacherAssigned` bağla.
- Sonra `TeacherNoteService.create/update/delete` için aynı helper'ı kullan.

**2026-06-03 — F4b tamamlandı (attendance + teacher-note bağlama)**

- `AttendanceService` artık `TeacherAssignmentStore` alıyor.
- `AttendanceService.create/update` yazma yolları `assertTeacherAssigned` ile kontrol ediliyor.
- Attendance tek kayıt erişiminde kullanılan öğretmen scope çözümü `TeacherAssignment` helper'ına taşındı.
- `TeacherNoteService` artık `TeacherAssignmentStore` alıyor.
- `TeacherNoteService.create/update` yazma yolları `assertTeacherAssigned` ile kontrol ediliyor.
- Teacher note öğrenci scope çözümü `TeacherAssignment` helper'ına taşındı.
- F4a'daki helper unit testi bu karar mantığını kapsıyor; attendance/teacher-note e2e dosyalarında kapsam dışı öğretmen 403 senaryoları sonradan belirlendi, ancak henüz çalıştırılmadı.

**F4b'de kalan doğrulama işi**

- Attendance/teacher-note servis bağlama davranışı henüz test/typecheck ile çalıştırılmadı.
- Öğretmenin atanmamış öğrenciye yoklama/not yazamaması için mevcut endpoint-level negatif e2e senaryoları henüz çalıştırılmadı.

**Sıradaki önerilen adım: F4c**

- `HomeworkService` akademik yazma yollarına `assertTeacherAssigned` bağla.
- `ExamService` not/net/participant yazma yollarında öğretmen-atama kapsamını sertleştir.

**2026-06-03 — F4c tamamlandı (homework + exam bağlama)**

- `HomeworkService` artık `TeacherAssignmentStore` alıyor.
- `HomeworkService.assignMaterial()` öğrenci/sınıf/ders/dönem kapsamını `assertTeacherAssigned` ile kontrol ediyor.
- `HomeworkService.create()` ve `createFromMaterial()` sınıf kapsamını `assertTeacherAssigned` ile kontrol ediyor.
- `HomeworkService.update()`, `delete()` ve `updateCheckStatus()` mevcut ödevin sınıf kapsamını `assertTeacherAssigned` ile kontrol ediyor.
- `ExamService` artık `StudentStore` ve `TeacherAssignmentStore` alıyor.
- `ExamService.addParticipant()` öğrenci tenant kontrolü yapıyor ve öğrenci/sınıf kapsamını `assertTeacherAssigned` ile kontrol ediyor.

**F4c'de bilinçli sınırlar**

- Sınav oluşturma/yayınlama sınıf veya öğrenci kapsamı taşımadığı için helper'a bağlanmadı; bu uçlar capability ile yönetici/asistan alanında kalıyor.
- Homework/exam için mevcut e2e dosyalarında ilgili negatif kapsam senaryoları sonradan belirlendi, ancak henüz çalıştırılmadı.
- Test/typecheck henüz çalıştırılmadı.

**F4 genel kalan doğrulama işi**

- Öğretmenin atanmamış öğrenciye attendance/teacher-note/homework/exam participant yazamaması için mevcut e2e negatif testleri çalıştır.
- `ASSISTANT_ADMIN` aynı akademik yazma yollarından geçerken finans uçlarında kapalı kalmalı.

**Sıradaki önerilen adım: F5**

- Devamsızlık kritik-eşik uyarısı için mevcut notification/announcement altyapısını kullanarak küçük eşik kontrolü ekle.

**2026-06-03 — F5a tamamlandı (devamsızlık eşik uyarısı)**

- `AttendanceService.create/update` sonrası devamsızlık sayısı kontrol ediliyor.
- Eşik şimdilik `ATTENDANCE_ABSENCE_WARNING_THRESHOLD` env değeriyle, yoksa `5` olarak çalışıyor.
- Öğrenci eşik altından eşiğe ilk kez çıkarsa uyarı üretiliyor.
- Mevcut `Announcement` modeli tek öğrenci hedeflemediği için duyuru sınıf velilerine genel ve PII içermeyen metinle gönderiliyor.
- Kesin öğrenci/eşik kanıtı `attendance.threshold_warned` audit kaydında tutuluyor.
- `attendance.service.test.ts` eklendi:
  - 5. devamsızlıkta veli duyurusu üretir.
  - audit kaydında öğrenci, önceki/yeni devamsızlık sayısı, eşik ve announcement id görünür.

**F5a'da bilinçli sınırlar**

- Tek öğrenci hedefli notification yok; mevcut `Announcement` modeli `studentId` hedefi taşımıyor.
- Admin/asistan alıcılığı doğrudan bildirim olarak değil, audit görünürlüğü olarak kaldı.
- Eşik tenant bazlı ayar değil, env/sabit bazlı.
- Test/typecheck henüz çalıştırılmadı.

**Sıradaki önerilen adım: F5b**

- Tek öğrenci hedefli bildirim gerekiyorsa `Announcement` veya ayrı notification modeline `studentId`/recipient hedefi ekle.
- Tenant bazlı devamsızlık eşik ayarı gerekiyorsa F2 lisans/settings yüzeyinden ayrı tenant setting modeli ekle.

**2026-06-03 — F6a tamamlandı (gelişim/mentorluk backend çekirdeği)**

- Prisma modelleri eklendi:
  - `DevelopmentCriterion`
  - `DevelopmentAssessment`
  - `DevelopmentScore`
- Migration eklendi: `20260603130000_add_development_assessments`.
- Migration içinde tenant RLS politikaları eklendi.
- Yeni backend modülü eklendi:
  - `development-store.ts`
  - `development.service.ts`
  - `development.controller.ts`
- AppModule bağlantıları yapıldı.
- API yüzeyi eklendi:
  - `GET /development/criteria`
  - `POST /development/criteria`
  - `GET /development/assessments?studentId=...`
  - `POST /development/assessments`
- `POST /development/criteria` `academic:manage` capability ister.
- `POST /development/assessments` öğretmen için `assertTeacherAssigned` ile atanmış öğrenci/sınıf kapsamı kontrol eder.
- Admin/asistan rolleri aynı helper üzerinden atama kontrolünden geçmeden değerlendirme yazabilir.
- Skorlar kriter aralığına göre validate edilir.
- Audit izi eklendi:
  - `development_criterion.created`
  - `development_assessment.created`
- Unit test iskeleti eklendi: `development.service.test.ts`.

**F6a'da bilinçli sınırlar**

- Öğrenci/veli `/me/...` trend görünümü henüz eklenmedi.
- Gelişim skor grafik formatı henüz shared type veya frontend yüzeyine taşınmadı.
- Criterion update/delete yok; ilk dilimde sadece oluşturma/listeme var.
- Assessment update/delete yok; ilk dilimde sadece oluşturma/listeme var.
- Test/typecheck/migration henüz çalıştırılmadı.

**Sıradaki önerilen adım: F6b**

- Öğrenci ve veli için görünür değerlendirme listesi/trend endpoint'i ekle:
  - `/me/student/development-assessments`
  - `/me/guardian/students/:studentId/development-assessments`
- Sadece `visibility=GUARDIAN` kayıtları göster.
- Skorları kriter adı ve dönem etiketiyle trend formatına dönüştür.

**2026-06-03 — F6b tamamlandı (`/me` öğrenci/veli görünümü)**

- `DevelopmentService` içine subject-safe görünüm metotları eklendi:
  - `listCurrentStudent`
  - `listCurrentGuardianStudent`
- Öğrenci/veli görünümü sadece `visibility=GUARDIAN` değerlendirmeleri döndürür.
- Guardian erişiminde `GuardianStudent` bağlantısı kontrol edilir.
- `MeController` endpoint'leri eklendi:
  - `GET /me/student/development-assessments`
  - `GET /me/guardian/students/:studentId/development-assessments`
- `development.service.test.ts` içinde görünürlük testi eklendi:
  - öğrenci/veli `GUARDIAN` kaydı görür.
  - `INTERNAL` kayıt `/me` yüzeyine sızmaz.

**F6b'de bilinçli sınırlar**

- Trend response henüz grafik dostu özel formata dönüştürülmedi; değerlendirme + skor listesi dönüyor.
- Kriter adı skor cevabına join edilmedi; frontend isterse F6c'de DTO genişletilecek.
- Test/typecheck henüz çalıştırılmadı.

**Sıradaki önerilen adım: F6c**

- Development assessment response DTO'sunu kriter adı, period label ve seri formatıyla trend-ready hale getir.
- Frontend öğrenci/veli görünümüne gelişim trendi paneli ekle.

**2026-06-03 — F6c tamamlandı (`/me` trend-ready DTO)**

- Öğrenci/veli `/me` gelişim response'u `DevelopmentTrendItem` tipine taşındı.
- Her skor artık grafik için gerekli kriter bilgisini taşır:
  - `criterionId`
  - `criterionName`
  - `score`
  - `scaleMin`
  - `scaleMax`
- Assessment seviyesinde `periodLabel`, `mentorNote`, `visibility`, `createdAt` korunur.
- `MeController` return tipleri güncellendi:
  - `GET /me/student/development-assessments`
  - `GET /me/guardian/students/:studentId/development-assessments`
- `development.service.test.ts` görünürlük testine kriter adı + ölçek beklentisi eklendi.

**F6c'de bilinçli sınırlar**

- Frontend trend paneli F6d ile eklendi; henüz typecheck/build/smoke çalıştırılmadı.
- Response bilinçli olarak assessment listesi şeklinde bırakıldı; ayrıca pivot edilmiş seri formatı istenirse ayrı küçük faz olarak eklenebilir.
- Test/typecheck henüz çalıştırılmadı.

**Sıradaki önerilen adım: Frontend/F6d veya doğrulama**

- Öğrenci/veli web görünümünde gelişim trend paneli ekle.
- Alternatif olarak F1-F6 backend değişiklikleri için odaklı test + typecheck doğrulaması yap.

### İlerleme notu - F6d portal gelişim paneli (2026-06-03)

- Öğrenci portalı `/me/student/development-assessments` verisini okumaya bağlandı.
- Veli portalı seçili öğrenci için `/me/guardian/students/:studentId/development-assessments` verisini okumaya bağlandı.
- Ortak `DevelopmentTrendPanel` bileşeni gelişim dönemini, mentor notunu ve kriter puanlarını aynı görünümde listeliyor.
- Panel yalnızca backend'in görünür kıldığı gelişim kayıtlarını gösterir; gizlilik kuralı backend `/me` uçlarında kalır.
- Bu turda test veya build çalıştırılmadı.

### İlerleme notu - F6d shared-types uyumu (2026-06-03)

- `DevelopmentTrendItem`, `DevelopmentTrendScore` ve `DevelopmentAssessmentVisibility` ortak `@o-okul/shared-types` paketine eklendi.
- Portal gelişim paneli yerel DTO tanımı yerine ortak tipi kullanacak şekilde sadeleştirildi.
- Bu turda test veya build çalıştırılmadı.

### İlerleme notu - F6d DTO yüzeyi daraltma (2026-06-03)

- `/me` gelişim trendi cevabı ortak `DevelopmentTrendItem` tipine bağlandı.
- Öğrenci/veli portalına dönen DTO artık assessment kaydını komple yaymak yerine yalnızca `id`, `periodLabel`, `mentorNote`, `visibility`, `createdAt` ve kriter puanlarını içeriyor.
- Bu değişiklik portal görünümünü değiştirmez; sadece yanıt yüzeyini daha kontrollü hale getirir.
- Bu turda test veya build çalıştırılmadı.

### İlerleme notu - F4 negatif e2e kapsamı belirlendi (2026-06-03)

- Mevcut e2e dosyalarında öğretmen kapsamı için negatif senaryolar bulundu ve F4 doğrulama kapsamına bağlandı:
  - `attendance.e2e.test.ts`: öğretmen kapsam dışı öğrenciye devamsızlık yazamaz ve özetini göremez.
  - `teacher-note.e2e.test.ts`: öğretmen kapsam dışı öğrenciye öğretmen notu yazamaz ve listede göremez.
  - `homework.e2e.test.ts`: öğretmen kapsam dışı öğrenciye materyal atayamaz, kapsam dışı ödevi göremez/check edemez.
  - `exam.controller.e2e.test.ts`: öğretmen sınav katılımcısı ekleyemez.
- Bu turda testler çalıştırılmadı; not yalnızca mevcut test dosyalarındaki kapsamın plana işlenmesidir.

### İlerleme notu - F6 DTO test beklentisi güçlendirildi (2026-06-03)

- `development.service.test.ts` öğrenci/veli trend cevabında `tenantId`, `studentId` ve `teacherId` alanlarının dönmediğini açıkça bekleyecek şekilde güncellendi.
- Bu test beklentisi `/me` gelişim trendi yüzeyinin dar DTO olarak kalmasını korur.
- Bu turda test veya build çalıştırılmadı.

## 9. Güncel Tamamlama ve Doğrulama Matrisi (2026-06-03)

Bu bölüm, F1-F6 geliştirmelerinin mevcut durumunu kod kapsamı ve çalıştırılmış kanıt olarak ayırır. Kod eklenmiş olması tek başına tamamlandı kanıtı sayılmaz; ilgili test/smoke komutu çalışmadan doğrulama açık kalır.

| Faz | Kod kapsamı | Mevcut kanıt | Açık kapı |
| --- | --- | --- | --- |
| F1 RBAC çekirdeği | `ASSISTANT_ADMIN`, capability tablosu, guard, finans/akademik/staff/student capability kapıları ve access-matrix test dosyası eklendi. | Dosya ve test kapsamı mevcut. | RBAC unit/e2e ve typecheck henüz çalıştırılmadı. |
| F2 tenant lisansı | Tenant lisans alanları, middleware lisans kontrolü, SystemAdmin tenant API ve audit izi eklendi. | Store/service/controller test kapsamı mevcut. | Migration, tenant e2e, typecheck ve canlı smoke henüz çalıştırılmadı. |
| F3 veli auto-provisioning | Öğrenci oluşturma sırasında telefon bazlı veli reuse/create, link, invitation ve audit eklendi. | Unit test kapsamı mevcut. | Test çalıştırılmadı; e-posta dedupe model değişikliği bilinçli kapsam dışında. |
| F4 öğretmen kapsam doğrulama | `assertTeacherAssigned` helper'ı attendance, teacher-note, homework, exam participant ve development assessment yazma yollarına bağlandı. | Mevcut e2e dosyalarında kapsam dışı öğretmen 403 senaryoları bulundu. | İlgili e2e setleri ve typecheck henüz çalıştırılmadı. |
| F5 devamsızlık eşik uyarısı | Attendance create/update sonrası eşik kontrolü, PII içermeyen veli duyurusu ve audit izi eklendi. | Unit test kapsamı mevcut. | Test çalıştırılmadı; tek öğrenci hedefli notification ve tenant bazlı eşik ayarı kapsam dışında. |
| F6 gelişim/mentorluk | Prisma modelleri, migration/RLS, development API, `/me` trend uçları, shared-types ve web portal paneli eklendi. | Unit test kapsamı ve frontend bağlantısı mevcut. | Migration, unit/e2e/typecheck/build ve canlı portal smoke henüz çalıştırılmadı. |

### Çalıştırılmadan kapanmayacak doğrulama kapıları

1. RBAC/capability doğrulaması:
   - `role-capabilities.test.ts`
   - `capability.guard.test.ts`
   - `capability-access.e2e.test.ts`

2. Tenant lisans doğrulaması:
   - `tenant-store.test.ts`
   - `tenant.service.test.ts`
   - `tenant.controller.e2e.test.ts`

3. Öğretmen kapsam doğrulaması:
   - `assert-teacher-assigned.test.ts`
   - `attendance.e2e.test.ts`
   - `teacher-note.e2e.test.ts`
   - `homework.e2e.test.ts`
   - `exam.controller.e2e.test.ts`

4. F3-F6 servis davranışı:
   - `student.service.test.ts`
   - `attendance.service.test.ts`
   - `development.service.test.ts`

5. Genel kapılar:
   - API typecheck
   - Web typecheck/build
   - Prisma migration/RLS kontrolü
   - Öğrenci ve veli portalında gelişim paneli smoke

### Şu anki karar

- F1-F6 için ana kod geliştirme kapsamı tamamlanmış görünüyor.
- Tamamlama iddiası için kanıt henüz yeterli değil; çünkü test, typecheck, migration ve canlı smoke çalıştırılmadı.
- Bir sonraki güvenli adım doğrulama izni alınırsa yukarıdaki kapıları küçük gruplar halinde çalıştırmaktır.

## 10. Önerilen Doğrulama Runbook'u

Bu runbook, F1-F6 kod kapsamı sonrası doğrulamayı küçük ve izlenebilir parçalara böler. Amaç tek komutla büyük hata yığını almak değil; her fazın kapısını ayrı kapatmaktır.

### 10.1 RBAC ve tenant lisans kapısı

**Amaç:** F1 ve F2'nin yetki/lisans davranışını önce izole doğrulamak.

Önerilen sıra:

1. RBAC unit testleri
   - Başarı ölçütü: rol-capability haritası ve `CapabilityGuard` davranışı yeşil olmalı.

2. RBAC access-matrix e2e
   - Başarı ölçütü: `ASSISTANT_ADMIN` finans uçlarında 403 almalı, akademik yazma yolunda geçmeli; `TEACHER` yönetim yazma yolunda 403 almalı.

3. Tenant unit/e2e testleri
   - Başarı ölçütü: `SYSTEM_ADMIN` tenant yönetebilmeli; `TENANT_ADMIN` tenant yönetiminden kapalı kalmalı; expired tenant bearer request'i `TENANT_INACTIVE_OR_EXPIRED` ile kapanmalı.

### 10.2 Akademik kapsam kapısı

**Amaç:** F3-F5 davranışını tenant ve öğretmen kapsamı açısından doğrulamak.

Önerilen sıra:

1. Veli auto-provisioning unit testi
   - Başarı ölçütü: guardian create/reuse, guardian-student link, invitation ve audit beklentileri geçmeli.

2. Öğretmen atama helper unit testi
   - Başarı ölçütü: admin/asistan bypass, öğretmen kapsam kontrolü ve kapsam dışı 403 davranışı geçmeli.

3. Attendance, teacher-note, homework ve exam e2e testleri
   - Başarı ölçütü: öğretmen kapsam dışı öğrenciye/sınıfa yazamamalı; tenant sınırı aşılmamalı.

4. Devamsızlık eşik unit testi
   - Başarı ölçütü: eşik ilk geçildiğinde PII içermeyen duyuru ve audit üretilmeli.

### 10.3 Gelişim/mentorluk kapısı

**Amaç:** F6 backend, shared-types ve portal yüzeyini doğrulamak.

Önerilen sıra:

1. Development service unit testi
   - Başarı ölçütü: kriter/skor validasyonu, `GUARDIAN` görünürlük filtresi ve dar `/me` DTO yüzeyi geçmeli.

2. API typecheck
   - Başarı ölçütü: `DevelopmentTrendItem` ortak tipi API tarafında derlenmeli; controller/service import'ları kırılmamalı.

3. Web typecheck/build
   - Başarı ölçütü: öğrenci ve veli portalı `DevelopmentTrendPanel` ve ortak shared-type import'u ile derlenmeli.

4. Portal smoke
   - Başarı ölçütü: öğrenci portalında `/me/student/development-assessments`, veli portalında `/me/guardian/students/:studentId/development-assessments` çağrıları kırılmadan panelde boş/dolu durum gösterebilmeli.

### 10.4 DB/migration kapısı

**Amaç:** Prisma ve RLS tarafının canlıya taşınabilir olduğunu doğrulamak.

Önerilen sıra:

1. Migration dry-run veya lokal migration uygulama
   - Başarı ölçütü: `ASSISTANT_ADMIN`, tenant lisans alanları ve development tabloları çakışmasız oluşmalı.

2. RLS kontrolü
   - Başarı ölçütü: yeni development tabloları tenant izolasyonuna dahil olmalı.

3. Seed/smoke
   - Başarı ölçütü: demo asistan hesabı login olabilmeli; tenant lisansı geçersiz kullanıcı normal API isteğine devam edememeli.

### 10.5 Tamamlama kuralı

Bu plan ancak şu dört kanıt birlikte oluşursa tamamlandı sayılmalı:

1. İlgili unit/e2e testleri geçti.
2. API ve web typecheck/build kapıları geçti.
3. Prisma migration/RLS kapısı geçti.
4. Öğrenci/veli portal gelişim paneli smoke edildi.

Bu kanıtlar olmadan mevcut durum "kod kapsamı büyük ölçüde tamamlandı, doğrulama bekliyor" olarak kalır.

## 11. Script'lere Bağlı Doğrulama Sırası (2026-06-03)

Bu bölüm, mevcut `package.json` script'lerine göre hazırlanmıştır. Komutlar bu turda çalıştırılmadı; yalnızca doğrulama sırası netleştirildi.

### 11.1 En küçük ilk kapı: API odaklı hızlı kontrol

Önerilen ilk komut:

```bash
pnpm --filter @o-okul/api test -- role-capabilities capability.guard tenant-store tenant.service student.service assert-teacher-assigned attendance.service development.service
```

Başarı ölçütü:

- RBAC capability haritası kırılmamalı.
- Tenant lisans servis/store beklentileri geçmeli.
- Veli auto-provisioning beklentileri geçmeli.
- Öğretmen assignment helper beklentileri geçmeli.
- Devamsızlık eşik ve gelişim DTO beklentileri geçmeli.

Bu komut kırılırsa önce ilgili unit test düzeltilmeli; e2e veya build'e geçilmemeli.

### 11.2 API e2e kapısı

Önerilen ikinci komut:

```bash
pnpm --filter @o-okul/api test -- capability-access tenant.controller attendance.e2e teacher-note.e2e homework.e2e exam.controller.e2e
```

Başarı ölçütü:

- `ASSISTANT_ADMIN` finans endpoint'lerinden kapalı kalmalı.
- `SYSTEM_ADMIN` tenant yönetebilmeli, tenant admin yönetememeli.
- Expired tenant normal request başlatamamalı.
- Öğretmen kapsam dışı öğrenci/sınıf yazma yollarından 403 almalı.

Bu komut kırılırsa önce access/tenant/teacher-scope davranışı düzeltilmeli; typecheck'e geçilmeden sebep ayrıştırılmalı.

### 11.3 API typecheck kapısı

Önerilen üçüncü komut:

```bash
pnpm --filter @o-okul/api typecheck
```

Başarı ölçütü:

- `DevelopmentTrendItem` ve diğer shared-types import'ları API tarafında derlenmeli.
- `CapabilityGuard`, request context, tenant middleware ve development service tipleri uyumlu olmalı.

### 11.4 Web typecheck/build kapısı

Önerilen dördüncü ve beşinci komut:

```bash
pnpm --filter @o-okul/web typecheck
pnpm --filter @o-okul/web build
```

Başarı ölçütü:

- Öğrenci ve veli portalı ortak `DevelopmentTrendPanel` ile derlenmeli.
- `@o-okul/shared-types` içindeki `DevelopmentTrendItem` web tarafında çözümlenmeli.
- Next build portal route'larını kırmadan tamamlanmalı.

### 11.5 DB/RLS kapısı

Önerilen komutlar:

```bash
pnpm db:migrate
pnpm db:rls:check
```

Başarı ölçütü:

- `ASSISTANT_ADMIN` enum migration'ı, tenant lisans alanları ve development tabloları sıralı uygulanmalı.
- Development tabloları tenant izolasyonu/RLS kontrolüne dahil olmalı.

### 11.6 Tam zincir kapısı

Yukarıdaki küçük kapılar yeşil olduktan sonra önerilen final komut:

```bash
pnpm run ci
```

Başarı ölçütü:

- Repo genel lint, typecheck, test ve build zinciri geçmeli.
- Bu komut geçmeden F1-F6 için "tamamlandı" kararı verilmemeli.

### 11.7 Canlı smoke kapısı

Yerel/compose ortamı hazırsa önerilen son smoke:

```bash
pnpm live:smoke
```

Başarı ölçütü:

- Migration, RLS live check, postgres store smoke, queue smoke, raw import smoke, report generation smoke ve backup restore smoke birlikte geçmeli.
- Bu komut ağır olduğu için unit/e2e/typecheck yeşil olmadan çalıştırılmamalı.

### İlerleme notu - Doküman tutarlılığı temizliği (2026-06-03)

- F4 için eski "endpoint-level negatif e2e eklenmedi" ifadeleri güncellendi; mevcut e2e dosyalarında ilgili negatif kapsam senaryolarının bulunduğu, fakat henüz çalıştırılmadığı netleştirildi.
- F6c/F6d sonrası eski "frontend paneli henüz eklenmedi" ifadesi güncellendi; panelin eklendiği, fakat typecheck/build/smoke kanıtının henüz olmadığı belirtildi.
- Pivot edilmiş gelişim trend seri formatı bilinçli ayrı faz adayı olarak bırakıldı; mevcut `/me` cevabı dar assessment-list DTO olarak korunuyor.
- Bu turda test veya build çalıştırılmadı.

## 12. Güncel Kontrol Noktası (2026-06-03)

F1-F6 için yeni geliştirme işi şu an beklemeye alınmalı; çünkü ana kod kapsamı uygulanmış ve dokümana işlenmiş durumda. Bundan sonraki ilerleme, doğrulama kanıtı üretmeden "tamamlandı" sayılmamalı.

### Başlangıç kapısı

İlk doğrulama küçük tutulmalı ve API unit testlerinden başlamalı:

```bash
pnpm --filter @o-okul/api test -- role-capabilities capability.guard tenant-store tenant.service student.service assert-teacher-assigned attendance.service development.service
```

Başarı ölçütü:

- RBAC/capability beklentileri geçer.
- Tenant lisans store/service davranışı geçer.
- Veli auto-provisioning geçer.
- Öğretmen assignment helper geçer.
- Devamsızlık eşik ve gelişim DTO unit beklentileri geçer.

### Durma kuralı

Bu ilk kapı kırılırsa e2e/typecheck/build'e geçilmemeli. Önce kırılan unit davranışı düzeltilmeli, sonra aynı küçük kapı tekrar denenmeli.

### Tamamlama kararı

Bu planın tamamlandığını söylemek için yalnızca kodun varlığı yetmez. Aşağıdaki kanıtlar oluşana kadar durum şu şekilde kalır:

> Kod kapsamı tamamlanmış görünüyor; doğrulama bekliyor.

Gerekli kanıtlar:

1. API unit test kapısı geçti.
2. API e2e kapısı geçti.
3. API ve web typecheck/build geçti.
4. DB migration/RLS kapısı geçti.
5. Portal smoke ile öğrenci/veli gelişim paneli görüldü.

## 13. Doğrulama Sonuçları ve Kapanış Kanıtı (2026-06-03)

F1-F6 doğrulama kapıları sırayla çalıştırıldı. İlk denemelerde çıkan hatalar küçük düzeltmelerle kapatıldı; final doğrulama zinciri güncel dosyalarla yeşile döndü.

### Düzeltmeler

- `capability-access.e2e.test.ts` içinde sınav oluşturma yetki testi Postgres repository yerine fake exam repository kullanacak şekilde düzeltildi. Böylece RBAC e2e testi DB bağımlılığına düşmeden yetki davranışını ölçüyor.
- `development-store.ts`, `tenant-store.ts` ve `development.service.ts` içindeki typecheck hataları giderildi.
- `20260603130000_add_development_assessments` migration'ında `Teacher` FK'si mevcut şemaya uygun olarak `teacherId -> Teacher(id)` çizgisine alındı.
- Prisma schema, F2/F6 migration SQL ile hizalandı:
  - tenant lisans tarihleri `timestamptz` olarak işaretlendi.
  - development tabloları için `timestamptz`, relation ve constraint adları schema'ya işlendi.
  - DB/schema diff boş hale getirildi.

### Çalıştırılan kapılar

1. API test kapısı:
   - Komut: `pnpm --filter @o-okul/api test -- role-capabilities capability.guard tenant-store tenant.service student.service assert-teacher-assigned attendance.service development.service`
   - Sonuç: 89 test dosyası geçti, 444 test geçti.

2. API e2e/access kapısı:
   - Komut: `pnpm --filter @o-okul/api test -- capability-access tenant.controller attendance.e2e teacher-note.e2e homework.e2e exam.controller.e2e`
   - Sonuç: 89 test dosyası geçti, 444 test geçti.

3. API typecheck:
   - Komut: `pnpm --filter @o-okul/api typecheck`
   - Sonuç: geçti.

4. Web typecheck:
   - Komut: `pnpm --filter @o-okul/web typecheck`
   - Sonuç: geçti.

5. Web build:
   - Komut: `pnpm --filter @o-okul/web build`
   - Sonuç: geçti; `/ogrenci` ve `/veli` route'ları build çıktısında üretildi.

6. DB migration/status:
   - Komut: `pnpm db:migrate`
   - Sonuç: geçti; `Already in sync, no schema change or pending migration was found.`

7. RLS kontrolü:
   - Komut: `pnpm db:rls:check`
   - Sonuç: geçti; 40 tenant tablosu doğrulandı.

8. Canlı smoke:
   - Komut: `pnpm live:smoke`
   - Sonuç: geçti.
   - Kanıt: compose health, migration, canlı RLS, postgres store smoke, queue smoke, raw import smoke, report generation smoke ve backup/restore smoke geçti.

9. Final CI:
   - Komut: `pnpm run ci`
   - Sonuç: geçti.
   - Kanıt: docker/ops/token/k6 kontrolleri, lint, typecheck, test ve build zinciri geçti.

10. Next e2e:
    - İlk deneme sandbox port izni nedeniyle `listen EPERM 0.0.0.0:3001` ile kırıldı.
    - Dış izinle tekrar çalıştırıldı.
    - Komut: `pnpm test:e2e:next`
    - Sonuç: 3 geçti, 1 skip.
    - Kanıt: login ve rol portalları e2e testleri geçti.

### Güncel karar

F1-F6 için kod kapsamı ve doğrulama kapıları tamamlandı. Bu plan artık "kod kapsamı tamamlandı, doğrulama bekliyor" durumundan "doğrulandı" durumuna geçti.
