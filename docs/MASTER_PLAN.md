# Uzman Hocam — Master Geliştirme Planı

> _Kaynak: `prd.md` üzerinden genişletilmiş master plan · Tarih: 2026-05-29 · Durum: onaylandı_
>
> _Güncelleme 2026-05-31: Faz 0–6 (backend/altyapı) tamamlandı. Ürün arayüzü eksenli devam yol
> haritası (Faz A–E) **§10**'a eklendi._
>
> _Faz A başlangıç kanıtı: kalan devam fazları `docs/phase-a-checklist.md` altında kontrol
> listesine dönüştürüldü; ilk uygulama dilimi refresh/logout CSRF kapısıdır._

## 1. Bağlam (Context)

Elimizde yalnızca bir `prd.md` var (greenfield; hiç kod yok). PRD; modülleri, rolleri, teknoloji
yığınını ve 6 fazlı kaba bir yol haritasını tanımlıyor ama **uygulanabilir** bir mimari ve
**adım adım inşa stratejisi** içermiyor. Bu plan, PRD'yi solo bir geliştiricinin **Claude Code
subagent'larını orkestra ederek** güvenli, test-edilebilir ve fazlara bölünmüş şekilde inşa
edebileceği bir **master plana** dönüştürür.

**Hedef sonuç:** Çok kiracılı (multi-tenant) bir dershane/kurum eğitim yönetim SaaS'ı —
kurumlar birbirinin verisini asla göremez, 10.000+ öğrenci ölçeğinde kullanılabilir kalır,
sınav puanlama/rapor hesapları tekrar üretilebilir ve kritik işlemler izlenebilir.

> İnşaya başlandığında **ilk iş** bu master planı repoya taşımaktır: `docs/MASTER_PLAN.md`.

### 1.1 Mevcut Repo Durumu ve İlk Kanıt

2026-05-29 ilk incelemesinde çalışma ağacında yalnızca `AGENTS.md` ve kök `MASTER_PLAN.md`
görülüyordu. İlk plan geliştirme adımıyla `docs/` altında kanonik plan kopyası, karar kayıtları ve
Faz 0 checklist'i başlatıldı. Kod iskelesi ve `prd.md` hâlâ yok; bu yüzden bir sonraki iterasyonun
amacı kod başlatmadan önce eksik karar kaynaklarını tamamlamak ve Faz 0'ın başlayabileceğini
kanıtlamaktır.

**İlk kabul kriteri:**
- `docs/MASTER_PLAN.md` bu dosyanın güncel kopyası olur.
- PRD repo dışındaysa `docs/prd.md` olarak eklenir; eklenemiyorsa `docs/DECISIONS.md` içinde hangi
  kararların PRD'den geldiği ve hangi kaynakla doğrulandığı yazılır.
- Faz 0 başlamadan önce `docs/phase-0-checklist.md` oluşturulur ve her madde komut, dosya veya test
  çıktısıyla doğrulanabilir hale getirilir.

---

## 2. Onaylanmış Kararlar ve Varsayımlar

**Kullanıcı ile netleştirilen 4 temel karar:**
- **Tenant izolasyonu:** Shared DB + **Postgres Row-Level Security (RLS)** + Prisma `$extends`
  ikinci savunma katmanı. ("Kurumlar birbirinin verisini asla göremez" = sert kabul kriteri.)
- **Dağıtım:** VPS / self-hosted **Docker Compose** ile başlangıç; ölçekte managed cloud'a
  geçiş yolu açık. **KVKK / veri ikametgâhı** birinci sınıf gereksinim (TR datacenter).
- **Geliştirme modeli:** Solo + Claude Code subagent'ları → her faz bir **agent orkestrasyonu**
  ile yürütülür (bkz. §6).
- **Sınav kapsamı:** TXT/DAT (optik) değerlendirme önce/birinci sınıf; online deneme yalnız
  temel altyapı (ağır canlı gözetim yok). Gerçek TXT/DAT örneği gelene kadar parser özelliği
  kontrollü beta sayılır; hedef kapsam değişmez.

**Makul varsayılanla çözülen, Faz öncesi onaylanacak kararlar** (mimariyi değiştirmez):
- **Veli↔Öğrenci bağlama:** Kurum yöneticisi tarafından kurulur (telefon doğrulama Faz 5'e
  opsiyonel). Karar: DEC-20260531-01.
- **Standart puan formülü:** `ScoringConfig` ile **konfigüre edilebilir**; varsayılan = ham net +
  basit sıralama; T-skor/yüzdelik v1 kapsamı dışı. Karar: DEC-20260531-02.
- **Kota davranışı:** Aşımda **hard-block** (PRD ile uyumlu). Ödeme/fatura entegrasyonu **v1
  kapsamı dışı**; abonelik/kota sistem yöneticisi tarafından manuel yönetilir.
- **Dil:** UI Türkçe; i18n'e hazır altyapı ama tek dil.

---

## 3. Hedef Mimari

### 3.1 Monorepo (pnpm workspaces + Turborepo)
```
uzman-hocam/
├── apps/
│   ├── web/          # Next.js (App Router) — kullanıcı arayüzü
│   ├── api/          # NestJS — REST API + BullMQ producer
│   └── worker/       # BullMQ standalone processor (CPU-yoğun işler izole)
├── packages/
│   ├── db/           # Prisma schema, migrations (RLS dahil), seed, generated client
│   ├── shared-types/ # Zod şemaları → TS tipleri (frontend↔backend TEK kaynak)
│   ├── ui/           # shadcn/ui sarmalayıcı + CrudPage/DataTable/FormModal primitifleri
│   ├── config/       # ESLint, tsconfig, Tailwind ortak config
│   └── sms-adapter/  # SMS sağlayıcı soyutlaması (interface + impl)
├── docker-compose.yml (+ .prod / .staging override)
└── turbo.json, pnpm-workspace.yaml
```
**Tip stratejisi:** `shared-types`'taki Zod şemaları tek kaynak; `api` bunları `nestjs-zod` ile
DTO + OpenAPI'ye, `web` ise `react-hook-form` + `zodResolver` ile form validasyonuna dönüştürür.

