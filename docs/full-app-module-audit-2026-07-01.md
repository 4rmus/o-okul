# O-Okul Tam Uygulama Modül Analizi

Tarih: 2026-07-01  
Kapsam: repo + yerel/static gates + GitHub/CI + canlı `o-okul.com` runtime  
Branch/SHA: `main` / `ce7a7788f151c9be80104b2dfcbf13c8b678d799`  
Durum: Kod düzeltmesi yapılmadı. Bu dosya rapor çıktısıdır.

## Kısa Sonuç

- P0 bulgu yok.
- Yerel/static ana kapıların çoğu geçti: typecheck, API test, web a11y, RLS, ops statik, OpenAPI contract.
- Canlı uygulama ayakta: `/health`, `/health/ready`, `/login` 200.
- Canlı image güncel main değil: çalışan `web/api/worker/queue-board` tag'i `5a00a3375715f6098e964be78f70999fc42fb2a0`; güncel `origin/main` `ce7a7788f151c9be80104b2dfcbf13c8b678d799`.
- GitHub CI `ce7a7788...` için analiz sırasında `in_progress`; bu SHA için staging deploy henüz yok.
- Remote release evidence bundle `NOT_RELEASE_EVIDENCE / BLOCKED`: rollback, admin MFA, security audit, UAT, observability, external monitoring, release summary ve diğer gerçek staging artefaktları eksik.
- En küçük güvenli ilk PR: auth/session güvenlik dilimi. `ADMIN_MFA_MODE=required` enforcement, access/session TTL, production secret fallback ve subject bağı olmayan portal rolünü birlikte testle kapat.

## İnceleme Yöntemi

Paralel read-only agent dalgaları kullanıldı:

- Dalga A: `product_scope_planner`, `tenant_security_reviewer`, `backend_api_engineer`, `frontend_ux_engineer`, `exam_reporting_engineer`, `data_platform_engineer`.
- Dalga B: `auth_session_engineer`, `privacy_governance_reviewer`, `ops_release_engineer`, `infra_dr_engineer`, `observability_sre_engineer`, `messaging_integrations_engineer`.

Ana doğrulama kaynakları:

- `AGENTS.md`
- `docs/codex-agent-architecture.md`
- `docs/product-journeys-v1.md`
- `docs/DECISIONS.md`
- `docs/phase-6-production-readiness.md`
- `apps/api/src/app.module.ts`
- `apps/web/app/(app)/_shared/navigation.ts`
- `packages/shared-types/src/role-capabilities.ts`
- `packages/db/prisma/schema.prisma`

## Modül Matrisi

