# Landing ürün görselleri — yerel üretim hattı

Kapsam: DEC-20261102-08 yedinci madde. Bu dalgada yalnız üretim hattı kurulur: kurgusal `sentetik-v1`
verisi yerel kurulumda gerçek akıştan geçirilir ve kabul edilen ekranlar çekilir. Görseller
`apps/web/public`'e girmez ve depoya işlenmez. Yayın; staging UAT, insan PII incelemesi ve ürün sahibinin
ayrı onayından sonra, ayrı bir değişiklikle yapılır.

Komut: `pnpm landing:screens` (`node scripts/landing-screens.mjs`). Saf kurallar
`scripts/landing-screens-contract.mjs` içindedir; `scripts/landing-screens-contract.test.mjs` bunları
`pnpm ops:check` içinde sınar.

## Çekilen ekranlar

| Kimlik | Rol | Rota | Not |
| --- | --- | --- | --- |
| `admin-student-360` | Kurum sahibi | `/kurum/ogrenciler/<id>` | Öğrenci 360 genel bakış |
| `teacher-today` | Öğretmen | `/ogretmen` | "Bugün" özeti ve bugünkü dersler |
| `teacher-roll-call` | Öğretmen | `/ogretmen/ders-akisi?classId=…&date=<bugün>` | Yoklama paneli çerçevenin üstüne kaydırılır |
| `teacher-grade-grid` | Öğretmen | `/ogretmen/not-defteri` | Kaydedilmiş taslak değerlendirmenin not tablosu |
| `student-gelisimim` | Öğrenci | `/ogrenci` | "Gelişimim" paneli çerçevenin üstüne kaydırılır |

Veli portalı ve finans ekranı çekilmez; manifest `/veli`, `/kurum/veliler` ve `/kurum/finans` rotalarını
reddeder. Her ekran açık temada (`colorScheme: light`, `o-okul-theme=light`), `tr-TR` ve Europe/Istanbul
saatiyle üç boyutta çekilir: `desktop-1440` (1440×900), `tablet-834` (834×1112), `mobile-390` (390×844).
Çerçeve görünen alandır (tam sayfa değil); imleç çerçeve dışında tutulur.

## Önkoşullar

1. Node >= 22, `pnpm install --frozen-lockfile`. Playwright Chromium, web paketinin mevcut
   `@playwright/test` bağımlılığından gelir; yeni paket gerekmez.
2. Tek kullanımlık yerel Postgres veritabanı. Adı `o_okul_` ile başlamalı ve `_landing` veya `_test` ile
   bitmelidir (ör. `o_okul_landing`, `o_okul_shots_test`); `o_okul` ve yerel olmayan her adres reddedilir.
   Roller (`app`, `migration`, `secret_delivery_worker`), `pg_trgm` ve `btree_gist` eklentileri ile
   `docker/postgres/init/005_*.sh` ve `006_*.sh` SQL'i uygulanmış, ardından
   `pnpm --filter @o-okul/db exec prisma migrate deploy --config prisma.config.ts` çalıştırılmış olmalıdır.
   Hat her koşuda rastgele adlı yeni bir kurum açar; aynı veritabanı tekrar kullanılabilir.
3. Derlemeler: `apps/api/dist`, web için `apps/web/.next` (üretim derlemesi). `--build` bayrağı API'yi ve
   bağımlı paketleri, `@o-okul/ui`'yi ve web'i (`next:build`) derler; `--with-exams` ile worker'ı da.
4. `ornek-veriler/` gitignore'dadır. Ana çalışma kopyasında `ornek-veriler/sentetik-v1` kullanılır; başka
   bir worktree'den çalışırken `LANDING_SCREENS_DATASET_DIR` o klasörü göstermelidir. Okunan her dosya
   veri setinin `manifest.json` SHA-256 değeriyle karşılaştırılır; uyuşmazlıkta hat başlamadan durur.

### İsteğe bağlı: yerel Redis ve MinIO

`PERSISTENCE_DRIVER=postgres` ile API, not yayımlarken veli bildirim işini kuyruğa yazar. Redis yoksa bu
yazma geri dönmez; bu yüzden `LANDING_SCREENS_REDIS_URL` verilmezse notlar taslak kalır, yayımlama atlanır ve
manifestte `GRADE_PUBLISH_NOT_RUN` boşluğu yazılır (Gelişimim okul notu serisi boş görünür).

