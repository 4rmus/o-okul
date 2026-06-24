# Sıfır-Veri Onboarding — Frontend Mimari Planı (Faz O0–O3)

> Tarih: 2026-06-03 · Kapsam: `apps/web` admin + sistem-admin onboarding zinciri
> Hedef: Uygulama 0 veriyle kurulabilsin → SYSTEM_ADMIN panelden kurum açsın →
> kurumun TENANT_ADMIN'i giriş yapıp çalışan/öğrenci/veri ekleyebilsin.
> Bu plan `claudedocs/admin-panel-business-panel-2026-06-03.md` (Faz A–E) ile
> **uyumludur**; çelişmez, onu tamamlar. Bu plandaki fazlar **Faz O0–O3** olarak adlandırılır.

---

## 0. Kanıt Tabanı (doğrulanmış mevcut durum)

Plan, varsayım değil kod kanıtına dayanır. Doğrulanan kritik gerçekler:

| # | Gerçek | Kanıt (dosya:satır) |
|---|--------|---------------------|
| K1 | SYSTEM_ADMIN'in `tenantId`'si **`"system"`**; bu tenant'ta okul verisi yok | `packages/db/prisma/seed.ts:145` (`membership-system-admin`, `'system'`, `SYSTEM_ADMIN`) |
| K2 | Erişim ikili: `TENANT_ADMIN \|\| SYSTEM_ADMIN` → ikisi de aynı `/kurum` panelini görür | `app-shell.tsx:292` `hasInstitutionAccess` |
| K3 | `tenantId` her zaman `auth.session.tenantId`'den gelir; tenant seçici/anahtarlayıcı yok | `app-shell.tsx`, tüm CRUD sayfaları (örn. `campuses-page.tsx:27`) |
| K4 | `POST /tenants` yalnız Tenant satırı oluşturur; ilk admin'i **provision etmez** | `tenant.service.ts:45-65` |
| K5 | `tenant.service` SYSTEM_ADMIN bağlamı zorunlu kılar (`bypassRls && isSystemAdmin`) | `tenant.service.ts:90-94` |
| K6 | `tenant-users` SYSTEM_ADMIN'i (bypassRls) **reddeder** → SYSTEM_ADMIN tenant-user yaratamaz | `user-management.service.ts:76-81` |
| K7 | `tenant-users` rol listesinde `SYSTEM_ADMIN` **yasak** | `user-management.service.ts:115-117` |
| K8 | Backend rolleri: `SYSTEM_ADMIN, TENANT_ADMIN, ASSISTANT_ADMIN, TEACHER, STUDENT, GUARDIAN` | `apps/api/src/rbac/roles.ts:1` |
| K9 | FE `userRolesSchema` ve `users-page` rol listesi `ASSISTANT_ADMIN`'i **atlıyor** | `form-validation.ts:227`, `users-page.tsx:57-62` |
| K10 | `subjectType` LOGIN'de türetilir; Teacher/Student/Guardian kaydı `userId`'ye bağlı değilse portal yok | `domain.ts:8`, identity-resolver (brief) |
| K11 | Öğrenci create'te `classId` ve `responsibleTeacherId` **opsiyonel** | `student.controller.ts:33-35`, `studentFormSchema` `form-validation.ts:164-176` |
| K12 | Dashboard sabit demo sınava bağlı: `examId = "exam-demo-isem-lgs-1"` | `kurum-dashboard.tsx:15` |
| K13 | Tüm CRUD modülleri aynı kalıp: `CrudPage + FormModal + DataTable + ListControls + react-query`, anahtar `["next-<modül>", tenantId, listQuery]` | `campuses-page.tsx`, `users-page.tsx` |
| K14 | `TenantRecord`: `{id, name, slug, plan, licenseStartsAt?, licenseEndsAt?, seatLimit?, status}` | `tenant-store.ts:6-15` |
| K15 | Kurum-içi tenant store demo veri içeriyor (`tenant-a`, `tenant-b`); Postgres store gerçek | `tenant-store.ts:27-29` |

**En kritik tek bulgu (K1+K2+K4+K6 birleşimi):** SYSTEM_ADMIN bugün `/kurum`'a girdiğinde
`tenantId="system"` ile boş bir okul paneli görür; yeni kurum açtığında o kuruma kimse giriş
yapamaz (ilk admin provision edilmiyor) ve SYSTEM_ADMIN'in kendisi de `tenant-users` ile admin
ekleyemez (bypassRls reddi). **Zincir bugün baştan sona kopuk.** Plan bu kopuğu kapatır.

---

## 1. Bilgi Mimarisi Kararı — SYSTEM_ADMIN paneli nerede yaşar?

### Karar: Ayrı `/sistem` route grubu (ÖNERİLEN)

`/kurum`'u SYSTEM_ADMIN ile yeniden kullanmak yerine **ayrı bir `app/(app)/sistem/`** rota
ağacı açılır. Gerekçe:

| Kriter | `/sistem` ayrı (✅ önerilen) | `/kurum` yeniden kullan |
|--------|------------------------------|--------------------------|
| Zihinsel model | Platform sahibi ≠ kurum yöneticisi; iki ayrı persona, iki ayrı iş | Aynı panelde rol-bazlı gizleme; karışık |
| `tenantId` semantiği | SYSTEM_ADMIN'in `tenantId="system"`'i okul verisiyle hiç temas etmez (K1) | `/kurum` tüm sorguları `tenantId`'ye bağlar → "system" tenant'ta boş/anlamsız |
| Güvenlik yüzeyi | Sistem işlemleri net izole; yanlış-tenant veri sızıntısı riski düşük | Aynı ekranda iki yetki seviyesi → koşullu render hatası riski |
| Faz D uyumu | Faz D zaten "ikili RBAC → rol-bazlı görünüm" diyor; `/sistem` bunun ilk somut adımı | Faz D'yi aynı panele sıkıştırmak D'yi zorlaştırır |
| Mevcut kod | `/kurum`'un 35 modülü hiç değişmeden TENANT_ADMIN'e kalır | 35 modülün her birine "system mi?" koşulu sızar |

