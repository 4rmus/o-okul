# Uzman Hocam — Mimari Analiz ve İyileştirme Tasarımı

> `/sc:design` çıktısı · Tarih: 2026-06-03 · Branch: `feat/institution-modules-and-rls-hardening`
> Kapsam: mevcut sistemin analizi + önceliklendirilmiş iyileştirme tasarımı (kod uygulaması ayrı adımdır).

## Uygulama Durumu (2026-06-03)

- **P1 — Kalıcılık yapılandırması: ✅ UYGULANDI.** Tek `PERSISTENCE_DRIVER` + `assertPersistenceConfig`
  boot guard; 33 store fabrikası `resolvePersistenceDriver`'a taşındı; `.env.example` + 3 script + readiness
  doc güncellendi. Doğrulama: typecheck 8/8, tüm testler (yeni `config/persistence.test.ts` dâhil) ve
  ops/readiness/contract statik kontrolleri geçti.
- **P2 — UI paketi: ✅ UYGULANDI.** `createElement` monoliti `src/components/*.tsx`'e bölündü, `jsx: react-jsx`,
  `"use client"` yalnız etkileşimli/grafik modüllerde, barrel `index.ts`. Doğrulama: typecheck + Next build + testler geçti.
- **P3 — İkincil: ⏸️ kısmen.** RSC sınırları P2 ile büyük ölçüde açıldı. Yeni E2E senaryoları canlı stack
  gerektirdiğinden ve store `update()` mikro-optimizasyonu spekülatif/düşük değerli olduğundan otomatik uygulanmadı
  (açık talep beklenir).

## 1. Yönetici Özeti

Kod tabanı olgun ve disiplinli: çok-kiracılı NestJS API + Next.js web + BullMQ worker,
veritabanı katmanında RLS, güçlü güvenlik (token rotation, CSRF, CSP), kapsamlı
gözlemlenebilirlik ve 100+ otomatik test. Kaynak kodda **0 TODO/FIXME/@ts-ignore**,
**0 eslint-disable** — nadir bir bakım kalitesi.

İki yapısal iyileştirme alanı öne çıkıyor:

| # | Bulgu | Önem | Etki |
|---|-------|------|------|
| **P1** | Kalıcılık (persistence) yapılandırması: 33 ayrı `*_STORE` bayrağı, hepsi **default in-memory**; prod-readiness yalnızca **5/33**'ünü zorluyor | 🔴 Kritik | Veri kaybı, yatay ölçekleme, savunma derinliği |
| **P2** | UI paketi: tek 635 satırlık `index.ts`, `createElement` (JSX yok), `tsconfig` yalnızca `.ts`, hiç `"use client"` yok | 🟡 Önemli | Geliştirici verimliliği, RSC kazanımı |
| P3 | İkincil: frontend'in tümünün client-component'e zorlanması, ince web E2E kapsamı | 🟢 Önerilen | Performans, frontend güveni |

---

## 2. Mevcut Mimari (doğrulanmış)

```
apps/api      NestJS 11 — 33 modül, controller→service→store/repository, 78 test
apps/worker   BullMQ — optik parse, scoring, psikometri, rapor, SMS; 27 test
apps/web      Next.js 16 App Router — 91 dosya, 30'u gerçek API'ye bağlı (react-query)
packages/db   Prisma + RLS migrasyonları + seed
packages/ui   Tek dosya bileşen kütüphanesi (createElement)
packages/{shared-types,sms-adapter,notification-adapter,config}
```

**Güçlü yönler (korunmalı):**
- **RLS izolasyonu** `withTenantQuery` ile transaction-local `set_config()` GUC'leri üzerinden;
  uygulama katmanında `filterTenantResources` ikinci savunma hattı.
- Auth: JWT access+refresh, token family rotation, login rate limiter, CSRF, güvenlik başlıkları.
- Worker ile CPU-yoğun işlerin izolasyonu; postgres adaptörleri + testleri.
- Zod tabanlı `shared-types` → frontend↔backend tek kaynak.
- Yoğun üretim-hazırlık tooling'i (smoke, evidence, KVKK envanteri, restore drill).

---

## 3. P1 — Kalıcılık Yapılandırması (🔴 Kritik)

### 3.1 Bulgu (kanıt)

Her store fabrikası kendi env bayrağına bakıp **default olarak InMemory** dönüyor:

```ts
// apps/api/src/school/class-store.ts:150
export function createClassStore(): ClassStore {
  return process.env.CLASS_STORE === "postgres" ? new PostgresClassStore() : new InMemoryClassStore();
}
```

- Kod tabanında **33 farklı `*_STORE`** env değişkeni var (CLASS, STUDENT, AUTH_USER,
  AUTH_SESSION, AUDIT_LOG, ATTENDANCE, ANNOUNCEMENT, SUPPORT_TICKET, …).
- `scripts/check-prod-env.mjs` bunlardan yalnızca **5**'ini zorluyor:
  `STUDENT_STORE, TEACHER_STORE, GUARDIAN_STORE, GUARDIAN_STUDENT_STORE, PAYMENT_PLAN_STORE`.
- `.env.example` listelenen 15 bayrağın **tamamını `in-memory`** olarak yolluyor.
- Sonuç: kalan **28 store** (oturum, denetim kaydı, duyuru, destek talebi dâhil)
  `prod:readiness:check`'ten geçse bile production'da **sessizce in-memory** çalışabilir.

### 3.2 Risk

- **Veri kaybı:** in-memory store'lar süreç restart'ında sıfırlanır.
- **Yatay ölçekleme bozuk:** her API replikası kendi belleğine yazar → tutarsız okuma, kayıp yazma.
- **Savunma derinliği düşer:** in-memory yolu RLS'i hiç çalıştırmaz; izolasyon yalnızca
  `filterTenantResources`'a kalır (tek katman). Denetim kaydının/oturumun in-memory olması
  ayrıca KVKK/forensic açısından sorunlu.