`--with-exams` sınav hattını (ham içe aktarma → excel-import/değerlendirme/rapor worker'ları → READY
ReportSnapshot → sınav yayını) çalıştırır; yerel Redis ve S3 uyumlu depo (MinIO) ister. İkisi de yalnız bu
koşu için açılmış, yerel adreste dinleyen, başka projeyle paylaşılmayan örnekler olmalıdır; erişim bilgileri
bu koşu için üretilmiş yerel test değerleridir, staging veya üretim sırrı kullanılmaz. Örnek (operatör
çalıştırır, `docker-compose.yml` içindeki imaj sürümleriyle):

```sh
docker run --rm -d --name o-okul-landing-redis -p 127.0.0.1:16379:6379 redis:7-alpine --save "" --appendonly no
docker run --rm -d --name o-okul-landing-minio -p 127.0.0.1:19000:9000 \
  -e MINIO_ROOT_USER="$LANDING_SCREENS_S3_ACCESS_KEY_ID" -e MINIO_ROOT_PASSWORD="$LANDING_SCREENS_S3_SECRET_ACCESS_KEY" \
  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
```

Kuyruk işleri koşuya özel `QUEUE_PREFIX` (`landing-screens-<runId>`) altına yazılır. Duyuru, SMS ve gizli
teslim worker'ları hiç başlatılmaz; kurumun veli otomatik bildirim anahtarları kapalı açılır.

## Çalıştırma

```sh
LANDING_SCREENS_DATABASE_URL=postgresql://app:app@127.0.0.1:55432/o_okul_landing_test \
LANDING_SCREENS_DIRECT_DATABASE_URL=postgresql://migration:migration@127.0.0.1:55432/o_okul_landing_test \
LANDING_SCREENS_API_PORT=3196 LANDING_SCREENS_WEB_PORT=43196 \
pnpm landing:screens --build
```

Bayraklar doğrudan betik adından sonra yazılır (`pnpm landing:screens --build --with-exams`). pnpm 11, betik
adından sonra yazılan `--` ayracını betiğe olduğu gibi geçirir (eski sürüm hat burada
`ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` ile duruyordu); hat artık baştaki tek `--` ayracını yok sayar, ama
belgelenen biçim ayraçsızdır.

| Değişken | Zorunlu | Anlam |
| --- | --- | --- |
| `LANDING_SCREENS_DATABASE_URL` | Evet | `app` rolü; yerel, tek kullanımlık veritabanı |
| `LANDING_SCREENS_DIRECT_DATABASE_URL` | Evet | `migration` rolü; aynı veritabanı |
| `LANDING_SCREENS_API_PORT` | Hayır | API portu (varsayılan 3100) |
| `LANDING_SCREENS_WEB_PORT` | Hayır | Tarayıcının açtığı port (varsayılan 43181); `next start` bir sonraki portta dinler |
| `LANDING_SCREENS_DATASET_DIR` | Hayır | `sentetik-v1` klasörü |
| `LANDING_SCREENS_OUTPUT_DIR` / `--out` | Hayır | Çıktı kökü; depo içindeyse `artifacts/` altında olmalı, `apps/web/public` reddedilir |
| `LANDING_SCREENS_REDIS_URL` | Hayır | Yerel Redis; not yayımlama ve `--with-exams` için |
| `LANDING_SCREENS_S3_ENDPOINT`, `_S3_ACCESS_KEY_ID`, `_S3_SECRET_ACCESS_KEY`, `_S3_BUCKET`, `_S3_REGION` | `--with-exams` ile | Yerel MinIO |

Bayraklar: `--build`, `--with-exams`, `--skip-capture` (yalnız veri yükler), `--out <dizin>`, `--help`.

Koruyucular: operatör kabuğunda `SMS_PROVIDER`, `NETGSM_*`, `NOTIFICATION_*` doluysa, `SMS_ENABLED` açıksa
veya `NODE_ENV` `production`/`staging` ise hat başlamadan durur. Alt süreçlere yalnız açıkça seçilen ortam
geçer (`SMS_ENABLED=false`, `ADMIN_MFA_MODE=off`, `TZ=UTC`); kabuktaki sağlayıcı bilgisi onlara ulaşmaz. Tüm
adresler loopback olmalıdır; staging veya uzak sunucuya çağrı yapılmaz.