**Sonuç:** `/sistem` = platform yönetimi (kurumlar, lisans, sistem sağlığı/gözlemlenebilirlik
global görünüm). `/kurum` = tek kurumun yönetimi (bugünkü 35 modül, değişmeden).

### app-shell SYSTEM_ADMIN ↔ TENANT_ADMIN ayrımını nasıl bırakır?

`app-shell.tsx`'te tek bir ikili fonksiyon (`hasInstitutionAccess`) üç ayrı yardımcıya bölünür:

```
hasSystemAccess(roles)       = roles.includes("SYSTEM_ADMIN")
hasInstitutionAccess(roles)  = roles.includes("TENANT_ADMIN") || roles.includes("ASSISTANT_ADMIN")
                               // SYSTEM_ADMIN ARTIK BURADA DEĞİL
hasSubjectPortalAccess(...)   = (değişmez)
```

`canAccessPath` güncellemesi:
- `/sistem*` → `hasSystemAccess`
- `/kurum*`  → `hasInstitutionAccess`
- portallar → mevcut mantık

`getHomePath` güncellemesi (öncelik sırası):
`SYSTEM_ADMIN → /sistem` · `TENANT_ADMIN|ASSISTANT_ADMIN → /kurum` · portal türleri → ilgili portal.

> **Geçiş riski (açık karar K6-bağımlı):** SYSTEM_ADMIN `/kurum`'dan tamamen çıkarılırsa,
> bir kurumu "kurum gözünden" denetlemek isteyen platform sahibi ne yapar? İki seçenek:
> (a) Faz D'deki **impersonation** ile geçici TENANT_ADMIN görünümü; (b) `/sistem/kurumlar/[id]`
> detayında **salt-okunur** kurum özeti. Bu plan (b)'yi O1'de, (a)'yı Faz D'ye bırakır.

### Navigasyon nasıl rolle sürülür?

`navigation.ts` bugün tek `institutionNavGroups` dışa veriyor. Eklenecek:

```
export const systemNavGroups: readonly NavGroup[] = [
  { label: "Sistem", items: [{ href: "/sistem", label: "Genel Bakış" }] },
  { label: "Kurumlar", items: [{ href: "/sistem/kurumlar", label: "Kurumlar" }] },
  { label: "İzleme", items: [
    { href: "/sistem/sistem-sagligi", label: "Sistem Sağlığı" },
    { href: "/sistem/gozlemlenebilirlik", label: "Gözlemlenebilirlik" },
    { href: "/sistem/denetim", label: "Denetim (global)" },
  ]},
];
```

app-shell sidebar seçimi:
```
hasSystemAccess(roles)       → systemNavGroups
hasInstitutionAccess(roles)  → institutionNavGroups (Faz D'de capability ile filtrelenecek)
visiblePortalItems           → (değişmez)
```

