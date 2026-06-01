# Faz 6 Operasyon Runbook'u

Bu runbook production'a geçmeden önce yedek, restore ve PITR davranışını kanıtlamak için tutulur.

## Lokal Backup/Restore Smoke

Amaç: canlı geliştirme DB'sinden dump alınabildiğini ve dump'ın temiz bir geçici veritabanına geri
yüklenebildiğini kanıtlamak.

Komut:

```sh
pnpm backup:restore:smoke
```

Beklenen sonuç:

- `pg_dump` Postgres container içinde custom-format dump üretir.
- Geçici `uzman_hocam_restore_smoke_*` veritabanı oluşturulur.
- `pg_restore` dump'ı geçici veritabanına yükler.
- `Tenant`, `AuditLog`, `ReportSnapshot` ve `_prisma_migrations` tabloları restore edilen DB'de
  okunur.
- Geçici DB ve dump dosyası temizlenir.

Bu smoke production restore garantisi değildir; repo içi minimum geri yükleme kanıtıdır.

## Off-host Backup Hedef Smoke

Amaç: `BACKUP_OFFSITE_TARGET` hedefinin yalnız yazılı değil, gerçekten yaz/oku/sil döngüsünü
tamamladığını kanıtlamak.

Komut:

```sh
pnpm backup:offsite:smoke
```

Desteklenen hedefler:

- `file:///...`: lokal veya mount edilmiş off-host path'e test dosyası yazar, hash doğrular ve siler.
- `s3://bucket/prefix`: S3 uyumlu hedefe test nesnesi yazar, geri okur, hash doğrular ve siler.

S3 hedefi için `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` ve gerekirse
`S3_FORCE_PATH_STYLE=true` staging/prod env içinde ayarlanır.

## WAL Archive Hedef Smoke

Amaç: `WAL_ARCHIVE_TARGET` hedefinin WAL arşiv dosyalarını alabilecek şekilde yaz/oku/sil
döngüsünü tamamladığını kanıtlamak.

Komut:

```sh
pnpm wal:archive:smoke
```

Desteklenen hedefler `BACKUP_OFFSITE_TARGET` ile aynıdır: `file:///...` veya `s3://bucket/prefix`.
Bu smoke Postgres'in gerçek WAL üretimini test etmez; arşiv hedefinin erişilebilirliğini kanıtlar.

## Production PITR Sözleşmesi

Production Postgres yapılandırması:

```conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /backup/wal/%f && cp %p /backup/wal/%f'
archive_timeout = 60s
```

Zorunlu operasyon sözleşmesi:

- Günlük base backup alınır ve immutable/off-host hedefte saklanır.
- WAL arşivi base backup hedefinden ayrı path veya bucket altında tutulur.
- En az haftada bir restore denemesi yapılır.
- Restore denemesi `Tenant`, `AuditLog`, `ReportSnapshot` ve son migration varlığını doğrular.
- Restore raporu tarih, kaynak backup, hedef DB, doğrulanan tablo sayımları ve hata yoksa `PASS`
  sonucu içerir.
- Restore raporu `RESTORE_DRILL_TARGET` altında saklanır ve `pnpm restore:drill:check` ile
  doğrulanır.

Restore denemesi örnek akış:

```sh
createdb uzman_hocam_restore_YYYYMMDD
pg_restore --no-owner --no-privileges -d uzman_hocam_restore_YYYYMMDD backup.dump
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "Tenant";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "AuditLog";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "ReportSnapshot";'
psql uzman_hocam_restore_YYYYMMDD -c 'select count(*) from "_prisma_migrations";'
dropdb uzman_hocam_restore_YYYYMMDD
```

Restore raporu örnek sözleşmesi:

```json
{
  "result": "PASS",
  "environment": "staging",
  "drillDate": "2026-05-30",
  "sourceBackup": "s3://backup-bucket/base/2026-05-30.dump",
  "targetDatabase": "uzman_hocam_restore_20260530",
  "tableCounts": {
    "Tenant": 5,
    "AuditLog": 0,
    "ReportSnapshot": 7,
    "_prisma_migrations": 13
  },
  "errors": []
}
```

Kanıt kontrol komutu:

```sh
pnpm restore:drill:check
```

PITR kabul kriteri: seçilen zamana restore edilen DB'de son başarılı migration kaydı, tenant izolasyon
policy'leri ve kritik tablolar okunabilir olmalıdır.