## Hat ne yapar

1. Kurum, lisans dönemi ve ilk kurum sahibi doğrudan veritabanına yazılır (sistem admin adımı; veli otomatik
   bildirimleri kapalı). Parolalar her koşuda rastgele üretilir, yalnız süreç belleğinde kalır.
2. API (`PERSISTENCE_DRIVER=postgres`, `DOMAIN=localhost`) başlar; kampüs, akademik yıl ve iki dönem,
   8. sınıf seviyesi, 8-A/8-B, altı ders, öğretmen ve öğrenci aktarımı (önce dry-run) kurulum ve aktarım
   ekranlarının kullandığı HTTP uçlarıyla yapılır.
3. Öğretmen atamaları, bugünün üç dersi, son sekiz okul gününün yoklaması, üç yayımlanmış (Redis varsa) ve bir
   taslak not değerlendirmesi, bir gelişim değerlendirmesi ve bir öğretmen notu aynı uçlarla girilir.
4. Öne çıkan öğretmen ve öğrenci için giriş hesabı davet teslimi olmadan bağlanır (SMS/e-posta kapalı).
5. `--with-exams` ile üç sentetik LGS sınavı gerçek ham içe aktarma ve worker yolundan geçer; satır sayıları
   `beklenen-sonuclar.json` ile denetlenir. Sınavlar sınav formunun gönderdiği resmî puanlama kimliğiyle
   açılır (`examType: LGS`, `examYear: 2026`, `scoringProfileId: TR-LGS-2026-NOSD-V1`, yanlış cezası 1/3);
   veri setinin `wrongPenalty` değeri farklıysa hat `LANDING_SCREENS_WRONG_PENALTY_MISMATCH` ile durur.
   `classIds` ile oluşturulan sınav 8-A/8-B öğrencilerini zaten katılımcı yapar; optik eşleştirme öğrenci
   numarasını okuduğu için bu kayıtlar olduğu gibi eşleşir. Hat yalnız sınıf dışında kalan optik satırların
   öğrencisini `POST /exams/:id/participants` ile ekler; sınıftan gelen bir öğrenci yeniden eklenmez
   (`EXAM_PARTICIPANT_EXISTS` oluşmaz).
6. `next start` ve önünde üretimdeki kenar yönlendiricinin yerini tutan yerel bir vekil (`/api`, `/health` →
   API; diğer her şey → web) açılır. Tarayıcı `<kurum>.localhost` adresinden gerçek giriş formuyla girer.

Gerçek akış dışındaki doğrudan veritabanı adımları manifestte `adjustments` altında listelenir: kurum
açılışı, kayıt başlangıcının aktif dönem başına çekilmesi (geçmiş yoklama ve notların girilebilmesi için) ve
portal hesabı bağlama.

## Çıktı