> Not: Bir kullanıcı hem SYSTEM_ADMIN hem TENANT_ADMIN olabilir (nadir; geliştirme hesabı).
> Bu durumda her iki nav grubu da gösterilir (ayrı `<section>`'lar). Üst-seviye bir
> bağlam-anahtarı (workspace switcher) **O2 kapsamı dışı**; gerekirse Faz A komut paletine bağlanır.

---

## 2. Sistem-Admin Kurum Yönetimi Ekranları (Faz O1)

### Rotalar ve dosyalar

```
app/(app)/sistem/
  layout.tsx                         # opsiyonel; (app) layout yeterli, ayrı gerekmez
  page.tsx                           # → SystemDashboard
  system-dashboard.tsx               # "use client"
  kurumlar/
    page.tsx                         # → TenantsPage
    tenants-page.tsx                 # "use client" — liste + create (ANA EKRAN)
    [tenantId]/
      page.tsx                       # → TenantDetailPage
      tenant-detail-page.tsx         # "use client" — detay + düzenle + ilk-admin
  _shared/
    system-api.ts                    # tenant CRUD fetch yardımcıları (api-client üstüne)
```

### Bileşen yeniden kullanımı (yeni primitive YOK)

Hepsi `@o-okul/ui` mevcut bileşenleriyle, `campuses-page.tsx` kalıbının birebir kopyası:
- Liste: `CrudPage + DataTable + ListControls` (K13 kalıbı)
- Form: `FormModal + Input` + yeni `tenantCreateFormSchema` (Zod, `form-validation.ts`'e eklenir)
- Doğrulama: `firstFormError`, `safeParse` (mevcut kalıp)

### `tenants-page.tsx` — kurum listesi + oluşturma

**react-query anahtarları** (mevcut konvansiyon `["next-...", scope, listQuery]`):
- Liste: `["next-tenants", listQuery]` (tenant scope yok; SYSTEM_ADMIN global)
- Liste (invalidate): `["next-tenants"]`

**Sütunlar (DataTable):** Ad · Slug · Plan · Lisans bitişi (`licenseEndsAt`, yoksa "—") ·
Koltuk (`seatLimit ?? "Sınırsız"`) · Durum (`status` rozet: ACTIVE/SUSPENDED/TRIAL) ·
İşlem (detaya git).

**API çağrıları (mevcut backend, doğrulanmış):**
- `GET /api/v1/tenants` → `apiListRequest<TenantRecord>` (K14 şekli; `tenant.controller.ts:11`)
- `POST /api/v1/tenants` → `apiRequest<TenantRecord>` (`tenant.controller.ts:23`)
- `GET /api/v1/tenants/:id` → detay (`tenant.controller.ts:17`)
- `PATCH /api/v1/tenants/:id` → düzenle (`tenant.controller.ts:29`)

> ⚠️ `GET /tenants` bugün `ListMeta` döndürmüyor olabilir (TenantController `TenantRecord[]`
> dönüyor). `apiListRequest` meta yoksa kendi fallback meta'sını üretir (`api-client.ts:115-120`),
> dolayısıyla FE çalışır ama **sayfalama gerçek değil**. Backend gap olarak listelendi (§9, BG-4).

### Kurum oluşturma formu — ilk-admin alanlarıyla (KRİTİK)

Form **iki bölüm** içerir (tek FormModal, tek submit):

**Bölüm 1 — Kurum:**
| Alan | Zorunlu | Not |
|------|---------|-----|
| Kurum adı (`name`) | ✅ | |
| Slug (`slug`) | ✅ | addan otomatik türet + elle düzenlenebilir (kebab-case) |
| Plan (`plan`) | — | select: TRIAL (vars.) / PRO / ENTERPRISE |
| Lisans başlangıç (`licenseStartsAt`) | — | tarih |
| Lisans bitiş (`licenseEndsAt`) | — | tarih; başlangıçtan sonra (Zod superRefine) |
| Koltuk limiti (`seatLimit`) | — | pozitif tam sayı |
| Durum (`status`) | — | vars. ACTIVE |

**Bölüm 2 — İlk Kurum Yöneticisi (TENANT_ADMIN):**
| Alan | Zorunlu | Not |
|------|---------|-----|
| Admin ad soyad (`adminName`) | ✅ | |
| Admin e-posta (`adminEmail`) | ✅ | e-posta doğrulama |
| Admin şifre (`adminPassword`) | ✅* | min 8; *bkz. açık karar §9 (şifre vs davet) |

\* **Bağımlılık (BG-1):** Bu bölümün çalışması backend gap #1'i gerektirir. FE iki yola da hazır
tasarlanır (form aynı; yalnız submit hedefi değişir). Bkz. §2 "Backend kontratı".

**`firstAdminMode` toggle (UX netliği):**
- "Şifre belirle" (varsayılan): platform sahibi admin'e şifreyi elle iletir (telefon/yüz yüze).
- "Davet gönder": şifre alanı gizlenir; backend aktivasyon tokenı üretir, ekranda gösterilir
  (mevcut `next-token-panel` deseni `users-page.tsx:362-367`).

### İstediğimiz backend kontratı (BG-1 — bir backend agent uygular)

FE'nin bağlandığı kontrat. **Önerilen: `POST /tenants`'i genişlet** (tek atomik işlem, en az
sürtünme):

```
POST /api/v1/tenants
Body:
{
  // mevcut alanlar (K14)
  name: string, slug: string, plan?, licenseStartsAt?, licenseEndsAt?, seatLimit?, status?,
  // YENİ — ilk admin (opsiyonel obje; verilirse atomik provision)
  firstAdmin?: {
    name: string,
    email: string,
    mode: "password" | "invitation",
    password?: string        // mode=password ise zorunlu, min 8
  }
}
Response (200):
{
  data: {
    tenant: TenantRecord,
    admin?: {
      userId: string,
      email: string,
      // mode=invitation ise:
      activationToken?: string
    }
  }
}
```

Davranış: `firstAdmin` verilirse, Tenant + User + Membership(role=TENANT_ADMIN) **tek transaction**
içinde oluşturulur (kısmi-başarı = rollback). `mode="invitation"` ise password yerine
`activationToken` döner; FE bunu `next-token-panel`'de gösterir.

**Alternatif (BG-1b, eğer ayrı endpoint tercih edilirse):**
`POST /tenants/:id/admins  Body:{name,email,mode,password?}` — SYSTEM_ADMIN-only. FE bu durumda
iki ardışık çağrı yapar (önce tenant, sonra admin) ve aradaki hatayı kullanıcıya "kurum oluştu ama
admin atanamadı, tekrar dene" diye gösterir. **Önerimiz: genişletilmiş `POST /tenants` (atomik).**

### `tenant-detail-page.tsx` — detay/düzenle

- Üst: kurum kimlik kartı (ad, slug, plan, lisans aralığı, koltuk, durum rozeti).
- Düzenle: `FormModal` + `PATCH /tenants/:id` (Bölüm 1 alanları; admin alanları detayda değil).
- "Yöneticiler" bölümü: bu kurumun TENANT_ADMIN'lerini listele + "Yeni yönetici ekle"
  (BG-1b kontratı veya genişletilmiş endpoint'in admin-only kısmı). Bu, ilk admin'i kaybedince
  (şifre unutuldu vb.) kurtarma yolu — operasyonel olarak gerekli.
- Lisans/koltuk/durum görünümü: salt-okunur kart + düzenle ile değiştirilebilir. Koltuk kullanımı
  (örn. "12 / 50") **BG-5**'e bağlı (tenant başına aktif kullanıcı sayısı endpoint'i).

---

## 3. İlk-Çalıştırma / Sıfır-Veri Deneyimi (Faz O0)

### SYSTEM_ADMIN — boş sistem

`/sistem/kurumlar` ilk açılışta (yalnız `system` tenant var, başka kurum yok):

- **Empty-state kartı** (yeni `EmptyState` bileşeni, §6): büyük başlık "Henüz kurum yok",
  alt metin "İlk kurumunu oluşturarak başla", birincil buton **"Kurum oluştur"** (formu açar).
- `/sistem` dashboard: sayaçlar 0 (kurum sayısı, aktif kullanıcı). "Başlangıç" kartı → kurum oluştur.

### Brand-new TENANT_ADMIN — ilk giriş, boş `/kurum`

İlk login'de kurumda hiç veri yok. Bugünkü dashboard `examId="exam-demo-isem-lgs-1"`'e bağlı
(K12) → **yanlış-güven riski** (Faz B/B1 ile çakışır; orada zaten "demo-bağını kır" var).

Onboarding planının dashboard'a katkısı:
- Veri yoksa dashboard **onboarding kartını** öne çıkarır: "Kurumunu kurmaya başla" →
  **Kurulum Sihirbazı** (§4) açılır.
- Sayaçlar (sınıf/öğretmen/öğrenci) 0 → her biri ilgili modüle + sihirbaz adımına deep-link.
- B1 ile birlikte: sınav yoksa grafikler "henüz sınav yok" boş-durumu (çift fazda tutarlı).

> **Faz çakışma çözümü:** B1 (dashboard demo-bağını kır) Faz B'de, O0 (boş dashboard onboarding
> kartı) burada. İkisi aynı dosyaya (`kurum-dashboard.tsx`) dokunur → **B1 önce, O0 sonra** veya
> birlikte yapılır. Plan sırası §8'de B1'i O0'ın önkoşulu sayar.

---

## 4. Kurum Kurulum Sihirbazı (Faz O2) — TENANT_ADMIN için

### Amaç ve felsefe

Yeni TENANT_ADMIN, 35 modüllük düz listede "neyi önce kurmalıyım?" diye kaybolur (Doumont/Meadows
kör nokta, mevcut plan §1). Sihirbaz, **bağımlılık-sıralı** rehber sunar. **Yıkıcı değil, additive**
(mevcut modüller aynen durur; sihirbaz onlara yönlendirir). Faz A'daki "iş-akışı kısayolları"
(A4) ile aynı felsefe → sihirbaz, "yeni dönem açılışı" iş-akışının onboarding'e özel hâli.

### Rota ve bileşenler

```
app/(app)/kurum/kurulum/
  page.tsx                       # → SetupWizard
  setup-wizard.tsx               # "use client" — adım yöneticisi
  _shared/
    wizard-steps.ts              # adım tanımları (veri-sürümlü, navigation.ts gibi)
    use-setup-progress.ts        # ilerleme hesaplama (react-query sayım sorguları)
```

Sidebar'da "Kurum" grubunun en üstüne (Genel Bakış'ın altına) **"Kurulum"** linki (yalnız
ilerleme < %100 iken veya her zaman "Kurulum durumu" olarak). Dashboard onboarding kartı da buraya bağlanır.