| Modül | Amaç | Ana yüzeyler | Bağlı modüller | UAT/evidence durumu | Risk | En küçük düzeltme |
|---|---|---|---|---|---|---|
| Sistem yönetimi ve release kanıtı | Kurum, lisans, audit, observability, release durumu | `apps/web/app/(app)/sistem/**`, `apps/api/src/tenant`, `metrics`, `audit-log`, `operations`, `.github`, `scripts/check-*.mjs` | DB/RLS, auth, ops, observability | Repo statik PASS/PARTIAL; canlı release bundle BLOCKED | P1 evidence | Eksik gerçek staging artefaktlarını üret; current main deploy aktivasyonunu bekle |
| Kurum operasyon paneli | Kurulum, kişi/rol, dönem, program, devamsızlık | `apps/web/app/(app)/kurum/**`, `apps/api/src/school`, `student`, `program`, `attendance`, `user-management` | auth/RBAC, shared-types, DB stores | Kişi/program PASS; kurulum/davet PARTIAL | P2 | Route capability matrix ve form id/a11y netliği |
| Auth/session | TC/tenant login, refresh, MFA, rate limit, token storage | `apps/api/src/auth/**`, `apps/api/src/http/**`, `apps/web/src/api-client.ts` | user/session store, RBAC, tenant, web shell | API auth gate PASS; evidence target olmadan admin/rate checks BLOCKED | P1 | MFA required enforcement + TTL + production secret fail-closed + subject binding |
| DB/RLS/data platform | Tenant izolasyonu, Prisma, RLS, tenant FK, audit partition | `packages/db/**`, `apps/api/src/db/**`, `apps/worker/src/db/**` | API stores, worker adapters, ops evidence | `db:rls:check`, `tenant-db:check`, DB test PASS; live DB smoke koşulmadı | P2/evidence | `seed-exams.test.ts` CI kapsamına alınsın; live DB smoke ayrı kontrollü koşulsun |
| Optik sınav ve rapor/karne | TXT/DAT import, parser, quarantine, scoring, snapshot, PDF/Excel | `apps/api/src/exam/**`, `apps/api/src/report/**`, `apps/worker/src/jobs/**` | worker, DB, shared-types, UI charts | API test PASS; worker test FAIL; live exam artefaktı dış evidence | P1 | Report snapshot idempotency + quarantine enqueue atomikliği |
| Finans ve iletişim | Ödeme/taksit, duyuru, SMS, notification, destek | `apps/api/src/payment`, `announcement`, `sms-batch`, `support-ticket`, `packages/*adapter` | worker jobs, notification providers, privacy | Payment PASS; provider smoke gerçek env olmadan BLOCKED | P1 | Provider side-effect idempotency; gerçek/noop smoke ayrımı |
| Öğretmen portalı | Öğretmen kendi sınıf/öğrenci kapsamında işlem yapar | `apps/web/app/(app)/ogretmen/**`, `apps/api/src/me`, `attendance`, `teacher-note` | auth subject, RBAC, school assignments | UAT PASS görünüyor; subject bağı kopuk rol için risk | P1 | Subject resolve edilemeyen TEACHER/STUDENT/GUARDIAN login/request fail-closed |
| Öğrenci portalı | Öğrenci kendi profil/ödev/devamsızlık/raporunu görür | `apps/web/app/(app)/ogrenci/**`, `apps/api/src/me` | auth subject, report, homework, support | UAT PASS | P1 ile ilişkili | Subject binding fail-closed aynı PR'da kapsansın |
| Veli portalı | Veli bağlı öğrenci ve izinli finans/rapor verisini görür | `apps/web/app/(app)/veli/**`, `apps/api/src/me`, `payment`, `announcement` | guardian-student, payment, privacy | UAT PASS | P1 ile ilişkili | Subject binding fail-closed aynı PR'da kapsansın |
| KVKK/PII/upload | Envanter, retention, audit redaction, AV, upload storage | `apps/api/src/privacy`, `audit-log`, `support-ticket`, `homework`, `upload` | DB, S3/MinIO, evidence templates | Redaction iyi; KVKK target olmadan check BLOCKED | P1/P2 | KVKK inventory endpoint/checker/shared-type hizalansın |
| Observability/SRE | Metrics, logs, Sentry, dashboards, alerting | `apps/api/src/metrics`, `observability`, `docker/prometheus`, `docker/grafana` | ops evidence, alert provider, privacy | Ops statik PASS; observability target yok | P1 | Alert isim drift'i ve metrics path label düzeltmesi |
| Infra/DR | Docker/Traefik, backup, WAL, rollback, queue-board | `docker-compose*.yml`, `scripts/smoke-backup-*`, rollback/region checkers | DB, object storage, release evidence | Docker statik PASS; WAL/backup/rollback targets yok | P1/P2 | WAL/backup gerçekliği ve queue-board rollback kapsamı |
| Queue-board/hooks-worker | Queue görünürlüğü ve hook yüzeyi | `apps/queue-board`, `apps/hooks-worker` | Redis/BullMQ, infra auth | Queue-board local loopback/basic-auth iyi | P2 | Rollback evidence queue-board'u da kapsasın |

## P1 Bulgular

1. Admin MFA `required` mod runtime'da TOTP'siz admin'i durdurmuyor.  
   Kanıt: `apps/api/src/auth/auth.service.ts:558`, `apps/api/src/auth/totp-mfa.ts:45`. `resolveAdminMfaMode()` `required` dönebilir, ama login challenge yalnız admin rolü + kayıtlı TOTP varsa dönüyor. `SYSTEM_ADMIN`/`TENANT_ADMIN` TOTP kaydı yoksa password-only token alabilir.