`artifacts/landing-screens/<runId>/` (gitignore'daki `artifacts/` altında):

- `<ekran>--<boyut>.png`: 15 PNG (5 ekran × 3 boyut). WebP dönüşümü yayın adımına bırakılır.
- `manifest.json`: koşu durumu (`status: COMPLETED` veya `FAILED`; `FAILED` için `failure` alanında yalnız
  `LANDING_SCREENS_*` ile başlayan hata kodu; başka bir hata metni `LANDING_SCREENS_UNKNOWN_FAILURE` olarak
  yazılır), veri seti kimliği ve dosya SHA-256'ları, commit SHA ve kirli dosya sayısı, çekim zamanı
  (koşuda doldurulur), araç sürümleri (Node, Playwright, Chromium), her ekranın rotası, boyutu, dosyası,
  bayt ve SHA-256 değeri, ekrandaki uyarılar, `gaps` ve `adjustments`, `evidenceClass: LOCAL_TEST`,
  `review.status: PENDING_HUMAN_PII_REVIEW`, `publication.status: NOT_APPROVED`.
- `logs/api.log`, `logs/web.log`, `logs/run.log`: yalnız yerel inceleme için; istek gövdesi yazılmaz.
  `run.log` koşuyu durduran hatanın tam metnini ve yığınını taşır; manifest'e yalnız kod geçer.

Koşu yarıda durursa (API hatası, zaman aşımı, eksik derleme) yığın kapatıldıktan sonra kısmi bir
`manifest.json` yine yazılır: `status: FAILED`, `failure` (ör.
`LANDING_SCREENS_API_FAILED:POST /exams:400:SCORING_PROFILE_REQUIRED`; sürücü, ağ veya çalışma zamanı
hatası gibi `LANDING_SCREENS_*` olmayan iletiler `LANDING_SCREENS_UNKNOWN_FAILURE` olarak yazılır, ayrıntı
`logs/run.log` dosyasındadır), boş `screens` ve o ana kadar
biriken `gaps` ile `adjustments`. Yakalama sırasında ekran düşerse manifest ekran listesiyle birlikte
`status: FAILED` ve `failure: LANDING_SCREENS_CAPTURE_FAILED:<sayı>` taşır. Veri seti doğrulaması gibi çıktı
dizini açılmadan önceki hatalarda manifest yazılmaz.

Görseller ve manifest depoya işlenmez.

## Bilinen boşluklar

- `sentetik-v1` öğretmen dosyasında T.C. ve telefon birlikte değil; bugünkü aktarım sözleşmesi ikisini birlikte
  ister. Hat bu durumda öğretmenleri tek kayıt uç noktasıyla T.C./telefon olmadan oluşturur ve
  `TEACHER_IMPORT_IDENTITY_PAIR` boşluğunu yazar.
- Redis yoksa not yayımlama atlanır (`GRADE_PUBLISH_NOT_RUN`); sınav hattı yoksa Öğrenci 360 ve Gelişimim
  sınav panelleri boş çekilir (`EXAM_PIPELINE_NOT_RUN`). Bu görseller yayın adayı değildir; yayın adayı koşu
  Redis ve `--with-exams` ile yapılır.
- e2e'nin taklit (mock) yanıtlı yığını kullanılmaz; taklit yük sentetik kanıt sayılır ve DEC-20261102-07/08
  gerçek akıştan çizilmiş ekran ister.

## PII incelemesi

Her yayın adayı koşu, görseller kullanılmadan önce bir kişi tarafından incelenir. Sonuç, koşunun
`manifest.json` dosyasındaki `review` alanına ve yayın değişikliğinin açıklamasına yazılır.

- İnceleyen (ad soyad, rol): ____________________
- İnceleme tarihi: ____________________
- Koşu kimliği ve commit SHA: ____________________

Kontrol listesi (her PNG, üç boyutta):

- [ ] Görünen her kişi adı `sentetik-v1` kurgusal adıdır (ör. `TEST ÖĞRENCİ 01`); gerçek öğrenci, veli,
      öğretmen veya personel adı yok.
- [ ] T.C. kimlik, telefon ve e-posta yok ya da maskeli; maskesiz değer görünmüyor.
- [ ] Gerçek kurum adı, logo, alan adı, adres yok; kurum adı kurgusal (`Örnek Ortaokulu`).
- [ ] Tarayıcı adres çubuğu, sekme, işletim sistemi bildirimi, geliştirici araçları veya yerel dosya yolu yok.
- [ ] Veli portalı ve finans bilgisi (borç, ödeme, tahsilat) görünmüyor.
- [ ] Hata, "yeniden deneyin" veya boş durum mesajı yayın için yanıltıcı değil; `gaps` listesindeki boşluklar
      görselde kabul edilebilir.
- [ ] Sınav görsellerinde birincil ölçü Başarı %; Net/Soru yalnız bağlam olarak görünüyor.
- [ ] Dosya SHA-256 değerleri manifestle aynı (inceleme sonrası düzenleme yapılmadı).

## Yayın

`apps/web/public`'e taşıma bu hattın parçası değildir. Sıra: staging UAT → yukarıdaki insan PII incelemesi
(adı yazılı inceleyenle) → ürün sahibinin ayrı onayı → landing değişikliği. Pazarlama metni
`docs/marketing-claims.md` sınırları içinde kalır.

## Kanıt sınıfı

Hattın yerel koşusu `LOCAL_TEST` kanıtıdır; staging veya üretim kanıtı değildir.