### Adım sırası (bağımlılık grafiği)

```
1. Kampüs        → 2. Seviye      → 3. Sınıf (kampüs+seviye gerektirir)
                                       ↓
4. Ders          → 5. Öğretmen ───────┤  (Teacher kaydı)
                       ↓ davet         │
                  5b. Öğretmen daveti  │  (identity-invitation → portal erişimi)
                       ↓               ↓
6. Öğrenci (sınıf+sorumlu öğretmen OPSİYONEL, K11)
       ↓
7. Veli  → 7b. Veli-öğrenci bağı + davet
       ↓
8. (Opsiyonel) Kazanım kataloğu / İlk sınav  (BG-3'e bağlı)
```

Zorunlu çekirdek = 1–6 (bir öğrenci eklenebilir hâle gelene kadar). 7–8 opsiyonel ama önerilen.

### Her adım için kontrat

| # | Adım | Mevcut modül/endpoint | "Tamamlandı" sinyali | Atla / Dön |
|---|------|------------------------|----------------------|------------|
| 1 | Kampüs | `kampusler` · `GET/POST /campuses` | `campuses.total ≥ 1` | Atlanabilir (kampüssüz sınıf mümkün) |
| 2 | Seviye | `seviyeler` · `/grade-levels` | `gradeLevels.total ≥ 1` | Atlanabilir |
| 3 | Sınıf | `siniflar` · `/classes` | `classes.total ≥ 1` | Önerilen; öğrenci için faydalı |
| 4 | Ders | `dersler` · `/courses` | `courses.total ≥ 1` | Atlanabilir |
| 5 | Öğretmen | `ogretmenler` · `/teachers` | `teachers.total ≥ 1` | Önerilen |
| 5b | Öğretmen daveti | `kullanicilar` (davet) · `POST /identity-invitations` | İlgili öğretmenin daveti PENDING/ACCEPTED | Atlanabilir (portal sonra) |
| 6 | Öğrenci | `ogrenciler` · `POST /students` (K11) | `students.total ≥ 1` | **Çekirdek hedef** |
| 7 | Veli | `veliler` · `/guardians` | `guardians.total ≥ 1` | Opsiyonel |
| 7b | Veli bağı + davet | `ogrenciler` detay / `kullanicilar` davet | guardian-student bağı + davet | Opsiyonel |
| 8 | Kazanım / Sınav | `sinavlar` + kazanım (BG-3) | learningOutcome.total ≥ 1 | Opsiyonel; psikometri için |

**Her adım UX'i (tutarlı kalıp):**
- Durum rozeti: ⏳ Bekliyor / ✅ Tamam / ⤼ Atlandı.
- Birincil buton: "Şimdi ekle" → ilgili modüle gider **VEYA** inline `FormModal` açar (bkz. karar).
- İkincil: "Atla" (opsiyonel adımlarda) / "Daha sonra".
- "Tamam" sinyali react-query sayım sorgusuyla **otomatik** (modülde kayıt oluşunca sihirbaz günceller).