### 3.2 Çok Kiracılılık — RLS + Çift Savunma
Her tenant-tablosunda `tenantId` + RLS politikası; request başına transaction içinde tenant
context set edilir:
```sql
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
CREATE POLICY student_tenant_isolation ON "Student"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true)
         OR current_setting('app.bypass_rls', true) = 'true')
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true)
              OR current_setting('app.bypass_rls', true) = 'true');
```
```typescript
// İkinci savunma: Prisma $extends ile uygulama katmanı filtresi (RLS düşerse bile korur)
await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
```
- **RequestContext** (`tenantId | null`, `userId`, `roles`, `bypassRls`) NestJS
  `AsyncLocalStorage` ile request boyunca taşınır; controller'a tenant parametresi geçilmez.
- **Sistem yöneticisi** cross-tenant erişimde `bypass_rls=true` (yalnız bu rol).
- **Migration:** Şema değişiklikleri Prisma migrate; RLS policy'leri raw SQL migration
  dosyalarıyla (`packages/db/migrations/*_rls.sql`) yönetilir, CI'da `ENABLE/FORCE RLS`, `USING`
  ve `WITH CHECK` policy varlığı app DB role ile doğrulanır.
- **Risk koruması:** `queryRaw`/`executeRaw` `$extends` filtresini atlar → ham SQL'de manuel
  tenant filtresi zorunlu; CI lint kuralı eklenir.
- **DB erişim kuralı:** API ve worker dahil tüm tenant verisi erişimi tenant-aware Prisma
  transaction/client içinden geçer. Tenant context yoksa DB erişimi testte fail eder.
- **DB rolleri:** Uygulama kullanıcısı tablo sahibi olmaz; migration owner ve runtime app role
  ayrılır. `bypass_rls` yalnız sistem yöneticisi akışında ve audit log ile set edilir.

### 3.3 RBAC
Roller: `SYSTEM_ADMIN > TENANT_ADMIN > TEACHER > STUDENT > GUARDIAN`. NestJS `RolesGuard` +
`@Roles()` decorator. **Satır düzeyi zorlama servis katmanında** (örn. STUDENT yalnız kendi
kaydı, GUARDIAN yalnız bağlı öğrenci). Controller asla ham Prisma'ya erişmez.

### 3.4 API Sözleşmesi
- Kaynak tabanlı REST: `/api/v1/{group}/{resource}` (`?page&limit&q&sort=field:asc&filtre`).
- **Yanıt zarfı:** liste `{ data, meta:{total,page,limit,totalPages} }`, tekil `{ data }`,
  hata `{ error:{ code, message, details? } }` (makine-okunur `code` + Türkçe `message`).
- HTTP kodları katı (201 create, 204 soft-delete, 403 yetki, 409 çakışma, 422 iş kuralı).
- OpenAPI `@nestjs/swagger` ile otomatik.

### 3.5 Frontend
- **App Router:** rota grupları `(auth)`, `(tenant)`, `(system)`. Tablo/başlık/breadcrumb
  **RSC** (server-side fetch); modal/filtre/toast `"use client"`.
- **Oturum:** access token bellekte (Zustand), refresh token **httpOnly+Secure+SameSite cookie**;
  401'de interceptor `/auth/refresh` ile sessiz yeniler. Refresh token rotate edilir; reuse
  tespitinde oturum ailesi iptal edilir. Logout/revoke, rol veya tenant membership değişikliği eski
  token'ları geçersiz kılar; refresh endpoint CSRF'e karşı test edilir.
- **Ortak ekran kalıbı** (PRD standardı: başlık + filtre + ana buton + tablo/kart + modal +
  silme onayı + toast) tek soyutlamada:
```tsx
<CrudPage title="Öğrenciler" columns={studentColumns} fetchFn={studentApi.list}
          FormModal={StudentFormModal}
          filters={[{ key:'classId', label:'Sınıf', type:'select', optionsFn: classApi.listOptions }]} />
```
`DataTable` = shadcn Table + `@tanstack/react-table` (server-side sort/pagination);
`FormModal` = react-hook-form + Zod; toast = `sonner`; silme = `AlertDialog`.

### 3.6 Arka Plan İşleri (BullMQ, ayrı worker)
Kuyruklar: `announcement-delivery`, `exam-evaluation`, `excel-import`, `report-generation`, `sms-batch`.
Her job: `attempts:5` + exponential backoff, `jobId = entity_contentHash` (idempotency),
`removeOnFail:false` (ölü mektup saklanır), `updateProgress` ile ilerleme (SSE/polling).

### 3.7 Dağıtım Topolojisi (Docker Compose + Traefik)
```
internet → Traefik(80/443, ACME/TLS) → [web, api]
                                            └→ [worker] → [postgres, redis, minio]
```
- Ağ izolasyonu: `frontend_net` (traefik↔web/api) + `backend_net` (api/worker↔db/redis/minio);
  web doğrudan DB'ye erişemez. Named volume'lar; her serviste `/health` + `depends_on:
  service_healthy`. Staging/prod = compose override; tam izolasyon için ayrı VPS önerilir.
- **NOT (altyapı doğrulaması):** Traefik ACME/entrypoint sözdizimi sürümle değişir →
  config yazılırken **resmi Traefik dokümantasyonu WebFetch ile doğrulanmalı** (varsayımla
  yazılmaz).

---

## 4. Veri Modeli (PRD + rafine eklemeler)

PRD çekirdek modelleri korunur; tüm tenant-tabloları **`tenantId` + `deletedAt` (soft-delete) +
audit alanları (`createdBy/updatedBy`)** taşır ve RLS'e tabidir.

**Sınav alt sistemi için eklenen entity'ler:**
- `RawImport` — yüklenen TXT/DAT/Excel'in **değişmez arşivi** (`s3Key`, `sha256`, `parserConfigVersion`).
- `ParserConfig` — cihaz-varyantına dayanıklı **kolon-eşleme şablonu** (encoding, delimiter,
  field mapping; bkz. §5).