- **Footgun:** 33 bayrağın "güvenli" değeri `=postgres`; biri unutulursa sessizce yanlış moda düşer.

### 3.3 Tasarım

**Tek sürücü + güvenli default + boot-time fail-fast** ile 33 bayrak → 1.

```ts
// apps/api/src/config/persistence.ts (yeni)
export type PersistenceDriver = "postgres" | "memory";

export function resolvePersistenceDriver(env = process.env): PersistenceDriver {
  // Açık override > DATABASE_URL varlığı > production'da güvenli default
  if (env.PERSISTENCE_DRIVER === "memory") return "memory";
  if (env.PERSISTENCE_DRIVER === "postgres") return "postgres";
  if (env.NODE_ENV === "production") return "postgres";
  return env.DATABASE_URL ? "postgres" : "memory";
}
```

```ts
// Her fabrika tek kaynağa dayanır (eski per-store bayrağı yalnız test override olarak kalır):
export function createClassStore(env = process.env): ClassStore {
  return resolvePersistenceDriver(env) === "postgres"
    ? new PostgresClassStore()
    : new InMemoryClassStore();
}
```

**Boot guard (fail-fast):**
```ts
// apps/api/src/main.ts (bootstrap içinde)
if (process.env.NODE_ENV === "production" && resolvePersistenceDriver() !== "postgres") {
  throw new Error("PERSISTENCE_DRIVER must be 'postgres' in production");
}
```

**Tamamlayıcı değişiklikler:**
- `.env.example`: default `PERSISTENCE_DRIVER=postgres` + dev için `memory` notu; 15 eski bayrağı kaldır.
- `scripts/check-prod-env.mjs`: 5-bayrak kısmi kontrolünü tek `PERSISTENCE_DRIVER=postgres` doğrulamasıyla değiştir.
- `smoke-postgres-stores-live.mjs`: tek sürücüyle çalışacak şekilde güncelle.

**Geriye dönük uyum:** `resolvePersistenceDriver` önce açık `PERSISTENCE_DRIVER`'a bakar;
testlerdeki mevcut per-store env kullanımları override olarak korunabilir veya tek bayrağa taşınır.

**Maliyet/risk:** ~33 fabrika dosyasında küçük, mekanik değişiklik + 1 yeni helper + 2 script güncellemesi.
Davranış değişmez; yalnız default tersine döner ve yanlış yapılandırma erken patlar.

---

## 4. P2 — UI Paketi Yapısı (🟡 Önemli)

### 4.1 Bulgu (kanıt)

- `packages/ui/src/` tek dosya: **`index.ts`, 635 satır, 15 export** (Button, Input, Table,
  Dialog, Toast, DataTable, CrudPage, FormModal, 4 grafik bileşeni…).
- `tsconfig.json` yalnızca `"include": ["src/**/*.ts"]` → `.tsx` yok → tüm bileşenler
  `React.createElement` ile yazılmış (JSX yok).
- Hiçbir bileşende `"use client"` yok → tüketici sayfalar tümüyle client component olmak zorunda.
- Build `tsc -p` (watch/HMR yok) → her düzenlemeden sonra elle rebuild gerekiyor.

### 4.2 Tasarım

- `tsconfig.json`: `"jsx": "react-jsx"` ekle, `include`'a `src/**/*.tsx` ekle.
- 635 satırlık `index.ts`'i `src/components/*.tsx` dosyalarına böl, `index.ts` barrel olarak yeniden export etsin.
- Etkileşimli bileşenlere (`Dialog`, `Toast`, `CrudPage`, `FormModal`, grafikler) `"use client"` ekle;
  saf sunum bileşenleri (Button, Input, Table) RSC-uyumlu kalsın → sunucu bileşenlerinden de import edilebilir.
- (Opsiyonel) `tsup` ile build + `--watch`: "her düzenlemede rebuild" sürtünmesini kaldırır.

**Tradeoff:** JSX'e geçiş + dosya bölme tek seferlik diff üretir; ancak okunabilirlik,
granüler client/server sınırı ve watch derleme kazanılır. Davranış aynı kalır.

---

## 5. P3 — İkincil Gözlemler (🟢 Önerilen)

- **Client-component zorunluluğu:** UI'da `"use client"` olmadığından App Router'ın RSC/SSR
  kazanımı kısıtlı. P2'deki granüler sınırlar bunu da açar.
- **İnce web E2E kapsamı:** backend 78 + worker 27 teste karşılık web tarafında 3 E2E dosyası.
  Kritik akışlar (login, optik import→rapor, veli portalı) için Playwright senaryoları artırılabilir.
- **Store `update()` deseni:** önce `findById` sonra `UPDATE` (2 round-trip). Düşük öncelikli; tekil sorguya indirgenebilir.

---

## 6. Önerilen Sıra

1. **P1 hızlı kazanım** — `resolvePersistenceDriver` + boot guard + `.env.example`/`check-prod-env` güncellemesi.
   (Güvenliği en çok artıran, en düşük riskli adım.)
2. **P1 yaygınlaştırma** — 33 fabrikayı tek sürücüye taşı; `pnpm ci` ile doğrula.
3. **P2** — UI tsconfig JSX + bileşen bölme + `"use client"`.
4. **P3** — E2E senaryoları, RSC sınırları.

> Not: Bu doküman tasarım çıktısıdır. Uygulama için `/sc:implement` veya onayınızla doğrudan
> kodlama adımına geçilebilir. P1 hızlı kazanım, `pnpm typecheck && pnpm test` ile kapı kontrollü ilerler.