> **Karar — inline form mü, modüle yönlendirme mi?**
> Öneri: **modüle derin-link** (Plus formunu otomatik açan query param `?new=1`).
> Gerekçe: her modülün formu zaten olgun (`FormModal`); sihirbaz içinde 8 formu yeniden kurmak
> DRY ihlali ve bakım yükü. Sihirbaz "yönlendirici + ilerleme takipçisi" rolünde kalır.
> Modül sayfaları `useSearchParams()` ile `?new=1` görünce `openCreateForm()` tetikler (küçük ekleme).

### İlerleme kalıcılığı (progress persistence)

İki katman:
1. **Türetilmiş ilerleme (sunucu gerçeği):** `use-setup-progress.ts` her adımın sayım sorgusunu
   (`?limit=1` ile `meta.total`) okur. Bu **kaynak-of-truth** — kullanıcı modülden veri eklediyse
   sihirbaz otomatik "tamam" görür, ekstra durum gerekmez. react-query anahtarı:
   `["next-setup-progress", tenantId]` (alt sorgular mevcut modül anahtarlarını paylaşır →
   önbellek yeniden kullanımı).
2. **Atlama/kapatma tercihi (UI durumu):** "Atla" ve "sihirbazı gizle" gibi kararlar kullanıcı
   tercihidir, sunucuda yok. **Karar:** `localStorage` anahtarı `uh:setup:{tenantId}:dismissed`
   ve `:skipped:[stepId]`. Sunucu kalıcılığı (BG-6, opsiyonel) sadece çok-cihaz senaryosu için;
   MVP'de localStorage yeterli (YAGNI).

> Not: İlerlemeyi sunucudan türetmek (sayım sorguları) **en sağlam** yaklaşım — onboarding
> "tamamlandı" bayrağı tutmak (stale olur, veri silinince yanlış kalır) yerine gerçek veri sayılır.

---

## 5. Çalışan Onboarding Netleştirmesi (Faz O1 — `kullanicilar` genişletme)

### İki yol var ve admin'i karıştırıyor — net ayrım

Mevcut `users-page.tsx` iki ayrı şey yapıyor ama UX ayrımı zayıf:

| Yol | Ne yapar | Endpoint | Portal erişimi? | Ne zaman |
|-----|----------|----------|------------------|----------|
| **A. Giriş hesabı (tenant-user)** | E-posta+şifre+rol ile **bağımsız** login | `POST /tenant-users` (K6: TENANT_ADMIN-only) | ❌ Hayır (subjectType yok, K10) | Yönetici/yard. yönetici için |
| **B. Kişiye-bağlı davet (identity-invitation)** | Mevcut Teacher/Student/Guardian kaydını **yeni login'e bağlar** | `POST /identity-invitations` | ✅ Evet (subjectType=role, K10) | Öğretmen/öğrenci/veli portal erişimi için |

**Kritik içgörü (K10):** Yol A ile rol=TEACHER vermek öğretmene portal erişimi **vermez** —
çünkü `subjectType` yok. Çalışan bir öğretmen = **önce Teacher kaydı (modül 5) → sonra Yol B davet**.
Bu bugün hiçbir yerde anlatılmıyor; admin Yol A'dan TEACHER seçip "neden portal açılmadı?" diye takılır.

### UX çözümü — `kullanicilar` sayfası yeniden çerçevelenir

Sayfa iki net sekme/bölüme ayrılır (mevcut iki CrudPage zaten var, sadece başlık+yardım eklenir):

1. **"Yönetim hesapları"** (Yol A): açıklama — *"E-posta ve şifreyle giriş yapacak yönetici ve
   yardımcı yöneticiler. Portal (öğretmen/öğrenci/veli) erişimi için bu değil, 'Kişi davetleri'
   kullanın."* Rol seçimi: **TENANT_ADMIN, ASSISTANT_ADMIN** (K9 düzeltmesi — bu ikisi öne çıkar;
   TEACHER/STUDENT/GUARDIAN bilinçli olarak Yol A'dan kaldırılır ya da "önerilmez" uyarısıyla bırakılır).
2. **"Kişi davetleri"** (Yol B): açıklama — *"Önce öğretmen/öğrenci/veli kaydını oluşturun, sonra
   buradan davet ederek portal erişimi verin."* (mevcut davet akışı).

### ASSISTANT_ADMIN eklenmesi (K8, K9 düzeltmesi)

Backend `ASSISTANT_ADMIN`'i destekliyor (K8) ama FE atlıyor (K9). Düzeltmeler:
- `form-validation.ts:227` `userRolesSchema` enum'una `"ASSISTANT_ADMIN"` eklenir.
- `users-page.tsx:57-62` `roleOptions`'a `{value:"ASSISTANT_ADMIN", label:"Yardımcı yönetici"}` eklenir.
- `Role` tipi (`users-page.tsx:22`) genişletilir.
- `@o-okul/shared-types`'ta rol enum'u tek-kaynak ise oradan türetilir (DRY; K8 backend ile eşitle).

### Öğretmen yolunu tutarlı kıl — "kılavuzlu öğretmen ekle"

`ogretmenler` modülünde, Teacher kaydı oluşturulduktan sonra satır işlemine
**"Portal daveti gönder"** kısayolu eklenir → `kullanicilar` davet formunu o öğretmen
`subjectId` önseçili açar (`?invite=teacher&subjectId=...`). Böylece "kayıt → davet → portal"
zinciri tek akışta görünür; admin iki ayrı modül arasında kaybolmaz. (Sihirbaz adım 5→5b ile aynı mantık.)

---

## 6. Modüller Arası Boş-Durum (Empty-State) Deseni (Faz O0/O3)

### Tutarlı `EmptyState` bileşeni (`@o-okul/ui`'ye eklenir)