2. Access token ve refresh session zaman bazlı expire olmuyor.  
   Kanıt: `apps/api/src/auth/token-service.ts:4`, `apps/api/src/auth/token-service.ts:107`, `apps/api/src/auth/session-store.ts:7`, `apps/api/src/auth/auth.controller.ts:75`. Payload'da `exp/iat`, session'da `expiresAt`, cookie'de `maxAge/expires` yok.

3. Production JWT/selection secret guard kod içinde fail-closed değil.  
   Kanıt: `apps/api/src/auth/auth.service.ts:101`, `apps/api/src/auth/auth.service.ts:659`. Secret yoksa `test-access-secret` fallback'i kullanılabiliyor. `prod:env:check` bunu yakalıyor, ama runtime constructor seviyesinde production guard yok.

4. Subject bağı kopmuş TEACHER rolü tenant içi geniş okuma yapabilir.  
   Kanıt: `apps/api/src/auth/identity-resolver.ts:30`, `apps/api/src/auth/auth.service.ts:310`, `apps/api/src/attendance/attendance.service.ts:275`, `apps/api/src/teacher-note/teacher-note.service.ts:296`. `subjectId` yoksa teacher scope filtreleri devreye girmeyip tüm tenant kayıtlarını döndürebilir.

5. Report generation worker retry-safe değil.  
   Kanıt: `apps/worker/src/jobs/report-generation-job.ts:231`, `apps/worker/src/jobs/postgres-report-generation-adapter.ts:120`. Başarılı snapshot insert sonrası worker retry aynı input için ikinci `READY` snapshot üretebilir.

6. Quarantine resolve ile evaluation enqueue atomik değil.  
   Kanıt: `apps/api/src/exam/raw-import-quarantine-store.ts:77`, `apps/api/src/exam/raw-import-quarantine.service.ts:87`. Kayıt önce `RESOLVED` olur, enqueue hata verirse retry `OPEN` kayıt bulamaz.

7. Worker test gate kırmızı.  
   Komut: `pnpm --filter @o-okul/worker test`.  
   Hata: `backup-restore-job.test.ts` beklenen `BACKUP_RESTORE_EVIDENCE_FILE_TEMP_PATH_DISALLOWED` yerine `BACKUP_RESTORE_EVIDENCE_FILE_PARENT_SYMLINK_DISALLOWED` alıyor. Bu local worker gate'i şu an kırmızı yapıyor.

8. KVKK envanteri gerçek PII alanlarıyla drift etmiş.  
   Kanıt: `apps/api/src/privacy/privacy.controller.ts:46`, `scripts/check-kvkk-inventory-evidence.mjs:21`, `packages/shared-types/src/domain.ts:258`. Endpoint, checker ve shared type aynı PII kategorilerini saymıyor.

9. SMS worker retry gerçek SMS'i tekrar gönderebilir.  
   Kanıt: `apps/api/src/queue/job-producer.ts:117`, `apps/worker/src/jobs/sms-batch-job.ts:61`. BullMQ retry provider side-effect'i idempotent yapmıyor.

10. Announcement external delivery provider çağrısı opsiyonel idempotency ile korunuyor.  
    Kanıt: `apps/api/src/announcement/announcement.service.ts:163`, `apps/api/src/announcement/announcement.service.ts:192`. `Idempotency-Key` yoksa client retry gerçek EMAIL/PUSH tekrarına yol açabilir.

11. Observability UAT alert isimleri gerçek Prometheus rule isimleriyle uyuşmuyor.  
    Kanıt: `scripts/check-observability-uat-evidence.mjs:27`, `docker/prometheus/rules/api-alerts.yml:13`. Script `OOkulHigh5xxRate` / `OOkulSlowRequests`, Prometheus `OOkulApiHighErrorRate` / `OOkulApiSlowRequests` bekliyor.

12. Metrics path label gerçek request path'inden geliyor.  
    Kanıt: `apps/api/src/metrics/metrics.middleware.ts:13`, `apps/api/src/metrics/metrics.service.ts:90`. Sadece UUID/sayısal segment normalize ediliyor; slug, e-posta benzeri segmentler path label'a sızabilir veya cardinality artırabilir.

13. WAL kanıtı gerçek Postgres WAL arşivini kanıtlamıyor.  
    Kanıt: `docker-compose.yml:241`, `scripts/smoke-wal-archive-target.mjs:27`. Compose'da `archive_mode/archive_command` yok; smoke sadece marker yazıp okuyor.

