# Faz E Sertleştirme Checklist'i

Bu dosya `MASTER_PLAN.md` §10.6 Faz E kapsamını güvenli sıraya koyar.

## Varsayımlar

- Vite prototipi söküldü; web için aktif build/dev/e2e kapıları Next App Router üzerinden çalışmalıdır.
- Kimlik-bağı davet/göç akışı dar kapsamta tamamlandı; gerçek üretim göçü için onay referansı ve kanıt raporu yine zorunludur.
- Foto upload AV işi dosya kabul yüzeyini büyütür; KVKK ve depolama kararıyla birlikte ele alınmalıdır.

## Durum Denetimi

| Parça | Mevcut durum | Sonraki kanıt |
|---|---|---|
| Vite artefakt sökümü | Tamamlandı: Vite config, eski Playwright e2e, Vite entry dosyaları ve `dist` çıktıları kaldırıldı; `build/dev/test:e2e` Next'e bağlı | `pnpm --filter @o-okul/web build`, `pnpm --filter @o-okul/web test:e2e` |
| Playwright e2e yeniden yazımı | Tamamlandı: Next e2e kurum CRUD, materyal/ödev, optik parser, rapor ayrıntı/export, destek bildirimi+ek+yorum, finans, rol önizleme, güvenlik denetimi, gözlemlenebilirlik, UAT/rollback, canlı yayın kanıtı, sistem sağlığı, yedek/restore kanıt ekranı, rol portalı ve single-flight refresh akışlarını doğruluyor | `pnpm --filter @o-okul/web test:e2e` |
| Kimlik-bağı envanter audit'i | Tamamlandı: audit RLS bypass ile tüm tenantları okur ve canlı DB'de `READY` döner | `pnpm identity-link:audit` |
| Kimlik-bağı davet/göç kanıt kapısı | Tamamlandı: karar referansı, role göre link/membership sayımı, davet akışı ve negatif erişim kanıtı JSON raporuyla doğrulanıyor | `pnpm identity-migration:check` |
| Kimlik-bağı davet/göç modeli | Tamamlandı: davet/aktivasyon API'si, kurum web ekranı ve idempotent `identity-link:migrate` script'i var; script onay env'i olmadan çalışmaz | `IDENTITY_LINK_MIGRATION_APPROVED=true pnpm identity-link:migrate`, onay sonrası `IDENTITY_MIGRATION_TARGET` gerçek raporu |
| RLS yük testi | Tamamlandı: geçici tenant verisiyle app role altında transaction başına tenant context kuran >200 rps smoke eklendi | `pnpm rls:load:smoke` |
| KVKK self-service ödeme koruma | Tamamlandı: hesap PII purge sonrası ödeme planı/taksit kayıtlarının korunması e2e ile kanıtlanıyor | `pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts` |
| KVKK finansal saklama kanıt kapısı | Tamamlandı: yasal saklama süresi, onay referansı, ödeme planı/taksit sayımı ve purge istisnası JSON kanıtıyla doğrulanıyor | `pnpm financial-retention:check` |
| KVKK finansal saklama süresi | Onay bekliyor: gerçek yasal saklama süresi ve purge istisnası ürün/ops tarafından doldurulmalı | Onay sonrası `FINANCIAL_RETENTION_TARGET` gerçek raporu |
| Foto/upload magic-byte | Tamamlandı: mevcut destek eki ve materyal dosyası upload yüzeyleri PDF/PNG/JPEG magic-byte ve text NUL kontrolü yapıyor | `pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts` |
| Foto/upload AV kanıt kapısı | Tamamlandı: scanner kararı, kapsanan upload yüzeyleri, fail-closed ve EICAR reddi JSON kanıtıyla doğrulanıyor | `pnpm upload-av:check` |
| Foto/upload AV sağlayıcısı | Onay bekliyor: AV sağlayıcı veya local scanning yaklaşımı seçilmeli | Onay sonrası `UPLOAD_AV_TARGET` gerçek raporu |

## Vite Söküm Risk Envanteri

| Vite bağı | Durum | Kanıt |
|---|---|---|
| `apps/web/e2e/single-flight-refresh.spec.ts` | Kaldırıldı; Next karşılığı `apps/web/e2e-next/single-flight-refresh-next.spec.ts` | `pnpm --filter @o-okul/web test:e2e` |
| `apps/web/e2e/login-dashboard.spec.ts` | Kaldırıldı; Next karşılığı kurum CRUD, materyal/ödev, optik parser, rapor export, destek eki/yorum, rol portalları ve KVKK akışlarını kapsıyor | `pnpm --filter @o-okul/web test:e2e` |
| `apps/web/src/main.tsx` | Kaldırıldı; aktif yüzey Next App Router altında | `pnpm --filter @o-okul/web build` |
| `apps/web/package.json` `build/dev/test:e2e` | Next komutlarına çevrildi | `pnpm --filter @o-okul/web build`, `pnpm --filter @o-okul/web test:e2e` |
| `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/playwright.config.ts` | Kaldırıldı | Vite dosya taraması |

## Bloklayıcı Onaylar

- Üretim kimlik göç raporu için ürün/ops onay referansı.
- Finansal kayıtların KVKK purge istisnası ve yasal saklama süresi.
- Foto upload AV sağlayıcısı veya local scanning yaklaşımı.

## Son Doğrulama

- `corepack pnpm --filter @o-okul/web build`
- `corepack pnpm --filter @o-okul/web test:e2e`
- `corepack pnpm test:e2e`
- `corepack pnpm typecheck`
- `node scripts/check-web-token-storage.mjs`
- `corepack pnpm db:migrate`
- `corepack pnpm db:rls:check`
- `corepack pnpm db:rls:check:live`
- `corepack pnpm identity-link:audit`
- `IDENTITY_MIGRATION_TARGET=file://$PWD/docs/evidence-templates/identity-migration.example.json corepack pnpm identity-migration:check`
- `corepack pnpm rls:load:smoke`
- `FINANCIAL_RETENTION_TARGET=file://$PWD/docs/evidence-templates/financial-retention.example.json corepack pnpm financial-retention:check`
- `UPLOAD_AV_TARGET=file://$PWD/docs/evidence-templates/upload-av.example.json corepack pnpm upload-av:check`
- `corepack pnpm --filter @o-okul/api exec vitest run src/payment/payment.e2e.test.ts`
- `corepack pnpm --filter @o-okul/api exec vitest run src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts`
- Vite dosya taraması: eski `apps/web/e2e`, `apps/web/dist`, `vite.config.ts`, `index.html`, `playwright.config.ts`, `src/main.tsx`, `src/styles.css` bulunmadı.