`CrudPage` bugün `emptyText` (düz metin) alıyor. Yükseltme: `emptyState?: ReactNode` prop'u
(geriye uyumlu; `emptyText` kalır). Yeni `EmptyState` primitive:

```
<EmptyState
  title="Henüz kampüs yok"
  description="Kampüs ekleyerek sınıf yapısını kurmaya başla."
  primaryAction={{ label: "Kampüs ekle", onClick }}
  secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}  // onboarding deep-link
  hint={prevStepDone ? undefined : "Önce seviye eklemen önerilir."}     // bağımlılık ipucu
/>
```

### Onboarding'e bağlı içerik

Her modülün boş-durumu "sırada ne var" mantığıyla bağlanır:
- Boşsa → "ekle" CTA + **bir sonraki mantıklı adıma** link (örn. kampüs boşsa → "Kampüs ekle";
  sınıf boş ama seviye yoksa → "Önce seviye ekle" ipucu + seviye linki).
- Sihirbaz (`/kurum/kurulum`) ve modül boş-durumları **aynı `wizard-steps.ts`** veri kaynağını
  paylaşır → tek-kaynak bağımlılık grafiği (DRY).

### Kapsam (Faz O3'te tamamlanır)

MVP (O0): onboarding zincirindeki 6 çekirdek modül (kampüs, seviye, sınıf, ders, öğretmen, öğrenci).
Genişleme (O3): kalan ~15 CRUD modülü tutarlı boş-duruma geçer. Bu, mevcut planın **E3**
("tüm modüllerde tutarlı boş/hata/yükleniyor") ile **birebir aynı iş** → O3 = E3'ün onboarding
odaklı önceliklendirmesi (ikisi birleştirilir, çift iş yapılmaz).

---

## 7. Rol-Bazlı Navigasyon (Faz D ile uzlaşı)

Bu plan Faz D'yi **ezmiyor**, ona **veri ve ilk dilim** sağlıyor:

| Rol | Nav kaynağı | Bu planda (O1) | Faz D'de (sonra) |
|-----|-------------|----------------|-------------------|
| SYSTEM_ADMIN | `systemNavGroups` | ✅ Tanımlanır + app-shell bağlanır | (değişmez) |
| TENANT_ADMIN | `institutionNavGroups` (tümü) | ✅ Mevcut (değişmez) | capability ile aynı kalır |
| ASSISTANT_ADMIN | `institutionNavGroups` (alt küme) | ⚠️ O1'de TENANT_ADMIN ile aynı görür (geçici) | 🎯 Faz D: kısıtlı görünüm |
| TEACHER/STUDENT/GUARDIAN | portallar | (değişmez) | (değişmez) |

**ASSISTANT_ADMIN alt-kümesi (O1 minimal → D'de tam):**
- O1 (hızlı): `hasInstitutionAccess`'e ASSISTANT_ADMIN eklenir → kurum paneline girer (Kişiler +
  Akademik görür; **Operasyon** ve **Finans** grupları gizlenir — basit statik filtre).
- Faz D (tam): nav, backend capability modeline (commit `2226807` RBAC redesign) bağlanır;
  modül başına `requiredCapability` alanı `navigation.ts`'e eklenir, `can(capability)` ile filtrelenir.

**Nav'ı capability ile sürme deseni (Faz D'ye teslim edilecek arayüz):**
```
type NavItem = { href; label; requiredCapability?: string };
// app-shell: groups.map(...).filter(item => !item.requiredCapability || can(item.requiredCapability))
```
`can()` kaynağı: `me/access` matris endpoint'i (brief'teki `me-access-matrix.e2e` deseni) veya
session capability listesi. **Bu plan `requiredCapability` alanını O1'de opsiyonel olarak ekler
ama doldurmaz; Faz D doldurur.** Çelişki yok, ileriye-uyumlu.

---

## 8. Fazlama (O0–O3) — efor, bağımlılık, kapı

> Eforlar göreli: **S** (~1-2 gün), **M** (~3-5 gün), **L** (~1-2 hafta). 🔴 = kritik yol.

### Faz O0 — Sıfır-Veri Bootstrap + Boş-Durum Temeli — ~S-M
*Amaç: uygulama 0 veriyle anlamlı açılsın; kör/yanlış-güven kapansın.*

- **O0.1 · Minimal seed modu** (S, 🔴, **BG-2 bağımlı**). `seed.ts` için bayrak (`SEED_MODE=minimal`)
  → yalnız `system` tenant + SYSTEM_ADMIN. FE varsayımı: boş sistem normaldir.
- **O0.2 · `EmptyState` primitive + `CrudPage.emptyState`** (S). `@o-okul/ui`'ye ekle, rebuild.
- **O0.3 · 6 çekirdek modülde onboarding-bağlı boş-durum** (M). §6 deseni.
- **O0.4 · Dashboard onboarding kartı** (S, **B1 önkoşul**). Boş kurumda sihirbaza yönlendirme.

**Kapı:** `pnpm typecheck && pnpm test`; ui paketi rebuild; boş-DB'de login→/kurum→boş-durum
görünür E2E; demo-bağı kalmamış (B1 ile).

### Faz O1 — Sistem-Admin Kurum Yönetimi + Çalışan Netliği — ~M-L
*Amaç: SYSTEM_ADMIN panelden kurum + ilk admin açabilsin; çalışan iki-yol net olsun.*

- **O1.1 · app-shell `/sistem` ayrımı** (S, 🔴). `hasSystemAccess`, `canAccessPath`, `getHomePath`,
  `systemNavGroups`. SYSTEM_ADMIN `/kurum`'dan çıkar.
