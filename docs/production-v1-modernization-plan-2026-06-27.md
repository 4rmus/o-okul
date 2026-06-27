# o-okul — Production v1 Modernizasyon Planı (2026-06-27)

> Kapsam: İlk versiyonu production seviyesine taşımak için modern, kullanıcı-dostu ve
> kurumsal iyileştirmeler. Plan, 5 paralel salt-okunur analiz ajanının kanıt-temelli
> bulgularına ve kullanıcı tarafından kilitlenen 4 mimari karara dayanır.

## 0. Yönetici Özeti

Uygulama olgun bir çok-kiracılı eğitim SaaS'i (NestJS API + Next.js 16 web + BullMQ worker +
Prisma/RLS Postgres). Frontend, RLS ve release-evidence altyapısı güçlü. Bu plan **yeni ürün
açmaz**; mevcut v1'i istenen davranışlara getirir ve canlıya hazır hale taşır.

İstenen değişikliklerin kod-tabanındaki gerçek durumu:

| İstek | Mevcut durum | Boşluk |
|---|---|---|
| Otomatik hesap oluşturma (tekil + toplu) | Manuel `identity-invitation` (e-posta daveti); toplu hiç hesap açmıyor | **Büyük** |
| Kullanıcı adı = TC | TC yardımcıları var (validate/encrypt/hash) ama sadece öğrencide; giriş e-posta ile | **Orta** |
| Şifre = telefon (başında 0 yok, 10 hane) | Telefon serbest metin; öğretmende telefon yok; normalize yok | **Orta** |
| İlk girişte zorunlu şifre değişimi | Hiç yok (flag yok, oturum-içi şifre-değiştir endpoint'i yok) | **Büyük** |
| Kurum + öğretmen için arama çubuğu | Cmd+K paletinde çapraz-varlık arama **var** ama gating hatasıyla sadece admin | **Küçük→Orta** |
| SMS v1'de kapalı | Feature-flag yok; noop adapter var | **Küçük** |
| Veli: finans/destek/duyuru varsayılan açık | Şema `@default(true)` diyor ama servis/store `false` ile eziyor → etkin KAPALI | **Küçük** |
| Doğum tarihi / veli ilişkisi / birinci veli kaldır | Tüm katmanlarda mevcut; yaş hesabı/rapor bağımlılığı YOK | **Orta (geniş ama temiz)** |
| Seviye/Sınıf/Ders tutarlılığı + seviye→ders otomatik | `Course`↔`GradeLevel`/`Class` ilişkisi **yok**; Alan kavramı **yok**; otomatik seçim frontend'de hardcoded; `Class.level` (metin) + `gradeLevelId` (FK) çift kaynak | **En büyük** |

## 1. Kilitlenen Kararlar (kullanıcı onayı)

1. **Hesap kapsamı = Kuruma özel hesap.** TC yalnızca kurum içinde benzersiz; `User` kurum-bazlı
   olur. Kurumlar arası kimlik sızıntısı önlenir. (En büyük mimari iş; lansman öncesi olduğu için
   temiz uygulanabilir.)
2. **Alan = Sınıf/şube düzeyinde.** `Class.alanId`; dersler şubenin alanından gelir.
3. **Şifre kurtarma = Kurum admini sıfırlar.** Telefona geri döndür + ilk girişte zorunlu değişim;
   e-posta opsiyonel/gizli, self-servis reset v1'de yok.
4. **Mevcut veri = Lansman öncesi (veri yok).** Karmaşık backfill yok; additive forward migration +
   **yeni taksonomiyle reseed**. Yıkıcı şema değişikliği serbest.

## 2. Mimari Değişiklik Haritası

```
Kimlik:   User(global, email-unique) ⇒ User(tenant-scoped, TC-hash + telefon-şifre, RLS'li)
Akademik: Course(izole katalog) ⇒ GradeLevel ─*GradeLevelCourse*─ Course (+ Alan), Class.alanId
Sağlama:  davet-tabanlı ⇒ entity eklenince OTOMATİK User üretimi (tekil + toplu)
Arama:    Cmd+K (admin-only, JS-bellek) ⇒ kalıcı üst-bar arama (kurum+öğretmen), SQL/pg_trgm
Veli:     etkin KAPALI ⇒ finans/destek/duyuru AÇIK, SMS KAPALI
PII:      doğum tarihi / veli ilişkisi / birinci veli ⇒ tüm katmanlardan kaldırılır
SMS:      her zaman çalışır ⇒ SMS_ENABLED=false ile kapalı (kod silinmez)
```

---

## 3. İş Akışları (Workstreams)

### WS1 — Kuruma-Özel Kimlik & Otomatik Hesap Sağlama

**Hedef:** Kurum admini tekil veya toplu kişi eklediğinde, kişi-tipi (öğrenci/öğretmen/veli)
için **otomatik** giriş hesabı oluşur. Kullanıcı adı = TC, ilk şifre = telefon (başında 0 yok,
10 hane). İlk girişte şifre değişimi zorunludur.

**Tasarım — `User` kurum-bazlı (per-tenant):**
```prisma
model User {
  id                  String   @id @default(uuid())
  tenantId            String?  // NULL = sistem/platform admini; dolu = kurum kullanıcısı
  email               String?  // artık opsiyonel (sistem admini + opsiyonel iletişim)
  nationalIdHash      String?  // HMAC-SHA256(TC) — kurum-içi giriş anahtarı
  nationalIdEncrypted String?  // AES-256-GCM(TC) — düz metin asla saklanmaz
  name                String
  passwordHash        String
  mustChangePassword  Boolean  @default(false)
  passwordChangedAt   DateTime? @db.Timestamptz(6)
  // ...mevcut totp alanları...
  tenant              Tenant?  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // partial unique: (tenantId, nationalIdHash) WHERE nationalIdHash IS NOT NULL
  // partial unique: (email) WHERE email IS NOT NULL  (sistem admini için)
}
```
- **RLS:** `User` artık tenant tablolarıyla aynı `*_tenant_isolation` desenine girer (tenantId).
  Sistem admini (tenantId NULL) mevcut `withBypassRlsQuery` yolu ile yönetilir. Auth sorguları
  zaten bypass kullandığından uyumlu.
- **Giriş kurum çözümlemesi:** `Tenant.slug` zaten mevcut (`schema.prisma:21`). Giriş yolu
  `/k/{slug}/giris` veya giriş formunda **"Kurum Kodu"** alanı; slug → tenantId çözülür, sonra
  `findByNationalIdHash(tenantId, hashTc(tc))`. **Global TC araması yapılmaz** (kurumlar arası
  varlık sızıntısı engellenir — karar #1 ile tutarlı).
- **TenantMembership** roller için kalır (mevcut RBAC korunur); kurum kullanıcısı için pratikte 1:1.

**Telefon → ilk şifre kuralı:** yeni `normalizePhone()` yardımcı: rakam-dışını temizle, `+90/0090/0`
ön-eklerini çöz, Türk cep formatını (`5XXXXXXXXX`, 10 hane) doğrula, baştaki 0'sız 10 haneyi üret.
Bu değer hem `phone` kolonu hem ilk şifre türetimi için kullanılır. Telefon yoksa/geçersizse hesap
sağlanamaz → satır hatası (toplu import dry-run'da raporlanır).

**Otomatik sağlama (provisioning) — tek ortak servis:**
- Yeni `IdentityProvisioningService`: girdi (tenantId, subjectType, subjectId, TC, telefon, ad,
  roller) → `User` (TC-hash, telefon-şifre, `mustChangePassword=true`) + `TenantMembership` +
  subject bağlama (`bindUser`) tek transaction'da. Idempotent: aynı TC kurumda varsa **attach**
  (mevcut `createOrAttachTenantUser` deseni), tekrar import'ta hata yerine "atlandı".
- Çağıran noktalar: `student.service.ts create/createMany`, `student-import.service.ts`,
  öğretmen create + öğretmen import, `user-management.service.ts` (tekil kurum kullanıcısı),
  `autoProvisionGuardian` (veli).

**Zorunlu kolon eklemeleri:** `Teacher.phone` (yok), Teacher + Guardian için
`nationalIdHash/nationalIdEncrypted` (giriş TC ile). Öğrenci'de TC+telefon zaten var.

**İlk-giriş zorunlu şifre değişimi:**
- Yeni kimlik-doğrulamalı endpoint: `POST /me/password` (eski-şifre + yeni-şifre). Başarıda
  `mustChangePassword=false`, `passwordChangedAt=now()`, **diğer oturumlar iptal** (token family
  reuse korumasını kullan). Access token'da `exp` olmadığından, stale oturumun çalışmaya devam
  etmesini bu iptal engeller.
- Yeni guard/interceptor: `mustChangePassword=true` iken `/me/password` ve `/auth/logout` dışındaki
  tüm uçlar `423 PASSWORD_CHANGE_REQUIRED` döndürür.
- Web: `/sifre-degistir` zorunlu ekran; girişten sonra `mustChangePassword` ise yönlendir.

**Admin şifre sıfırlama (karar #3):** `POST /tenant-users/:id/reset-password` (admin) → şifreyi
kişinin telefonuna geri döndür + `mustChangePassword=true` + oturumları iptal. SMS/e-posta
gerekmez; kullanıcı kendi telefon numarasını zaten bilir (şifre dağıtımı sorunu **ortadan kalkar**).

**Login rate-limiter:** anahtar `sha256(email|ip)` → `sha256(tenantId|nationalIdHash|ip)` olarak
değişir (`login-attempt-limiter.ts`).

**Güvenlik notları (KVKK):**
- Telefon-şifre düşük entropili ve yarı-bilinir → **tek gerçek azaltım zorunlu değişim**; rate-limit
  (5/15dk) ve oturum iptali destekler. İlk şifre yalnızca tek-kullanımlık kabul edilir.
- TC düz metin **asla** saklanmaz (hash + AES). Giriş TC-hash ile.
- Kardeşler aynı veli telefonu → aynı ilk şifre; zorunlu değişim ile kabul edilebilir (notla).

**Dosyalar:** `schema.prisma` (User, Teacher, Guardian) + yeni migration; `auth.controller/service`,
`auth-user-store`, `login-attempt-limiter`, yeni `identity-provisioning.service`, `me.controller`
(+`/password`), `user-management.*`, `student.service`, `student-import.service`, öğretmen
store/service+import, yeni `phone-normalize` util, RBAC guard; `shared-types/domain.ts`
(`LoginRequest` kurum+TC, `mustChangePassword`, sağlama sonuç tipleri); web `login`,
`/sifre-degistir`, `api-client`, `form-validation`, kullanıcı/öğrenci/öğretmen formları; `seed.ts`.

**Karar #4 sayesinde:** backfill yok — mevcut e-posta demo kullanıcıları reseed ile TC/telefon
modeline taşınır.

**Test gate:** `pnpm --filter @o-okul/api test`, `auth.service.test`, `user-management.e2e`,
`web:token-storage:check`, `admin-mfa:check`, `rate-limit:check`, `pnpm openapi:generate`.

---

### WS2 — Akademik Veri Modeli (Seviye / Sınıf / Ders / Alan / Sınav)

**En kritik iş.** Bugün `Course` ile `GradeLevel`/`Class` arasında ilişki **yok**; Alan kavramı
**yok**; "seviye seç → dersler" frontend'de hardcoded (`setup-wizard.tsx` `courseGroups`) ve kayıtta
isim bazlı tekilleştirilip atılıyor. `Class` hem `level` (metin) hem `gradeLevelId` (FK) taşıyor.

**Hedef taksonomi (reseed edilecek per-tenant şablon):**
- 5/6/7. SINIFLAR: TÜRKÇE, MATEMATİK, FEN BİLİMLERİ, SOSYAL BİLİMLER, İNGİLİZCE, DİN KÜLTÜRÜ
- LGS: TÜRKÇE, MATEMATİK, FEN BİLİMLERİ, İNKILAP TARİHİ, İNGİLİZCE, DİN KÜLTÜRÜ
- 9/10. SINIFLAR: EDEBİYAT, FİZİK, KİMYA, BİYOLOJİ, TARİH COĞRAFYA, İNGİLİZCE, DİN KÜLTÜRÜ
- 11. SINIFLAR & TYT/AYT (Alan'a göre):
  - Sayısal: Matematik, Geometri, Fizik, Kimya, Biyoloji
  - Eşit Ağırlık: Matematik, Geometri, Türk Dili ve Edebiyatı, Tarih, Coğrafya
  - Sözel: Edebiyat, Tarih-1, Tarih-2, Coğrafya-1, Coğrafya-2, Felsefe, Din K. ve Ahlak Bilgisi
- KPSS (Alan'a göre):
  - Genel Yetenek: Türkçe, Matematik
  - Genel Kültür: Tarih, Coğrafya, Anayasa/Vatandaşlık, Güncel Bilgiler
  - ÖABT: Gelişim Psk., Öğrenme Psk., Öğretim İlke ve Teknikleri, Ölçme ve Değerlendirme,
    Program Geliştirme, Rehberlik ve Özel Eğitim
  - A Grubu Kadrolar: Hukuk, İktisat, Maliye, İşletme, Muhasebe, Kamu Yönetimi, Uluslararası
    İlişkiler, ÇEKO, İstatistik

**Tasarım (additive, tenant-scoped, RLS'li):**
```prisma
model Alan {                         // Track: Sayısal/EA/Sözel + KPSS grupları
  id        String  @id @default(uuid())
  tenantId  String
  gradeLevelId String?               // NULL => çok seviyeli (TYT/AYT, KPSS)
  name      String
  code      String?
  deletedAt DateTime?
  // tenant FK, @@unique([tenantId, id]), @@unique([tenantId, code])
}

model GradeLevelCourse {             // Seviye→Ders ŞABLONU (otomatik seçimi besler)
  id           String  @id @default(uuid())
  tenantId     String
  gradeLevelId String
  courseId     String
  alanId       String?               // NULL => seviyenin ortak dersi; dolu => alana özel
  isDefault    Boolean @default(true)// seviye seçilince otomatik işaretli
  sortOrder    Int     @default(0)
  @@unique([tenantId, gradeLevelId, courseId, alanId])
  @@index([tenantId, gradeLevelId])
}
// Class.alanId String?  (composite FK) — karar #2
// Exam.gradeLevelId String?, Exam.alanId String?, Exam.examType String?  (LGS|TYT|AYT|KPSS|SCHOOL)
```
- **Ders kimliği:** tek per-tenant `Course` kataloğu, seviye/alan üyeliği join tablosuyla (isim-bazlı
  import/dedup'ı bozmaz). Alternatif (seviye-başına ayrı ders) import eşleşmesini bozardı → reddedildi.
- **Seviye redundansı çözümü:** `gradeLevelId` tek kaynak; `Class.level` (metin) kaldırılır
  (lansman öncesi olduğu için temiz drop).
- **Otomatik seçim mekaniği:** `GET /grade-levels/:id/courses?alanId=` → `GradeLevelCourse` (default
  işaretli) döner. Frontend hardcoded `courseGroups` yerine bu veri-odaklı şablonu kullanır; alan
  seçilince alana-özel dersler eklenir. Kullanıcı override edebilir.
- **Sınav farkları:** `Exam` artık seviye/alan/tür ile etiketlenir → "tüm LGS sınavları" sorgulanabilir;
  cevap-anahtarı `branch` puanlaması değişmez (geriye uyumlu).
- **TeacherAssignment doğrulaması:** `courseId`, sınıfın seviye/alan şablonunda mı kontrol edilir
  (bugün hiç doğrulama yok).

**Migration & seed (karar #4 — backfill yok):**
1. `add_alan`, `add_grade_level_courses` (RLS + `app` grant, mevcut `academic_setup_app_rls` deseni).
2. `add_class_alan`, `add_exam_level_context`.
3. `drop_class_level` (lansman öncesi; aksi halde önce backfill gerekirdi).
4. **Reseed:** global taksonomi şablonu (TS sabiti) + idempotent per-tenant provisioner
   (`seedDemoCourses` genişletilir): 9 seviye + kanonik ders kataloğu + `GradeLevelCourse` (ortak +
   alana-özel) + `Alan` satırları. Yeni kurum açılışında ve "Standart taksonomiyi uygula" butonunda
   da kullanılır.

**Bağımlılık etkisi:** exam import/scoring/report `branch` üzerinden çalışır, etkilenmez;
`ReportSnapshot` zaten `gradeLevelId/courseId` filtreleri taşır; teacher/student import isim-bazlı
kalır (join tasarımı bunu korur) ama seviye/alan kolonu kabul edecek şekilde genişletilebilir.

**Dosyalar:** `schema.prisma` + 4 migration; `demo-fixtures.ts` (`STANDARD_COURSES`→taksonomi),
`seed.ts`; `shared-types/domain.ts` (`AlanRecord`, `GradeLevelCourseRecord`, `ClassRecord.alanId`,
`ExamRecord.examType/level`); API `school/` (alan + grade-level-course store/controller,
`GET /:id/courses`, TeacherAssignment doğrulama), `exam.*`; web `setup-wizard.tsx`,
`classes-page.tsx`, `grade-levels-page.tsx`, yeni `/kurum/alanlar`.

**Test gate:** `pnpm --filter @o-okul/db test`, `db:rls:check`, `tenant-db:check`,
`pnpm --filter @o-okul/api test`, `pnpm openapi:generate`, `live:onboarding:smoke`,
`live:exam-cycle:check`.

---

### WS3 — Global Arama Çubuğu (Kurum + Öğretmen)

**Mevcut:** `app-shell.tsx` Cmd+K paletinde çapraz-varlık arama zaten var (Öğrenci/Öğretmen/Veli/
Sınıf, 180ms debounce, tip başına 3 sonuç). Ama gating yetenek-bazlı (`student:manage`…) olduğu için
**sadece admin** görüyor; öğretmen rolünde bu yetenekler yok. API uçları (`@Roles("TEACHER")`) zaten
açık ve teacher-scope (öğrenci/veli) uyguluyor. Arama Node belleğinde (tüm tabloyu çekip filtreliyor)
→ 10k'da ölçeklenmez. Sadece TC şifreli (tam-eşleşme blind index var); isim/telefon düz metin.

**Hedef tasarım (Seçenek B — önerilen):**
- API: yeni `apps/api/src/search/` → `GET /search?q=&types=&limit=` tek uçtan gruplu sonuç
  (`{students[],guardians[],teachers[],classes[]}`). Mevcut scope'lu servis metotlarını çağırır →
  RBAC/tenant/teacher-scope **bedavaya** miras alınır. 4 ayrı istek yerine tek round-trip.
- Öğretmene aç: `@Roles("TEACHER")` + web gating'i rol-bazlı yap (admin VEYA öğretmen portal erişimi).
- TC araması: `q` 11 haneli geçerli TC ise `nationalIdHash` tam-eşleşme; aksi halde isim/telefon ILIKE.
- Ölçek (10k+ hedef): store-seviyesi `search()` parametreli SQL (`withTenantQuery` içinde, RLS aktif)
  + `pg_trgm` + GIN trigram indexleri (Student/Guardian/Teacher/Class isim/telefon).
- **Türkçe collation (İ/ı) uyarısı:** JS `toLocaleLowerCase("tr-TR")` ile Postgres `lower()/ILIKE`
  birebir aynı değil → `unaccent`/citext/trigram ayarıyla eşleşme doğruluğu sağlanmalı (gerçek bir
  doğruluk maddesi, sadece performans değil).
- Web: `app-shell.tsx` header'ında kalıcı `SearchBar` (kurum + öğretmen görür); "Tümünü gör" mevcut
  liste sayfasına `?q=` ile gider.
- **Kapsam kararı (alt):** öğretmen bugün tüm kurum sınıflarını/öğretmenlerini görüyor (öğrenci/veli
  scope'lu). Aramada sınıf/öğretmeni kurum-geneli bırakmak mı, atanan sınıflara/meslektaşlara
  kısıtlamak mı? → **Öneri:** v1'de kurum-geneli (mevcut davranış), notla.

**Dosyalar:** API yeni `search/` modül + `app.module` kaydı, opsiyonel store `search()` metotları,
`openapi-contracts.ts` yeni path; DB `pg_trgm` + GIN migration; web `app-shell.tsx` SearchBar +
`api-client`; `shared-types` `SearchResultResponse`.

**Test gate:** `pnpm --filter @o-okul/api test`, `pnpm openapi:generate`, `web:a11y:check`,
`web:ux-baseline:check`, `db:rls:check`.

---

### WS4 — Veli Varsayılanları + PII Alan Kaldırma + SMS Kapatma

**R1 — Veli varsayılanları (finans/destek/duyuru AÇIK, SMS KAPALI):**
İzinler `GuardianStudent` join'inde. Şema `@default(true)` der ama iki katman `false` ile eziyor:
`school.service.ts` `resolveGuardianStudentRelation` ve `guardian-student-store.ts`
`withGuardianStudentDefaults`. Düzeltme: bu iki katmanda `canViewFinance`, `canReceiveAnnouncements`,
`canOpenSupportTickets` fallback'i `false→true`; `canReceiveSms` **`false` kalır** (R3 ile tutarlı).
Etkilenen testler güncellenir (`school.e2e`, `guardian-privacy-next.spec`, `login-next.spec`).

**R2 — Alan kaldırma (doğum tarihi, veli ilişkisi, birinci veli):**
Analiz: yaş/`yaş` hesabı **yok**, rapor/export bağımlılığı **yok** → temiz **DROP COLUMN**.
Sıra (deploy-güvenli): (1) web + API DTO/contract/servis/import/seed'den kaldır, (2) ship,
(3) yeni forward migration ile kolonları düşür (`Student.birthDate`, `GuardianStudent.relationshipType`,
`GuardianStudent.isPrimary`). `relationshipType` NOT NULL DEFAULT, `isPrimary` NOT NULL DEFAULT,
index yok → düşürme güvenli. Import sort-enum'undan `birthDate` çıkarılır. (Tam dosya envanteri
analiz raporunda; ~30 nokta: schema, shared-types, openapi-contracts, student.controller/service/store,
student-import, school.service/validation, guardian-student-store, audit-log redaksiyon listesi, web
students/guardian-detail/student-detail sayfaları + portal panelleri, form-validation, setup-wizard, seed.)

**R3 — SMS v1'de kapalı (kod silinmeden):**
Feature-flag çerçevesi yok; mevcut idiom env (`config/persistence.ts`). Aynısı:
`SMS_ENABLED` (default `false`) → `apps/api/src/config/` tiny helper; `SmsBatchService.enqueue`
(+`previewRecipients`) kapalıyken `SMS_DISABLED` döndürür → hiç "sms-batch" job üretilmez, worker/adapter
çalışmaz. Web `NEXT_PUBLIC_SMS_ENABLED=false` ile SMS yüzeyleri gizlenir (duyuru SMS alt-paneli,
delivery report panel, veli "SMS al" toggle, öğrenci "SMS alabilir" checkbox, SMS chip'leri). SMS-only
mesaj şablonu yönetimi de gizlenir. **Duyuru/push SMS'ten bağımsız** (notification adapter) → etkilenmez.
Re-enable: bayrakları aç + `SMS_PROVIDER=netgsm`. `packages/sms-adapter`, worker SMS kodu,
`message-template` **silinmez**.

**Dosyalar:** R1 `school.service.ts`, `guardian-student-store.ts` (+testler); R2 yukarıdaki ~30 nokta +
yeni drop migration; R3 yeni `SMS_ENABLED` config + `sms-batch.service` gate, `.env.example`, web SMS
gizleme.

**Test gate:** `pnpm --filter @o-okul/api test`, `pnpm --filter @o-okul/db test`, `db:rls:check`,
`sms:smoke` (kapalı yolu doğrula), `web:ux-baseline:check`, `pnpm openapi:generate`.

---

### WS5 — UI/UX Modernizasyon (Modern · Kullanıcı-Dostu · Kurumsal)

Frontend olgun (5 rol portalı, paylaşılan komponentler, design token, CI'da a11y/UX kontratları,
kurulum sihirbazı, dry-run'lı toplu import, PII maskeleme). **Tamamlanmış işleri tekrar yapma.**
Mevcut "sadece UI" kilidi (UI/UX redesign kontratı) bu planın DB/API değişiklikleriyle DEC ile
güncellenmeli (aşağıda WS6/§5).

**P0 (paralel değişikliklerin gerektirdiği, şu an eksik):**
1. **İlk-giriş zorunlu şifre-değiştir ekranı** (`/sifre-degistir`) — WS1 ile zorunlu.
2. **Toplu import + kullanıcı formunda kimlik-bilgisi önizleme** — mevcut dry-run önizlemeyi genişlet:
   her satır için üretilecek kullanıcı adı (TC) + ilk şifre (telefon) gösterilsin, commit öncesi;
   yazdır/dışa-aktar ile dağıtım. (Şifre = kişinin kendi telefonu olduğundan dağıtım minimal.)
3. **Seviye-seçince-dersleri-işaretleyen** picker (WS2 verisiyle).

**P1 (kurumsal kabuk):**
4. **Kalıcı masaüstü üst-bar:** bugün masaüstünde üst-bar yok, logout ham sidebar butonu. Üst-bar =
   her zaman görünür global arama + kullanıcı/hesap menüsü + kurum bağlamı. En yüksek kaldıraçlı
   "kurumsal" iyileştirme.
5. **Kurum-bazlı white-label:** `brand.ts` sabit "o-okul"; `Tenant.logoUrl` zaten var (`schema.prisma:27`).
   Kontrollü kurum logo/ad'ı kabuğa taşı (kontrata saygıyla, tam redesign değil).

**P2 (mevcut üzerine tutarlılık):** boş-durum (EmptyState) parite taraması; tablo yüklemede "Yükleniyor…"
metni yerine Skeleton satırları.

**Test gate:** `web:a11y:check`, `web:ux-baseline:check`, `web:ux-contract:check`,
`web:token-storage:check`, `karne:visual-contract:check`.

---

### WS6 — Production Hazırlık (Kanıt Zinciri)

Frontend/kod gate'leri lokal geçiyor; **gerçek blocker'lar kod değil**, gerçek staging + üçüncü-parti
sağlayıcı kanıtı (git log'daki "staging evidence env gap" ile uyumlu):

- **Eksik GitHub staging secret'ları:** `GHCR_READ_TOKEN`, `STAGING_EVIDENCE_ENV_B64`.
- **SMS (Netgsm):** v1'de KAPALI → kanıt **gerekmez** (WS4/R3 ile blocker düşer). Notification/e-posta/
  push: v1'de açıksa sağlayıcı kanıtı; değilse kapsam-dışı.
- Upload AV (ClamAV) `upload-av:check`, backup/restore `restore:drill`, deployment-rollback drill.
- Observability/audit canlı dashboard, KVKK inventory, RLS-live, admin-MFA, financial-retention,
  identity-migration → final go-live zincirine bağlanmalı.
- TLS/Traefik HTTPS smoke, TR datacenter/sağlayıcı kanıtı, staging/prod UAT, pilot kapanışı, go-live
  karar paketi.
- `prod:env:check` eksik secret'larda fail ediyor.

**v1 kapsam daraltmasının etkisi:** SMS kapalı → SMS sağlayıcı kanıtı v1 blocker olmaktan çıkar.
Geri kalan blocker'lar saf operasyonel (staging ortamı + 2 GitHub secret + canlı kanıt yakalama).

**Test gate:** `pnpm run ci`, `prod:readiness:check`, `prod:env:check`, `ops:check`,
`prod:evidence:templates:check`, `pilot:check`, `go-live:check`.

---

## 4. Faz Sıralaması & Bağımlılıklar

```
Faz 0 — Karar & sözleşme kilidi (kısa)
  • DEC kaydı: per-tenant User, akademik model, "UI-only" kilidinin güncellenmesi
  • shared-types + OpenAPI sözleşme taslakları

Faz 1 — Veri modeli temeli  [WS2 şema] + [WS1 User şema] + [WS4/R2 drop]   (paralel: hepsi DB)
  • Tek migration dalgası + reseed (lansman öncesi avantajı)
  • Gate: db:rls:check, tenant-db:check, --filter @o-okul/db test

Faz 2 — Kimlik & sağlama  [WS1]   (Faz 1'e bağlı)
  • IdentityProvisioningService, TC giriş, telefon-şifre, zorunlu değişim, admin reset
  • Gate: api test, web:token-storage:check, rate-limit:check, admin-mfa:check

Faz 3 — Akademik akış + Veli/SMS  [WS2 API/web] + [WS4/R1,R3]   (paralel: ayrı dosya alanları)
  • Seviye→ders otomatik seçim, Alan yönetimi, TeacherAssignment doğrulama
  • Veli varsayılanları ON, SMS gate OFF
  • Gate: api test, openapi:generate, live:onboarding:smoke, sms:smoke

Faz 4 — Arama + UI/UX  [WS3] + [WS5]   (paralel)
  • Kalıcı arama çubuğu (+pg_trgm), üst-bar, ilk-giriş ekranı, kimlik önizleme, white-label
  • Gate: a11y/ux-baseline/ux-contract/token-storage/visual-contract

Faz 5 — Production kanıt zinciri  [WS6]
  • Staging secret'ları, AV/backup/observability/KVKK kanıtı, UAT, pilot, go-live
  • Gate: pnpm run ci + canlı/staging evidence gate'leri
```

**Paralelleştirme:** AGENTS.md kuralı — yazma yapan ajanlar **ayrık dosya alanı** sahibi olmalı,
`max_depth=1`, ana ajan entegrasyonu sahiplenir. Faz 1 (DB), Faz 3 (akademik vs veli/sms ayrı modüller)
ve Faz 4 (search vs ui) paralel yürütülebilir.

---

## 5. Çapraz Kesen Sözleşmeler (birlikte değişmeli)

- **API response shape değişirse** `packages/shared-types` + OpenAPI çıktısı aynı commit'te güncellenir.
- **DB şema değişirse** migration + RLS check + seed etkisi + `tenant-db:check` birlikte.
- **Token saklama davranışı değişmez:** access token memory, refresh cookie HttpOnly; yeni ekranlar
  `localStorage/sessionStorage`'a token yazmaz (`web:token-storage:check`).
- **"UI-only" kontrat kilidi** (`docs/ui-ux-professionalization-contract.md`,
  `docs/ui-ux-redesign-plan.md:256-260`) per-tenant User + akademik model DB değişiklikleriyle çelişir
  → **DEC/RFC ile resmi güncelleme** Faz 0'da yapılır (aksi halde CI UX-baseline gate'i bloklar).
- **Web ↔ API parity:** route/navigation/capability/guard parity testleri korunur.

---

## 6. Riskler & Azaltımlar

| Risk | Etki | Azaltım |
|---|---|---|
| Per-tenant `User` refactor auth'a derin dokunuyor | Yüksek | Lansman öncesi (veri yok) → temiz; auth e2e + token-storage gate'leri; Faz 2 izole |
| Telefon-şifre düşük entropi | Güv. | Zorunlu ilk değişim + rate-limit + oturum iptali; ilk şifre tek-kullanımlık |
| TC = hassas PII | KVKK | Düz metin yok (hash+AES); giriş hash ile; kurum-geneli TC araması yok |
| Türkçe collation (İ/ı) SQL aramada | Doğruluk | `pg_trgm`+`unaccent`/citext ayarı, JS davranışıyla parity testi |
| Alan kolon düşürmeleri | Orta | App kodu önce, drop sonra (deploy sıra); `SELECT *` kullanan store'lar önce temizlenir |
| Akademik şablon ↔ mevcut isim-bazlı import | Orta | Tek paylaşılan ders kataloğu + join (isim benzersiz kalır); reseed |
| "UI-only" kontrat çelişkisi | Süreç | Faz 0 DEC güncellemesi; gate'i kırmadan |

---

## 7. Açık Alt-Kararlar (varsayılanla ilerlendi, onaya açık)

1. **Giriş kurum çözümlemesi:** `/k/{slug}/giris` yol-bazlı **mı** yoksa giriş formunda "Kurum Kodu"
   alanı **mı**? → Varsayılan: ikisi de desteklenir, birincil = kurum kodu alanı. (`Tenant.slug` hazır.)
2. **11/TYT-AYT/KPSS ortak ders:** kullanıcı listeleri **alan-only**; gerçek MEB 11'de ortak dersler de
   var. → Varsayılan: kullanıcının listesine sadık (alan-only); ortak ders gerekirse `GradeLevelCourse`
   `alanId=NULL` ile eklenebilir.
3. **Arama öğretmen kapsamı (sınıf/öğretmen):** kurum-geneli (mevcut) vs atanan sınıflar. → Varsayılan:
   kurum-geneli.
4. **Otomatik hesap rolleri:** öğrenci/öğretmen/veli TC/telefon ile; kurum/sistem admini e-posta+MFA
   kalır. → Varsayılan: bu ayrım.
5. **E-posta kolonu:** opsiyonel saklanır (sistem admini + iletişim), zorunlu değil. (Karar #3 self-servis
   reset'i kapsam-dışı bıraktı.)

---

## 8. Doğrulama Planı (scope bazlı gate'ler — AGENTS.md)

- **API:** `pnpm --filter @o-okul/api typecheck|test`, `pnpm openapi:generate`
- **Web:** `pnpm --filter @o-okul/web typecheck`, `web:a11y:check`, `web:ux-baseline:check`,
  `web:ux-contract:check`, `web:token-storage:check`, `karne:visual-contract:check`
- **DB/RLS:** `pnpm --filter @o-okul/db test`, `db:rls:check`, `tenant-db:check`,
  `audit-log-partition:check`
- **Auth/güvenlik:** `admin-mfa:check`, `rate-limit:check`, `security:audit:check`
- **Sağlayıcı/gizlilik:** `sms:smoke` (kapalı yol), `privacy:inventory:check`, `upload-av:check`,
  `financial-retention:check`
- **Ürün akışları:** `live:onboarding:smoke`, `live:exam-cycle:check`, `report-generation:smoke`
- **Release:** `pnpm run ci`, `prod:env:check`, `prod:readiness:check`, `pilot:check`, `go-live:check`

---