# PO-2: Türkiye'de S3 uyumlu off-host yedek hedefi karşılaştırması

Erişim tarihi: 2026-10-10. Kaynak: yalnız resmi satıcı sayfaları. Kanıt sınıfı: EXTERNAL_NOT_RUN (sağlayıcılara hiç bağlanılmadı); repo taraması LOCAL_STATIC.
"Yazmıyor" = sayfada bilgi yok, yani UNVERIFIED.

## Tablo

| Kriter | Turkcell nDepo | Narbulut NOSS | FixCloud Veeam S3 | Dünyam (Hosting Dünyam) |
|---|---|---|---|---|
| Ürün var mı | Var | Var | Var, Veeam odaklı | **Bulunamadı.** Ürün menüsünde nesne depolama yok |
| S3 API | "AWS S3 API uyumlu" | "S3 protokolüyle tam uyumlu" | Yalnız "S3 Compatible" yazıyor; genel S3 istemcisi desteği belirtilmemiş | — |
| SigV4 / multipart | Yazmıyor | Yazmıyor | Yazmıyor | — |
| Path / virtual-host | **Yalnız path-style.** Virtual-hosted desteklenmiyor | Yazmıyor | Yazmıyor | — |
| Özel endpoint / region | Endpoint yayımlanmamış; region gerekiyorsa `us-east-1` öneriliyor | Yazmıyor | Yazmıyor | — |
| TR veri merkezi | Turkcell Gebze + Temelli; isteğe bağlı iki merkez arası replikasyon | İstanbul ana lokasyon; yedekler farklı lokasyonlarda | TT İstanbul (Tier III) + KKB Ankara (Tier IV); S3'ün hangisinde olduğu yazmıyor | — |
| Lifecycle / expiration | Yazmıyor ("arşivleme, yaşlandırma" deniyor ama S3 lifecycle kuralı değil) | Yazmıyor | Yazmıyor | — |
| Object lock / versioning | Yazmıyor. "Silinen verinin geri dönüşü yoktur" | Object lock var (süreli değiştirilemez/silinemez); versioning yazmıyor | Immutable var (Veeam v10 ile); versioning yazmıyor | — |
| Durağan şifreleme | Yazmıyor | Yazmıyor ("uçtan uca şifreleme" deniyor) | Yazmıyor (aktarımda AES-256 deniyor) | — |
| Fiyat | Yayımlanmamış. Pakete göre; teklif kurumsal temsilciden. Yalnız KDV, ÖİV yok | Hesaplayıcı örneği: **1.000 GB + 10 Mbps = 2.448 TL/ay** (KDV durumu yazmıyor). Hesaplayıcı en az 50 GB. GB başı birim fiyat yayımlanmamış | Yayımlanmamış | — |
| Egress / istek ücreti | Faturada kullanılan kapasite ve okuma var; birim fiyat yok | Bant limiti içinde istek/trafik ücreti yok; limit aşımı yazmıyor | Yazmıyor; istemci başına simetrik 100 Mbps | — |
| Asgari taahhüt | Yazmıyor; aylık yenileme; açılış 5-6 gün; abonelik temsilci üzerinden | Yazmıyor; 30 gün ücretsiz deneme | **En az 1 TB tahsis** | — |
| ISO 27001 | Yazmıyor | Sertifika sayfası linki var, standart adı yok (UNVERIFIED) | Sertifika sayfası linki var (UNVERIFIED) | "ISO Sertifikası" linki var, standart adı yok |
| KVKK | Docs: "KVKK uyumlu" | İngilizce sayfa PDPL/6698 sayılı kanuna atıf yapıyor | "KVKK'ya uygun" | — |

**Bulunamayanlar (UNVERIFIED, ürün yok varsayılmadı):**
- Türk Telekom: bireysel/dosya ürünleri var (BuluTT Depo, Dijital Depo), resmi bir S3 API ürünü bulunamadı.
- Radore: ana sayfada yedekleme ve bulut var, nesne depolama/S3 yok.
- Natro, Turhost, Vargonen, Bulutistan: aramada S3 ürün sayfası çıkmadı; siteleri doğrudan açılmadı.

**Kaynaklar:**
- https://docs.turkcellbulut.com/articles/ndepo/objectstorage.html
- https://www.turkcell.com.tr/kurumsal/dijital-is-servisleri/bulut-servisleri/turkcell-ndepo
- https://narbulut.com/en/narbulut-object-storage-service-noss-s3/
- https://narbulut.com/nesne-tabanli-depolama-s3/
- https://www.fixcloud.com.tr/en/cloud-services/cloud-backup-baas/veeam-s3-cloud-storage
- https://hostingdunyam.com.tr/
- https://www.radore.com/