- **O1.2 · `/sistem/kurumlar` liste + detay** (M, 🔴). CrudPage kalıbı; `GET/POST/PATCH /tenants`.
- **O1.3 · Kurum-oluştur formu (ilk-admin alanlarıyla)** (M, 🔴, **BG-1 bağımlı**).
  `tenantCreateFormSchema`; password/invitation toggle; token-panel.
- **O1.4 · ASSISTANT_ADMIN ekle** (S). `form-validation.ts` + `users-page.tsx` + shared-types eşitle.
- **O1.5 · `kullanicilar` iki-yol yeniden çerçeveleme** (S). Başlık+yardım metni; rol seçim ayrımı.
- **O1.6 · Öğretmen→davet kısayolu** (S). `ogretmenler` satır işlemi → davet formu önseçili.

**Kapı:** SYSTEM_ADMIN login→/sistem→kurum oluştur→**yeni admin login olur**→/kurum açılır
(uçtan uca E2E, BG-1 sonrası). TENANT_ADMIN `/sistem`'e erişemez (403/redirect testi).
ASSISTANT_ADMIN login olur, Operasyon görmez.

### Faz O2 — Kurum Kurulum Sihirbazı — ~M
*Amaç: yeni TENANT_ADMIN bağımlılık-sıralı, kılavuzlu kurulum yapsın.*

- **O2.1 · `wizard-steps.ts` + `use-setup-progress.ts`** (S). Türetilmiş ilerleme (sayım sorguları).
- **O2.2 · `setup-wizard.tsx`** (M, 🔴). Adım UI, rozet, deep-link, atla/dön.
- **O2.3 · Modüllerde `?new=1` deep-link** (S). `useSearchParams` → `openCreateForm()` (6 modül).
- **O2.4 · localStorage atlama/gizleme tercihi** (S). §4.2 kalıcılık.

**Kapı:** boş kurumda sihirbaz tüm adımları gösterir; bir kampüs eklenince adım 1 otomatik ✅;
öğrenci eklenene kadar (adım 6) ilerleme izlenir; atla/dön çalışır (E2E).

### Faz O3 — Tamamlama & Sertleştirme — ~S-M (E3 ile birleşik)
*Amaç: boş-durum tutarlılığını tüm modüllere yay; onboarding E2E kapsa.*

- **O3.1 · Kalan ~15 modülde EmptyState** (M). = mevcut planın **E3**'ü; birleştir, çift iş yok.
- **O3.2 · Onboarding E2E paketi** (S). = mevcut planın **E1**'inin onboarding dilimi.
- **O3.3 · Tenant detayda koltuk kullanımı** (S, **BG-5 bağımlı**). "12/50" göstergesi.

**Kapı:** tüm CRUD modülleri tutarlı boş/hata/yükleniyor; onboarding zinciri (O0→O2) tek E2E akışında yeşil.

### Bağımlılık sırası

```
O0 (bootstrap+empty-state)
  → O1 (sistem-admin; O0.2 EmptyState'i kullanır; B1'e bağlı)
      → O2 (sihirbaz; O0 empty-state + O1 çalışan-yolu üstüne)
          → O3 (yayma+sertleştirme; E1+E3 ile birleşik)
```

### Mevcut Faz A–E ile birleşik resim

```
B1 (demo-bağı kır)  ──önkoşul──►  O0.4 (dashboard onboarding kartı)
O0–O2 (onboarding)               (yeni; bağımsız kol)
O1.1 (/sistem ayrımı) ──besler──► Faz D (RBAC granülerlik)
O1.4 nav `requiredCapability` alanı ──teslim──► Faz D (doldurur)
A4 (iş-akışı kısayolları) ≡ O2 (sihirbaz aynı felsefe; A4 genel, O2 onboarding-özel)
O3 ≡ E1+E3 (birleştir)
```

**Önerilen genel sıra:** `B (B1 dahil) → O0 → O1 → O2 → [A, C paralel] → D → O3/E`.
Gerekçe: onboarding zinciri (O0→O2) ürünü "0 veriyle kurulabilir" hedefine en hızlı taşır;
B1 ucuz önkoşul; A/C bağımsız kollar; D, O1.1'in açtığı `/sistem` ayrımından beslenir; O3=E
süreklilik.

---

## 9. Riskler & Açık Kararlar (kullanıcı onayı bekleyen)

### Backend bağımlılıkları (bir backend agent uygular — FE bunlara bağlı)

| Kod | Bağımlılık | Bloke ettiği | Önem |
|-----|-----------|--------------|------|
| **BG-1** | `POST /tenants` genişlet (`firstAdmin`) **veya** `POST /tenants/:id/admins` — atomik ilk-admin provision (K4+K6 kopuğunu kapatır) | O1.3 (zincirin kalbi) | 🔴 KRİTİK |
| **BG-2** | `SEED_MODE=minimal` — yalnız system tenant + SYSTEM_ADMIN | O0.1 | 🟡 |
| **BG-3** | Kazanım (LearningOutcome) — ya ulusal LGS kataloğu paylaşımlı, ya tenant-başı kazanım yönetim UI/endpoint'i (fresh tenant'ta sıfır → sınav/optik kullanılamaz) | O2.8 (opsiyonel adım) + sınav/optik | 🟡 |
| **BG-4** | `GET /tenants` gerçek `ListMeta` döndürsün (şu an `TenantRecord[]`; sayfalama sahte) | O1.2 sayfalama | 🟢 |
| **BG-5** | Tenant başına aktif kullanıcı/koltuk sayısı (koltuk kullanımı göstergesi için) | O3.3 | 🟢 |
| **BG-6** | (Opsiyonel) Sunucu-tarafı onboarding ilerleme/atlama kalıcılığı (çok-cihaz) | O2.4 alternatifi | 🟢 düşük |