14. Off-host backup ve restore zinciri uçtan uca bağlı değil.  
    Kanıt: `scripts/smoke-backup-offsite.mjs:27`, `scripts/smoke-backup-restore-live.mjs:26`. Offsite marker ve local dump/restore ayrı kanıtlar; "off-host backup restore edildi" kanıtı çıkmıyor.

15. Güncel main canlıda aktive değil.  
    Kanıt: local/origin `ce7a7788...`; canlı image tag `5a00a337...`; CI run `28542234178` analiz sırasında `in_progress`; bu SHA için staging deploy yok.

16. Remote release evidence bundle gerçek release kanıtı değil.  
    Komut: `pnpm staging:remote-release-gaps:summary -- --host o-okul-prod`.  
    Sonuç: `NOT_RELEASE_EVIDENCE / BLOCKED`; 9 required report eksik ve release summary yok.

## P2 ve Evidence Gap Bulguları

- `/kurum/canli-yayin` etiketi canlı sınav izleme gibi okunabilir; v1'de canlı sınav/online deneme kapsam dışı. Rapor/route dili netleşmeli.
- Operasyon/evidence ekranları `system:operations` capability ile açılıyor; TENANT_ADMIN tarafındaki niyet açık helper/spec ile sabitlenmeli.
- `packages/ui/src/components/form-modal.tsx` sabit `id="uh-form-modal-form"` kullanıyor; çoklu modal durumunda submit/a11y ilişkisi karışabilir.
- Raw import parse job hash'i rastgele UUID içeriyor; tekrar upload queue kanıtını kirletebilir.
- Cross-exam progress contract `netDelta` odaklı; başarı yüzdesi ana metrik kararıyla daha iyi hizalanmalı.
- `packages/db/prisma/seed-exams.test.ts`, `@o-okul/db test` içinde otomatik koşmuyor.
- Support/homework S3 object key hash-only; tenant bazlı purge/legal hold kanıtı zayıf.
- Support ticket, homework ve upload kayıtları için açık retention/purge kanıtı yok.
- Rollback checker/generator `queue-board` servisini kapsamıyor.
- MinIO image `latest`; release tekrar üretilebilirliği zayıf.
- Refresh/logout body'den `refreshToken` kabul ediyor; web kullanmıyor ama HttpOnly-cookie-only stratejisini gevşetiyor.
- `JWT_REFRESH_SECRET` prod evidence içinde zorunlu ama refresh token runtime opaque random token + hash; sözleşme/kod niyeti ayrışıyor.
- Rate-limit evidence `emailHash` adını bekliyor; runtime TC/nationalId hash ekseninde.
- `notification:smoke` noop modda `gaps: []` üretebiliyor; gerçek provider kanıtı olmadığı şemada daha açık taşınmalı.
- UAT-KURUM-08 örnek metni disabled SMS kanıtını gerçek SMS smoke gibi okunabilir yapıyor.
- `staging:remote-release-gaps:summary` default host eski alias'a düşüyor; bu ortamda doğru host `o-okul-prod`.

## Yerel ve Static Gate Sonuçları

PASS:

- `pnpm agents:check`
- `pnpm prod:plan:check`
- `pnpm prod:evidence:templates:check`
- `pnpm live:status:check` (target'sız statik; final dış kanıt değil)
- `pnpm web:token-storage:check`
- `pnpm db:rls:check`
- `pnpm tenant-db:check`
- `pnpm karne:visual-contract:check`
- `pnpm --filter @o-okul/web typecheck`
- `pnpm web:a11y:check`
- `pnpm web:ux-baseline:check`
- `pnpm --filter @o-okul/api test`
- `pnpm typecheck`
- `pnpm openapi:output-contract`
- `pnpm product-journeys:check`
- `pnpm ops:check`
- `pnpm openapi:generate` (ignored `artifacts/openapi.json`, tracked diff yok)
- `pnpm --filter @o-okul/db test`
- `pnpm audit-log-partition:check`
- `pnpm --filter @o-okul/db exec vitest run prisma/seed-exams.test.ts`
- `pnpm --filter @o-okul/api exec vitest run src/auth src/security src/http src/rate-limit`
- `pnpm docker:check`
- `pnpm sms:smoke` (`SMS_ENABLED=false`, kapsam dışı/disabled path)

FAIL / BLOCKED / ENV eksik:

- `pnpm --filter @o-okul/worker test`: 1 test fail, 165 pass.
- `pnpm prod:env:check`: gerçek production env yüklenmediği için beklenen şekilde çoklu zorunlu env hatası.
- `pnpm admin-mfa:check`: `ADMIN_MFA_EVIDENCE_TARGET` yok.
- `pnpm rate-limit:check`: `RATE_LIMIT_EVIDENCE_TARGET` yok.
- `pnpm notification:smoke`: `NOTIFICATION_SMOKE_EMAIL_TO` veya `NOTIFICATION_SMOKE_PUSH_TO` yok.
- `pnpm upload-av:check`: `UPLOAD_AV_TARGET` yok.
- `pnpm privacy:inventory:check`: `KVKK_INVENTORY_TARGET` yok.
- `pnpm security:audit:check`: `SECURITY_AUDIT_TARGET` yok.
- `pnpm wal:archive:smoke`: `WAL_ARCHIVE_TARGET` yok.
- `pnpm backup:offsite:smoke`: `BACKUP_OFFSITE_TARGET` yok.
- `pnpm deployment:rollback:check`: `DEPLOYMENT_ROLLBACK_TARGET` yok.
- `pnpm observability:uat:check`: `OBSERVABILITY_UAT_TARGET` yok.
- `pnpm staging:remote-release-gaps:summary -- --host o-okul-prod`: expected BLOCKED, release evidence eksik.

## Canlı Runtime ve GitHub Kanıtı

GitHub:

- `origin/main`: `ce7a7788f151c9be80104b2dfcbf13c8b678d799`
- Açık PR: yok.
- CI run `28542234178`: analiz sırasında `in_progress`, `pnpm run ci` adımında.
- Son başarılı staging deploy run `28539607939`: `5a00a3375715f6098e964be78f70999fc42fb2a0`.

Canlı HTTP:

- `https://o-okul.com/health`: `200`, body `{"status":"ok"}`
- `https://o-okul.com/health/ready`: `200`, body `{"status":"ready","dependencies":{"postgres":"ok","redis":"ok"}}`
- `https://o-okul.com/login`: `200`

Canlı Docker image truth (`o-okul-prod`):

- `web`: `ghcr.io/4rmus/o-okul/web:5a00a3375715f6098e964be78f70999fc42fb2a0`, running/healthy
- `api`: `ghcr.io/4rmus/o-okul/api:5a00a3375715f6098e964be78f70999fc42fb2a0`, running/healthy
- `worker`: `ghcr.io/4rmus/o-okul/worker:5a00a3375715f6098e964be78f70999fc42fb2a0`, running
- `queue-board`: `ghcr.io/4rmus/o-okul/queue-board:5a00a3375715f6098e964be78f70999fc42fb2a0`, running/healthy

Karar: canlı sistem ayakta, ama güncel main canlıda aktive değil. Health 200, SHA/image parity yerine geçmez.

## Önerilen İlk PR

İlk PR auth/session güvenlik dilimi olmalı:

1. `ADMIN_MFA_MODE=required` iken admin rolü TOTP enrollment yoksa login fail-closed olsun.
2. Access token ve session TTL eklensin; expired token/request testleri yazılsın.
3. Production'da `JWT_ACCESS_SECRET` / selection secret fallback'i fail-closed olsun.
4. TEACHER/STUDENT/GUARDIAN subject resolve edilemiyorsa token üretimi veya request access fail-closed olsun.
5. Hedefli testler: `auth.service.test.ts`, `token-service.test.ts`, `attendance.e2e/test`, `teacher-note.e2e/test`, `prod:env:check` sözleşmesi.

Bu PR, P1 güvenlik risklerinin en yüksek etkili ve en dar kök nedenli kümesini kapatır. Sonraki küçük PR'lar:

- Report snapshot idempotency + quarantine enqueue atomikliği.
- Provider side-effect idempotency ve gerçek/noop evidence ayrımı.
- KVKK inventory drift.
- Observability alert names + metric path template.
- WAL/off-host backup/rollback evidence gerçekliği.