## Repo: kodun bugün desteklediği env değişkenleri (LOCAL_STATIC)

- `BACKUP_OFFSITE_TARGET`: yalnız `file://` veya `s3://` kabul ediyor.
  - Kullanan dosyalar: `scripts/smoke-backup-offsite.mjs` ve `scripts/smoke-backup-offsite-restore.mjs`. Restore smoke ayrıca `BACKUP_OFFSITE_RESTORE_TARGET` okuyor.
  - S3 istemcisi için **ortak** `S3_ENDPOINT`, `S3_REGION` (varsayılan `us-east-1`), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` ve `S3_FORCE_PATH_STYLE` (`=== "true"`) okunuyor.
  - Ayrı bir önek yok, yani uygulamanın upload bucket'ıyla aynı kimlik bilgilerini kullanıyor.
- `TENANT_RESET_{SOURCE,BACKUP,RESTORE}_S3_{ENDPOINT,BUCKET,REGION,ACCESS_KEY_ID,SECRET_ACCESS_KEY}`: `packages/db/src/tenant-reset-objects.ts` içindeki `resetS3Config(prefix)` ile okunuyor. `resetS3Client` içinde **`forcePathStyle: true` sabit kodlu**, dolayısıyla hedef path-style desteklemek zorunda.
- `S3_ENDPOINT` prod'da HTTPS olmak zorunda; localhost, 127.0.0.1 ve minio reddediliyor (`scripts/check-prod-env.mjs:317-318`).
- `S3_FORCE_PATH_STYLE` şu dosyalarda da okunuyor: `smoke-wal-archive-target.mjs`, `audit-inline-upload-orphan-s3-live.mjs`, `migrate-inline-upload-content-to-s3-live.mjs`.
- Runbook'ta TENANT_RESET_BACKUP bucket'ı için versioning şartı var (`docs/phase-6-ops-runbook.md:2633`). Seçilen sağlayıcı versioning desteklemiyorsa bu kural çatışır.

## Öneri

1. **Birincil aday: Turkcell nDepo.** Resmi dokümanı path-style'ı açıkça yazan tek aday; bu, koddaki sabit `forcePathStyle: true` ile birebir uyumlu. TR'de iki veri merkezi var ve resmi "KVKK uyumlu" ifadesi bulunuyor.
2. **Yedek aday: Narbulut NOSS.** TL fiyatı yayımlayan tek aday (1 TB ≈ 2.448 TL/ay) ve object lock'u yazılı. 20 GB için 50 GB'lık alt kademe yeterli olur.
3. **Karar kriterleri:** path-style ve SigV4 uyumu, TR veri merkezinin sözleşmede yazılı olması, lifecycle expiration (30 gün) ve versioning/object lock desteği. Bu üçü hiçbir sağlayıcıda tam doğrulanamadı. FixCloud (1 TB asgari, Veeam odaklı) ve Dünyam (ürün yok) elendi.

## Seçimden sonra gereken adımlar

1. Sağlayıcıdan yazılı teyit isteyin:
   - SigV4, multipart, path-style
   - lifecycle expiration ve versioning/object lock
   - durağan şifreleme
   - ISO 27001 sertifika kapsamı
   - TR veri lokasyonu taahhüdü
   - GB/ay ve egress fiyatı
2. Ayrı bir bucket ve yalnız o bucket'a erişen ayrı bir anahtar açın; 30 günlük lifecycle kuralı tanımlayın. Bu sağlayıcı ve secret işlemi olduğu için kullanıcı onayı gerekiyor.
3. PO-2 kodunda off-host hedefe ayrı bir env öneki verin. Bugün `S3_*` uygulama bucket'ıyla paylaşılıyor. Örnek olarak mevcut `resetS3Config(prefix)` deseni yeniden kullanılabilir.
4. `BACKUP_OFFSITE_TARGET=s3://<bucket>/<prefix>` ve endpoint/path-style değerleriyle `smoke-backup-offsite` ve `smoke-backup-offsite-restore` çalıştırılıp kanıt toplanacak. Bu staging adımı da onay gerektiriyor.
5. DEC kaydı (`docs/DECISIONS.md` açık soru, satır ~1014) ve runbook'taki versioning şartı seçilen sağlayıcının yeteneklerine göre güncellenecek.