### Açık kararlar (kullanıcı net cevap vermeli)

1. **`/sistem` ayrı rota mı, `/kurum` yeniden kullanım mı?**
   → Plan **ayrı `/sistem`** öneriyor (§1 tablo). Onaylanırsa O1.1 buna göre. Reddedilirse
   tüm O1 yeniden çerçevelenir (önemli kapsam etkisi).

2. **İlk-admin: şifre belirleme mi, davet e-postası mı (BG-1 modu)?**
   → Plan **ikisini de** destekliyor (toggle). Ama varsayılan hangisi? E-posta altyapısı
   (SMTP) prod'da hazır mı? Hazır değilse "şifre belirle + elle ilet" varsayılan olmalı.
   **Kullanıcı: e-posta gönderimi çalışıyor mu?**

3. **Kazanım (BG-3): paylaşımlı ulusal katalog mu, kurum-başı mı?**
   → Çok-kurumlu SaaS'ta LGS kazanımları **ortak** (ulusal müfredat). Plan önerisi:
   **paylaşımlı, salt-okunur ulusal katalog** + kurum-başı ek kazanım (opsiyonel). Bu, her
   yeni kurumun 120 kazanımı elle girmesini önler. **Kullanıcı onayı gerek** (mimari karar:
   shared tablo vs tenant-scoped + seed-on-create).

4. **Demo seed: opsiyonel bayrak olarak kalsın mı?**
   → Plan önerisi: **evet** — `SEED_MODE=demo` (mevcut tam fixture, geliştirme/demo için) ve
   `SEED_MODE=minimal` (prod, O0.1) bir arada. Demo seed silinmez, bayrağa alınır (geliştirici
   deneyimi korunur; mevcut hafıza notu "demo accounts" buna bağlı).

5. **SYSTEM_ADMIN `/kurum`'a hiç giremesin mi?**
   → Plan: O1'de **giremez** (temiz ayrım); kurum denetimi için `/sistem/kurumlar/[id]`
   salt-okunur özet, derin denetim Faz D impersonation. **Kullanıcı:** platform sahibinin
   bir kurumu "içeriden" görme ihtiyacı acil mi? Acilse Faz D impersonation öne çekilir.

6. **ASSISTANT_ADMIN kapsamı O1'de mi netleşsin, Faz D'ye mi kalsın?**
   → Plan: O1'de **kaba** (Operasyon+Finans gizli statik filtre), tam granülerlik Faz D.
   Kullanıcı daha erken tam-granülerlik isterse D, O2'den önce gelmeli (sıra değişir).

### Teknik riskler

- **UI paket rebuild zorunluluğu** (hafıza notu): `EmptyState` ve `CrudPage.emptyState` eklenince
  `@o-okul/ui` **rebuild** edilmeli, yoksa web tüketmez. Her O0.2 sonrası kapı buna dikkat etmeli.
- **react-query önbellek paylaşımı:** `use-setup-progress` alt sorguları modül anahtarlarını
  (`["next-campuses", tenantId]`) paylaşırsa, modülde ekleme → sihirbaz otomatik güncellenir
  (artı). Ama anahtar şekli **birebir** eşleşmeli (listQuery dahil/hariç) yoksa çift fetch olur.
  Öneri: sihirbaz sayımları için `?limit=1` ile **ayrı, sade** anahtar `["next-<modül>-count", tenantId]`
  kullan — modül listesinden bağımsız, stale riski yok.
- **`tenantId="system"` sızıntısı:** O1.1 öncesi SYSTEM_ADMIN `/kurum`'da iken CRUD sorguları
  `tenantId="system"` ile gider (K1+K3). O1.1 bu yolu kapatınca risk biter; **O1.1 erken yapılmalı**.
- **E2E kapsamı ince** (mevcut plan tespiti): onboarding zinciri uçtan-uca yeni E2E gerektirir;
  bu, mevcut planın E1 yatırımıyla örtüşür (birleştir).

---

## 10. Özet — değişen/eklenen dosyalar (hızlı referans)

**Yeni dosyalar:**
- `app/(app)/sistem/page.tsx`, `system-dashboard.tsx`
- `app/(app)/sistem/kurumlar/page.tsx`, `tenants-page.tsx`
- `app/(app)/sistem/kurumlar/[tenantId]/page.tsx`, `tenant-detail-page.tsx`
- `app/(app)/sistem/_shared/system-api.ts`
- `app/(app)/kurum/kurulum/page.tsx`, `setup-wizard.tsx`
- `app/(app)/kurum/kurulum/_shared/wizard-steps.ts`, `use-setup-progress.ts`
- `@o-okul/ui` → `EmptyState` bileşeni (+ barrel export, rebuild)

**Değişen dosyalar:**
- `app-shell.tsx` → `hasSystemAccess`, `canAccessPath`, `getHomePath`, sidebar nav seçimi
- `_shared/navigation.ts` → `systemNavGroups` + (opsiyonel) `NavItem.requiredCapability`
- `src/form-validation.ts` → `tenantCreateFormSchema`; `userRolesSchema`'ya ASSISTANT_ADMIN
- `kurum/kullanicilar/users-page.tsx` → ASSISTANT_ADMIN, iki-yol yeniden çerçeveleme
- `kurum/ogretmenler/*` → "Portal daveti gönder" satır kısayolu
- `kurum/kurum-dashboard.tsx` → boş-durum onboarding kartı (B1 ile birlikte)
- 6 çekirdek modül → `EmptyState` + `?new=1` deep-link
- `@o-okul/ui` `CrudPage` → `emptyState?: ReactNode` prop (geriye uyumlu)
```