- `ImportQuarantine` — eşleştirilemeyen satırlar (manuel çözüm için).
- `OnlineExamSession` — zamanlı online sınav oturumu (`answers` JSONB, `tabBlurEvents`).
- `ReportSnapshot` — `inputRefs` (RawImport id'leri + AnswerKey/parser/engine versiyonları) +
  `snapshotData` (JSONB) + `status: PENDING|READY|STALE`.

**Kritik indexler (10k+ öğrenci):** `Student@@index([tenantId, deletedAt])`,
`Student@@index([tenantId, classId, deletedAt])`, `ExamResult@@index([tenantId, examId])`,
`ExamResult@@index([tenantId, studentId])`, `ExamResult@@unique([examId, studentId])`,
`AuditLog@@index([tenantId, entityType, createdAt])` (append-only; Faz 6'da partitioning).

---

## 5. Sınav / Optik Değerlendirme Alt Sistemi (en riskli — özel bölüm)

**Veri akışı:** `Exam → ExamPlan → ExamRoom → ExamParticipant → AnswerKey → (RawImport:
TXT/DAT) → Parser → Matching → ScoringEngine → ExamResult → ReportSnapshot`. Her entity'nin bir
durum makinesi vardır (örn. ExamParticipant: `REGISTERED→ATTENDED/ABSENT→EVALUATED`).

**TXT/DAT format riski — somut azaltma planı** (gerçek örnek dosya YOK → en yüksek risk):
1. **Soyut parser arayüzü + mock fixture** ile ilerle; iş mantığı dosya formatından bağımsız.
2. İlk pilotta **`FormatAnalyzerService`**: örnek dosyadan encoding/delimiter/kolon haritası
   önerir → yetkili onayıyla `ParserConfig` kaydına yazılır.
3. Format biriktikçe **`ParserConfig` şablon kütüphanesi**. Bu aşamaya kadar özellik "beta";
   alternatif olarak manuel Excel upload sunulur.
```typescript
interface ParserConfig { encoding:'UTF-8'|'ISO-8859-9'|'CP1254'; delimiter:'TAB'|'COMMA'|'FIXED'|'PIPE';
  skipHeaderLines:number; fieldMapping:{ studentNo:FieldSpec; bookletType:FieldSpec;
  answers:AnswerFieldSpec; absentMarker?:string }; version:number; }
```
**ScoringEngine = saf fonksiyon** (deterministik, yan etkisiz → birim testi kolay):
girdi `(answers, answerKey, scoringConfig)` → çıktı branş bazında doğru/yanlış/boş, net
(`D − Y*katsayı`), ham + standart puan, `_meta:{ answerKeyVersion, engineVersion, computedAt }`.

**Tekrar üretilebilirlik & idempotency:** `ExamResult` üzerinde
`unique(participantId, answerKeyVersion, parserConfigVersion, engineVersion)`; aynı kombinasyon
yeniden işlenmez. AnswerKey güncellenince ilgili `ReportSnapshot`'lar `STALE` işaretlenir, eski
snapshot kullanıcı "Yeniden Hesapla" diyene dek erişilebilir kalır. Eşleşmeyen satırlar →
`ImportQuarantine`. **Çıktı:** PDF = Puppeteer (server-side render), Excel = ExcelJS (stream,
formül değil değer yazılır).

**Online deneme:** `OnlineExamSession` (delayed job ile süre bitince otomatik gönderim, hafif
sekme/odak loglama) → aynı `ScoringEngine` ve `ReportSnapshot` hattına `sourceType` ile bağlanır.

---

## 6. Fazlı Yol Haritası + Agent Orkestrasyonu

Her faz: **hedef → kapsam → agent orkestrasyonu → kalite kapısı**. Ana Claude implementasyonu
yürütür; subagent'lar tasarım kilidi, uzman inceleme ve test üretimi için çağrılır.

> **Durum (2026-05-31):** Aşağıdaki Faz 0–6 (backend, altyapı, güvenlik, gözlemlenebilirlik)
> tamamlandı (bkz. `docs/phase-0..6-report.md`). Buradan sonraki **ürün arayüzü** (Next.js rol
> portalları + Chart.js raporlama) ve gereksinim-boşluğu modülleri için devam yol haritası
> **§10**'dadır.
>
> **V1 kapsam notu (2026-06-19):** Bu bolum tarihsel yol haritasidir. V1 icin kanonik kapsam
> kilidi `docs/product-journeys-v1.md` ve `docs/DECISIONS.md` `DEC-20260613-01` altindadir.
> Salon/oturma plani, online deneme, odeme saglayici/fatura ve OMR/fotograf optik okuma v1
> kapsam disidir; buradaki eski faz metinleri kapsam genisletme kaynagi sayilmaz.

### 6.0 Ortak Yürütme Protokolü

Her iterasyon başlamadan önce ana agent şu kısa planı yazar:
1. **Varsayım:** Bu iterasyonda neyin doğru kabul edildiği.
2. **Kapsam dışı:** Bu turda özellikle yapılmayacak işler.
3. **Sahiplik:** Hangi dosya/modül ana agent'ta, hangisi subagent'ta.
4. **Doğrulama:** Başarının hangi komut, test, dosya veya ekranla kanıtlanacağı.

Subagent kullanımı için kurallar:
- Bloklayan kritik yol ana agent'ta kalır; subagent'lar paralel incelenebilen veya ayrık dosya
  sahipliği olan işleri alır.
- Aynı dosya setine iki worker aynı anda yazmaz.
- Her subagent çıktısı şu formatla biter: değişen dosyalar, çalıştırılan doğrulamalar, kalan riskler.
- Güvenlik, veri izolasyonu, test ve devops işleri ayrı inceleme olarak çağrılır; bu incelemeler
  kodun kendisi kadar kalite kapısının parçasıdır.

### Faz 0A — Planı Repoya Sabitleme (1 gün)
- **Kapsam:** `docs/MASTER_PLAN.md`, PRD/karar kaydı, Faz 0 checklist'i, tenant izolasyon test
  taslağı, env/secret ve komut sözleşmesi, ilk ADR dosyaları (`ADR-0001-multi-tenancy.md`,
  `ADR-0002-deployment.md`).
- **Agent orkestrasyonu:** ana agent dokümanları taşır ve kaynakları bağlar → `system-architect`
  karar tutarlılığını inceler ∥ `security-engineer` tenant izolasyon test taslağını inceler →
  `quality-engineer` checklist'in ölçülebilir olup olmadığını kontrol eder.
- **Kalite kapısı:** `docs/` altında plan, PRD veya karar kaydı, Faz 0 checklist'i, tenant
  izolasyon test planı, env/secret listesi ve komut sözleşmesi bulunur; her checklist maddesi
  "dosya/komut/test kanıtı" içerir.

### Faz 0 — Temel & Güvenli İskelet (1–2 hafta)
- **Kapsam:** monorepo + Prisma şema + RLS politikaları; auth (JWT+refresh) + tenant context
  (ALS); RBAC guard; Docker Compose + Traefik/TLS; GitHub Actions (lint/typecheck/test/build/
  migrate deploy); shadcn tasarım sistemi + `CrudPage/DataTable/FormModal`; demo veriyle kurum
  paneli dashboard.
- **Uygulama sırası:**
  1. Monorepo ve ortak config kurulur → `pnpm install`, `pnpm lint`, `pnpm typecheck` çalışır.
  2. Prisma çekirdek şema, seed ve RLS migration iskeleti eklenir → migration ve RLS policy kontrolü
     lokal Postgres üzerinde çalışır.
  3. Auth, refresh token, tenant context ve RBAC guard eklenir → tenant A/B izolasyon testi kırmızıdan
     yeşile döner.
  4. Docker Compose, healthcheck ve CI işleri eklenir → servisler health verir ve CI aynı komutları
     koşar.
  5. Web shell, login ve demo dashboard eklenir → Playwright ile login + dashboard smoke testi geçer.
- **Agent orkestrasyonu:** `system-architect` (şema+RLS+monorepo kilidi) → `backend-architect`
  (auth+tenant context) ∥ `frontend-architect` (tasarım sistemi+shell) → `security-engineer`
  (RLS/auth incelemesi + **tenant izolasyon testi tasarımı**) ∥ `devops-architect` (Docker/CI) →
  `quality-engineer` (Jest+Vitest+Supertest+Playwright iskeleti, CI kapıları).
- **Kalite kapısı (CI-BLOCK):** tenant izolasyon testi (farklı tenant ile erişim → 403/0 kayıt),
  HTTPS+güvenlik header, login rate-limit+brute-force kilidi, günlük `pg_dump`, Sentry, TR datacenter.

### Faz 1 — Okul Yönetimi (3–4 hafta)
- **Kapsam:** Class/Teacher/Student/Guardian CRUD; **Excel toplu import/export** (dry-run +
  satır-bazlı hata + kota zorlaması, transaction rollback); kota hard-block.
- **Agent:** `backend-architect` (school modülü + quota) → `frontend-architect` (CRUD ekranları,
  `CrudPage` deseniyle) → `backend-architect` (Excel import BullMQ job) → `quality-engineer`
  (import validation + kota + CRUD e2e).
- **Önce onayla:** Veli↔Öğrenci bağlama kuralı.

### Faz 2 — Program, Etüt, Ödev (4–5 hafta)
- **Kapsam:** ders programı zaman çizelgesi (sınıf/öğretmen), etüt planlama, bağımsız +
  materyalden ödev, ödev kontrol ekranı.
- **Agent:** `backend-architect` (schedules/etut/homework) ∥ `frontend-architect` (program grid
  UI) → `quality-engineer` (entegrasyon: öğrenci→sınıf→ödev).

### Faz 3 — Sınav Planı & İşlemleri (5–7 hafta) — EN RİSKLİ
- **Kapsam:** salon/okul sınav planı, deneme havuzu, AnswerKey sürümleme, **TXT/DAT
  değerlendirme** (ParserConfig + ScoringEngine + RawImport + Quarantine), online deneme temel
  altyapı, optik form ekranı.
- **Agent:** `backend-architect` (sınav domain + durum makineleri + ScoringEngine) →
  `root-cause-analyst`/`backend-architect` (örnek dosya gelince FormatAnalyzer) →
  `security-engineer` (sınav verisi erişim) → `performance-engineer` (büyük DAT için
  `worker_threads` vs ayrı container kararı) → `quality-engineer` (deterministik puanlama +
  idempotency testleri).
- **Önce onayla:** standart puan formülü; **örnek TXT/DAT dosyası + cevap anahtarı formatı** edin.

### Faz 4 — Raporlama (5–6 hafta)
- **Kapsam:** öğrenci sınav raporu, sınıf başarı analizi, karne, branş başarı, gelişim, ödev/
  yoklama/etüt raporları; PDF + Excel çıktı; `ReportSnapshot` tekrar üretilebilirlik.
- **Agent:** `backend-architect` (rapor motoru + snapshot + PDF/Excel) ∥ `frontend-architect`
  (rapor görünümleri + grafikler) → `performance-engineer` (10k öğrenci listeleme/rapor, k6 +
  index doğrulama) → `quality-engineer` (rapor tekrar üretilebilirlik testleri).

### Faz 5 — Mesaj, Duyuru, Materyal, Destek (4–5 hafta)
- **Kapsam:** okul/öğretmen duyuruları, mesaj şablonları, **SMS adapter** (NetGSM/İletimerkezi
  impl ertelenebilir), materyal havuzu + kişiye özel atama + hata kitapçığı, destek bildirimi +
  dosya ekleri.
- **Agent:** `backend-architect` (messaging/announcement/SMS/material/support) ∥
  `frontend-architect` (ekranlar) → `security-engineer` (dosya yükleme güvenliği) →
  `quality-engineer` (SMS batch kuyruğu + duyuru hedefleme testleri).

### Faz 6 — Ürün Sertleştirme (3–4 hafta)
- **Kapsam:** performans iyileştirme + AuditLog partitioning, audit log ekranları, WAL/PITR
  yedek, KVKK veri-sahibi self-service, gözlemlenebilirlik stack (Loki/Grafana/Prometheus),
  yetki testleri, staging/prod sertleştirme, UAT.
- **Agent:** `performance-engineer` (yük testi + sorgu opt.) ∥ `security-engineer` (tam güvenlik
  denetimi + izolasyon penetrasyonu) ∥ `devops-architect` (WAL/PITR + observability + ~sıfır
  kesinti + KVKK portalı) → `refactoring-expert` (teknik borç) → `technical-writer` (runbook +
  kullanıcı dokümanı) → `quality-engineer` (UAT + tam e2e regresyon).

---

## 7. Çapraz Kesen Konular

- **AuditLog:** kritik işlemlerde (oluştur/güncelle/sil, yetki, giriş) interceptor ile
  append-only; `diff` JSONB. Saklama ≥2 yıl.
- **Soft-delete + Purge:** `deletedAt` her tabloda; KVKK silme talebinde PII alanları üzerine
  NULL yazan kalıcı purge + AuditLog kaydı.
- **KVKK/PII:** TR datacenter; PII envanteri (`nationalId`, `phone`, `birthDate`); Sentry/log'da
  maskeleme (`sendDefaultPii:false`); hassas alanlar için şifreleme değerlendirmesi (pgcrypto).
- **Güvenlik temeli (Faz 0):** TLS, güvenlik header'ları, Redis tabanlı rate-limit
  (`@nestjs/throttler`), brute-force kilidi, Dependabot; trivy imaj taraması Faz 2.
- **Gözlemlenebilirlik:** pino JSON log (`tenantId/userId/requestId`), Sentry, `/health`
  (+`/health/ready` DB+Redis), UptimeRobot. Loki/Prometheus Faz 6.
- **Test araçları:** api/worker = Jest + Supertest; web = Vitest; e2e = Playwright. Kapsam
  hedefi: kritik iş mantığı (puanlama/rapor/kota) %90+, auth %85+, genel %70+.

---

## 8. Riskler & Açık Kararlar (konsolide)

| # | Konu | Etki | Plan |
|---|------|------|------|
| 1 | **TXT/DAT format bilinmezliği** | Yüksek | §5 3-aşamalı azaltma; gerçek örnek dosya edinilene dek "beta" + Excel alternatifi |
| 2 | RLS performansı (`set_config` overhead, >200 rps) | Orta | Faz 3'te yük testi; RLS zorunlu kalır, gerekirse index/policy/pooling/işlem sınırı optimize edilir |
| 3 | Büyük DAT dosyası worker'ı bloke edebilir | Orta | `worker_threads` veya ayrı container (Faz 3 `performance-engineer`) |
| 4 | `$extends` ham SQL'i atlar → sızıntı | Orta | Ham SQL'de zorunlu manuel filtre + CI lint kuralı |
| 5 | AuditLog büyümesi | Orta | `createdAt` range partitioning (Faz 6) |
| 6 | SMS GSM-7 vs Unicode (TR karakter) faturalama | Düşük | Adapter'da uzunluk/segment hesabı; sağlayıcı seçimi ertelenir |
| 7 | Veli↔Öğrenci bağlama / standart puan / kota | Düşük | Varsayılanlar §2'de; ilgili faz öncesi onay |

---

## 9. Doğrulama (Verification)

Sistem uçtan uca şu kapılarla doğrulanır (her biri CI'da veya staging'de koşar):
1. **Tenant izolasyonu (kritik):** Tenant A kullanıcısı, Tenant B kaynağına erişmeye çalışır →
   `403` + sorgu 0 kayıt döndürür. Hem app hem RLS katmanında ayrı test. *CI bloklayıcı.*
2. **Sınav puanlama:** `ScoringEngine` için bilinen girdi/çıktı fixture'larıyla deterministik
   birim testleri (doğru/yanlış/boş, net katsayısı, branş kırılımı). *CI bloklayıcı.*
3. **Tekrar üretilebilirlik:** Aynı `RawImport`+versiyon kombinasyonu yeniden işlendiğinde
   `ExamResult` değişmez (idempotency); `ReportSnapshot` `inputRefs` ile izlenebilir.
4. **Excel import:** hatalı satırlar için satır-bazlı hata raporu + dry-run; kota aşımında
   import durur (rollback). *CI bloklayıcı.*
5. **Kota:** öğrenci limiti aşılınca ekleme/import engellenir.
6. **E2E akış (Playwright, staging):** yönetici login → sınıf/öğretmen/öğrenci CRUD → toplu Excel
   → ödev → sınav planı → TXT/DAT (mock) değerlendirme → rapor PDF.
7. **Performans (Faz 4):** 10.000+ öğrenci listeleme/filtreleme kullanılabilir kalır (k6).
8. **RLS migration kapısı:** Her tenant tablosunda RLS enabled/forced, `USING` + `WITH CHECK`
   policy ve app DB role ile negatif okuma/yazma testi. *CI bloklayıcı.*
9. **Auth oturum kapısı:** refresh rotation, reuse detection, logout/revoke ve rol/tenant
   değişikliği sonrası eski token reddi. *CI bloklayıcı.*
10. **Worker tenant kapısı:** BullMQ job'ları tenant/user context olmadan tenant verisine erişemez;
    job payload doğrulanır ve audit'e bağlanır.
11. **Kişi seviyesi RBAC kapısı:** STUDENT/GUARDIAN başka öğrencinin raporunu, ödevini, sınav
    sonucunu veya profilini göremez.

**Lokal çalıştırma:** `docker compose up` (postgres+redis+minio+traefik) → `pnpm db:migrate` →
`pnpm dev` (web+api+worker) → seed demo tenant → tarayıcıda kurum paneli + bir CRUD akışı manuel
doğrulama.

**Her faz çıkış paketi:** faz sonunda kısa bir `docs/phase-N-report.md` yazılır. Bu rapor yalnız
özet değildir; tamamlanan kapsamı, çalıştırılan komutları, test sonuçlarını, kalan riskleri ve bir
sonraki faza geçiş için açık onay maddelerini içerir.

---

## 10. Devam Yol Haritası — Ürün Arayüzü & Boşluk Kapatma (2026-05-31)

> _Kaynak: `system-architect ∥ frontend-architect ∥ backend-architect ∥ security-engineer`
> orkestrasyonu, mevcut kod tabanı üzerinden sentez · Durum: onaylandı · Önkoşul: Faz 0–6
> tamamlandı. Bu bölüm §6'nın (Faz 0–6) yerini almaz; onun **üstüne** gelen, ürün arayüzü eksenli
> devam fazlarıdır (Faz A–E)._
>
> _V1 kapsam notu (2026-06-19): Bu bolum eski bosluk analizini korur. Rol portallari,
> kisi-duzeyi erisim ve panel kanitlari icin guncel kaynak `docs/product-journeys-v1.md` ve
> ilgili Faz A-E raporlaridir._

### 10.1 Bağlam: Nereden devam ediyoruz (kanıt)

Faz 0–6, **backend + altyapı + güvenlik + gözlemlenebilirlik** katmanını üretti (`apps/api` 128,
`apps/worker` 45 TS dosyası; tüm domain modülleri testli; prod-readiness/smoke script'leri). Asıl
boşluk **ürün arayüzüdür**:

- `apps/web` = aktif yüzey **Next.js App Router**. Vite+React prototipi ve eski Playwright kapıları
  Faz E'de söküldü; kurum modül ekranları, rol portalları ve web e2e kapısı Next üzerinden çalışıyor.
- `packages/ui` boş stub (`CrudPage/DataTable/FormModal` kurulmamış); `packages/shared-types` yalnız
  parser/FormatAnalyzer tiplerini veriyor → frontend tüm entity tiplerini elle tanımlıyor;
  **Chart.js yok**.
- Rol ayrımı yok: yalnız Kurum paneli var; **Veli/Öğrenci/Öğretmen portalları yok** (backend RBAC
  hazır, UI yok).
- Gereksinim ↔ backend boşlukları (grep: 0 dosya): **devamsızlık, öğrenci ödeme planı,
  kazanım-seviyesi analiz, TC kimlik + öğrenci profili, öğretmen notu**.

**Hedef:** §3.5 hedef mimarisini gerçekleştiren 4 rol portalı + Chart.js raporlama + eksik backend
modülleri; mevcut backend sözleşmesi (§3.4) korunarak, additive.

### 10.2 Mimari kararlar (devam fazları için)

| Konu | Karar | Gerekçe |
|---|---|---|
| Frontend yığını | **Next.js App Router'a geçiş** (Vite prototip atılır, auth/CRUD/rapor çağrı mantığı taşınır) | §3.5 hedefi; rol-bazlı route grupları 4 portala oturur |
| Rotalama | Rol-bazlı segment: `(auth)/login`, `(app)/{kurum,ogretmen,ogrenci,veli}`; üç katmanlı guard (middleware kaba + RootGuard + RoleGuard) | Her rol kendi layout/guard'ı; istemci guard **yalnız UX**, gerçek yetki backend |
| Veri çekme | **Client-fetch + TanStack Query** (RSC korumalı veri çekmez; RSC yalnız kabuk) | Access token bellekte; RSC'ye token taşımak §3.5 modelini bozar |
| Tip sözleşmesi | **`shared-types`'a düz TS `interface` (additive)**; form runtime doğrulaması gereken yerde web katmanında Zod | API'de Zod yok; backend kırılmadan frontend'in elle-tip yazması biter. "Zod monorepo-geneli tek kaynak / nestjs-zod" ayrı/sonraki karar |
| Tasarım sistemi | `packages/ui`'de **shadcn/ui** + Radix + Tailwind + CVA; `CrudPage / DataTable(@tanstack/react-table, server-side) / FormModal(react-hook-form) / ConfirmDialog / Toaster(sonner)`; tek Tailwind preset | §3.5 ortak ekran kalıbının tek soyutlaması; 4 portal tutarlı tek sistem |
| Grafikler | **`react-chartjs-2`**, `packages/ui/src/charts/`, client-only, ağaç-sarsılabilir register; wrapper'lar **domain veri şekli** alır (Chart.js `data/options` değil) | §10.5 eşlemesi |
| Oturum/CSRF | Access token bellek (Zustand) + refresh httpOnly cookie + **single-flight silent refresh**; `/auth/refresh` & `/auth/logout` için **double-submit CSRF** (`csrfToken` cookie + `X-CSRF-Token`) | §3.5 + mevcut CSRF mekanizması yok (açık) |
| Env | `NEXT_PUBLIC_API_URL` (tarayıcıya açık tek değişken); `NEXT_PUBLIC_*` altında secret yasağı | KVKK/PII |

### 10.3 Gizli kritik yol — Modül 0: Kimlik Bağı & Kişi-Düzeyi Yetki

Backend ve güvenlik incelemeleri **bağımsız olarak** aynı yapısal boşluğa ulaştı:

> Sistemde **`User` ↔ `Student/Guardian/Teacher` bağı yok** (ne şemada ne kodda). `RequestContext`
> yalnız `{userId, tenantId, roles}` taşıyor; `subjectId` yok. Hem RLS hem servis katmanı
> **yalnızca `tenantId`** kontrol ediyor → **kişi-düzeyi yetki bugün hiç yok**.

- **Risk (🔴):** Aynı tenant'taki bir veli, `:id` değiştirerek başka öğrencinin verisine erişebilir
  (IDOR). Rol portalları (öğrenci/veli/öğretmen) ve tüm `/me/**` endpoint'leri bu bağ olmadan inşa
  edilemez.
- **Çözüm (Modül 0):** `Student/Guardian/Teacher`'a `userId` FK (nullable, `@unique`);
  `RequestContext`'e `subjectType/subjectId`; `IdentityResolver` (userId→bağlı entity'ler) +
  `assertSubjectAccess(context, resource)` servis soyutlaması (mevcut yalnız-tenant
  `assertTenantResourceAccess` yetersiz); kritik tablolarda (ödeme) ek owner-RLS.
- **Sıralama avantajı:** **Kurum portalı (`TENANT_ADMIN`) Modül 0'a bağlı DEĞİL** (admin tüm
  tenant'ı görür). Frontend Kurum portalını kurarken backend Modül 0'ı **paralel** kurar; rol
  portalları zaten sonra geldiği için ön koşul zamanında hazır olur.

### 10.4 Kritik backend boşlukları (kapsam: frontend + backend boşlukları)

| Modül | Kapsam | Ön koşul | Güvenlik notu |
|---|---|---|---|
| **M1 Devamsızlık** | `Attendance(studentId, date, status: PRESENT/ABSENT/LATE/EXCUSED)`; öğretmen/kurum girer; veli/öğrenci görür; özet endpoint | M0 | RLS + kişi-düzeyi |
| **M2 Ödeme planı** | `PaymentPlan + PaymentInstallment(taksit, vade, durum)`; **yalnız kurum oluşturur, taksiti düzenler ve durumunu işaretler**; **yalnız kurum+veli görür** (öğrenci/öğretmen 403); plan kampüs/seviye/sınıf/ders/dönem bağlamı taşıyabilir. Fatura entegrasyonu YOK | M0 | owner-RLS + finansal PII + audit; hiyerarşi tuzağı (`@Roles` tek başına yetmez) |
| **M3 Kazanım** | `LearningOutcome` + `AnswerKeyItem.outcomeCode` (additive); ScoringEngine/ReportSnapshot kazanım kırılımı (saf fonksiyon + idempotency korunur); error-booklet'a kazanım | sınav alt sistemi + M0 | deterministik puanlama + idempotency kapısı |
| **M4 Profil + TC** | `Student.nationalId(TC)/birthDate/phone/email/photoKey`; TC algoritma doğrulama; `@@unique([tenantId, nationalIdHash])` | M0 | **TC: AES-256-GCM + HMAC-hash** (deterministik şifre yasak), rol-bazlı maskeleme, görüntüleme audit'i |
| **M5 Öğretmen notu** | `TeacherNote(studentId, teacherId, visibility: INTERNAL/GUARDIAN_STUDENT/...)`; gelişim durumu | M0 | `visibility` filtresi (INTERNAL sızıntı testi) |
| **M6 Rol-kapsamlı READ** | `/api/v1/me/**` envanteri (veli→bağlı çocuk, öğrenci→kendi, öğretmen→kendi sınıfı) | M0+M1+M2+M4+M5 | her `/me` kişi-düzeyi + çapraz-tenant 404 + hiyerarşi tuzağı |

> **Müfredat taksonomisi (veri ön koşulu):** Kullanıcı kapsamındaki ders/alan kırılımı (7/8-LGS ·
> 10/11/12 · MF/TM/TS/YDT alanları) = **kazanım (M3) seed verisi**. Radar grafiğinin anlamlı olması
> için bu müfredat (dersler + kazanım kodları, ör. `MAT.9.1.2`) seed'lenmelidir — M3'ün operasyonel
> ön koşulu.

### 10.5 Chart.js eşlemesi (backend verisi hazır)

| Rapor | Grafik | Wrapper | Veri kaynağı (mevcut/additive) |
|---|---|---|---|
| Gelişim Raporu | **Line/Area** | `ProgressLineChart` | `student-progress.points[].total{net,standardScore}` — hazır |
| Konu/Ders Analizi | **Radar** | `TopicRadarChart` | branş `branches[].net` (hazır) → kazanım `students[].outcomes[]` (M3 additive) |
| Sınav Sonuç Özeti | **Donut/Pie** | `ExamResultDonut` | `total{correct,wrong,blank}` / `averages` — **zaten mevcut** (yeni alan gerekmez) |
| Sınıf Karşılaştırması | **Bar** | `ClassCompareBar` | `snapshotData.classes[].averages` — hazır |

### 10.6 Birleşik fazlı yol haritası (Faz A–E) — dinamik iki-kol

İki kol paralel akar (🎨 Frontend ∥ ⚙️ Backend / 🔐 Security), rol portallarında birleşir. Her faz
**agent orkestrasyonu + kalite kapısı** taşır (§6.0 protokolü geçerli).

#### Faz A — Temel (paralel)
- **Kapsam:** (🎨) Next.js iskelet + `packages/ui` token/preset + Tier-0 atomlar → api-client +
  single-flight refresh + auth store + TanStack Query + guard'lar + `/login`. (🔐) CSRF double-submit
  + tip-sözleşmesi. (⚙️) **Modül 0** kimlik bağı.
- **Agent:** `frontend-architect` (web iskelet + ui) ∥ `security-engineer` (CSRF) →
  `backend-architect` (Modül 0 + `assertSubjectAccess`) → `quality-engineer` (izolasyon + IDOR test
  iskeleti).
- **Kalite kapısı (CI-BLOK):** login→`/kurum`; 401'de tek `/auth/refresh`+retry; token localStorage'da
  yok; refresh X-CSRF eksik→403; M0 kişi-düzeyi (STUDENT/GUARDIAN kapsam) + çapraz-tenant reddi.

#### Faz B — Kurum portalı + Chart.js raporları (ilk teslim önceliği)
- **Kapsam:** `CrudPage` referans (Öğrenciler) → CRUD çoğaltma (Sınıflar/Öğretmenler/Veliler/
  Şablonlar/Duyurular/Denetim/KVKK) ∥ 4 Chart wrapper + `/raporlar`. (⚙️) Liste query sözleşmesi
  doğrulama; Donut verisi dökümante (yeni alan yok).
- **Agent:** `frontend-architect` (CrudPage + ekranlar + grafikler) → `backend-architect` (liste
  query/meta) → `quality-engineer` (CRUD e2e + grafik render).
- **Kalite kapısı:** Playwright CRUD akışı yeşil; 4 grafik gerçek snapshot ile (boş/loading/
  erişilebilirlik sr-only tablo).

#### Faz C — Kritik backend boşlukları + UI
- **Kapsam:** M1 Devamsızlık ∥ M4 Profil+TC ∥ M5 Öğretmen notu (M0'a bağlı, bağımsız) → M2 Ödeme
  planı → M3 Kazanım. Frontend yer-tutucu → gerçek ekran.
- **Agent:** `backend-architect` (modüller) ∥ `security-engineer` (RLS/owner-RLS/TC şifreleme/PII/
  audit) → `frontend-architect` (ekranlar) → `quality-engineer`.
- **Kalite kapısı (CI-BLOK):** her tablo RLS (`check-rls.mjs` `tenantTables` listesine eklenir) +
  kişi-düzeyi RBAC; M2 öğretmen/öğrenci 403; M3 determinizm + idempotency; M4 TC algoritma +
  maskeleme.

#### Faz D — Rol portalları (öğretmen/öğrenci/veli)
- **Kapsam:** (⚙️) `/me/**` envanteri (M6). (🎨) 3 portal (layout+guard+landing → ekranlar),
  paylaşılan Chart wrapper'ları.
- **Agent:** `backend-architect` (me endpoint'leri) ∥ `frontend-architect` (portallar) →
  `security-engineer` (genişletilmiş negatif-erişim matrisi) → `quality-engineer`.
- **Kalite kapısı (CI-BLOK):** §9 madde-11 genişlemesi — her `/me` için yanlış-rol / başka-tenant /
  başka-veli (IDOR) / hiyerarşi-tuzağı → 403 + 0 kayıt.

#### Faz E — Sertleştirme
- **Kapsam:** Vite artefakt sökümü (en son) + Playwright e2e yeniden yazımı + **kimlik-bağı veri
  göçü** (mevcut veli/öğrenci→User davet/aktivasyon) + RLS yük testi (>200 rps) + KVKK self-service
  genişleme + foto upload magic-byte/AV.
- **Durum:** Vite artefakt sökümü, Playwright e2e yeniden yazımı, >200 rps RLS yük smoke'u,
  kimlik-bağı envanter audit'i, kimlik-bağı davet/göç kanıt kapısı, KVKK self-service ödeme koruma
  testi, KVKK finansal saklama kanıt kapısı, upload magic-byte kontrolü ve upload AV kanıt kapısı
  tamamlandı. Kimlik-bağı davet/göç modeli de eklendi; canlıya hazır sayılmadan önce üretim göç
  onay referansı ve gerçek raporu, gerçek KVKK finansal saklama süresi ve foto upload AV
  sağlayıcı/local scanner kararı ayrıca kapatılmalıdır.
- **Agent:** `devops-architect` / `performance-engineer` ∥ `security-engineer` →
  `refactoring-expert` → `quality-engineer` (tam e2e regresyon).

### 10.7 Çelişki uzlaştırmaları & faz öncesi onaylar

- **Tip sözleşmesi:** Düz TS interface ile başla (§10.2); Zod-her-yere ayrı karar. *(override
  edilebilir.)*
- **Donut:** Backend'den yeni alan **istenmez** — veri mevcut (`total.{correct,wrong,blank}`);
  dökümantasyon boşluğu.
- **RBAC hiyerarşi tuzağı:** `roleRank >=` → TEACHER, GUARDIAN yetkisini devralır. "Öğretmen
  görmemeli" kuralları (ödeme, INTERNAL not) servis-katmanı kapsam + owner-RLS ile çift zorlanır.
- **Onay bekleyen (ürün/ops):** üretim kimlik göç onay referansı ve gerçek raporu; finansal kayıt
  yasal-saklama vs KVKK purge istisnası; foto upload AV sağlayıcısı/local scanner.
- **Başarı oranı paydası:** v1'de ayrı `successRate` alanı üretilmez; gerekirse payda
  `correct + wrong + blank`, boş soru paydada yer alır ama neti düşürmez (DEC-20260531-03).

### 10.8 Riskler (konsolide — §8 eki)

| # | Konu | Etki | Plan |
|---|------|------|------|
| 8 | Kişi-düzeyi yetki yok (IDOR) | Yüksek | Modül 0 rol portallarından önce; Kurum portalı etkilenmez |
| 9 | CSRF mekanizması yok, `/auth/refresh` cookie-only | Yüksek | Double-submit (Faz A) |
| 10 | `check-rls.mjs` sessiz boşluğu (yeni tablo listede yoksa CI yeşil) | Yüksek | Her yeni tablo migration'ı `tenantTables`'ı güncellesin |
| 11 | Kimlik-bağı veri göçü (mevcut kayıt `userId=NULL`) | Orta | Davet/aktivasyon akışı (Faz D öncesi onay) |
| 12 | TC benzersizlik↔şifreleme gerilimi (deterministik şifre = sızıntı) | Orta | Non-deterministik GCM + HMAC-hash |
| 13 | Dosya yüklemede magic-byte/AV yok | Orta | Foto özelliğiyle (Faz C/E) |
| 14 | Next 16 / React 19 / Tailwind 4 + RSC sınırı yeni | Düşük | "RSC=kabuk, veri/grafik=client" Faz A'da örnekle sabitlenir |

### 10.9 Doğrulama kapıları (§9 genişlemesi)

§9'daki kapılar korunur; eklenenler:

12. **Kişi-düzeyi erişim (genişletilmiş §9.11):** her yeni endpoint için negatif matris — yanlış
    rol, başka tenant, başka veli (IDOR), `/me` kurcalama, GuardianStudent kurcalama → 403/404 + 0
    kayıt. *CI bloklayıcı.*
13. **CSRF:** `/auth/refresh` & `/auth/logout` X-CSRF eksik/yanlış → 403; doğru → rotation.
    *CI bloklayıcı.*
14. **Kazanım determinizmi/idempotency:** `outcomeCode`'lu ScoringEngine aynı girdi → bit-aynı çıktı;
    answer-key version artışı → snapshot STALE. *CI bloklayıcı.*
15. **TC/PII:** TC algoritma (geçersiz→422), tenant-içi benzersizlik (hash), rol-bazlı maskeleme,
    görüntüleme audit'i; yeni PII alanları pino redaction + Sentry maskeleme.
16. **Yeni tablo RLS kapısı:** her yeni tenant tablosu `check-rls.mjs` `tenantTables` listesinde +
    ENABLE/FORCE/USING/WITH CHECK doğrulanır. *CI bloklayıcı.*
