# Admin Panel (Kurum) — Business Panel Analizi & Geliştirme Planı

> `/sc:business-panel` · Tarih: 2026-06-03 · Kapsam: `apps/web/app/(app)/kurum` admin paneli
> Mod: DISCUSSION → Sentez → Fazlı plan · Panel: Drucker, Christensen, Meadows, Doumont, Taleb

---

## 0. Kanıt Tabanı (doğrulanmış mevcut durum)

**Admin paneli** = `kurum` bölümü. Erişim `hasInstitutionAccess` ile **ikili (binary)**:
`TENANT_ADMIN || SYSTEM_ADMIN` (`app-shell.tsx:292`). Her admin 35 modülün tamamını görür.

**35 modül / 7 navigasyon grubu** (`_shared/navigation.ts`):

| Olgunluk | Modüller | Kanıt |
|---|---|---|
| **Gerçek CRUD** (API + form) — 21 | öğrenciler, öğretmenler, veliler, kampüsler, seviyeler, sınıflar, dersler, program, etütler, devamsızlık, notlar, materyaller, sınavlar, optik, raporlar, finans, duyurular, şablonlar, destek, kullanıcılar, akademik-takvim | 214–998 satır, react-query + form |
| **Salt-okunur liste** — 3 | denetim, sistem-sağlığı, kvkk | API var, form yok |
| **Statik referans panosu** — 6 | canlı-yayın, rol-önizleme, uat-rollback, yedek-restore, güvenlik-denetimi, gözlemlenebilirlik | API yok; CLI komut kartları + checklist gösterir, panel-içi aksiyon yok |

**Olgun temel (korunmalı):** 0 TODO/FIXME, 100+ test, RLS izolasyonu, token rotation + CSRF + CSP,
BullMQ worker, Zod tek-kaynak tipler. Persistence footgun (P1) zaten kapatılmış (`PERSISTENCE_DRIVER`).

**Doğrudan gözlemlenen üç somut boşluk:**
1. **Dashboard demo veriye sabitlenmiş** — `kurum-dashboard.tsx:15` → `examId = "exam-demo-isem-lgs-1"`.
   Admin ana ekranı gerçek son sınavı değil, sabit bir demo sınavın raporunu gösteriyor.
2. **Navigasyon 35 maddelik düz liste** — arama yok, komut paleti yok, favori/son kullanılan yok.
3. **Operasyon grubu "bak ama dokunma"** — yedekleme, rollback, gözlemlenebilirlik, güvenlik
   denetimi yalnız CLI; panelde salt referans kartı.

---

## 1. Uzman Paneli (DISCUSSION)

### 🧭 DRUCKER — Yönetim & Etkinlik
> "Yönetimin görevi insanı verimli kılmaktır; aracın görevi yöneticiyi etkin kılmaktır."

Sorulması gereken ilk soru: **bu panel kimin işini, hangi işi görüyor?** Bugün 21 çalışan CRUD
modülü "veri girişi" işini iyi görüyor — bu *operasyonel etkinlik*. Ama panel bir yöneticiyi
**etkin** kılmıyor: dashboard 3 sayaç + bir demo sınav grafiği gösteriyor; "bugün neye müdahale
etmeliyim?" sorusuna yanıt vermiyor. Bekleyen destek talebi, geciken ödeme, başarısız optik import,
devamsızlık eşiği aşımı — bunların hiçbiri ana ekranda yok. **Veri girişi var, karar desteği yok.**

İkincisi: *"Doğru şeyi mi yapıyoruz, yoksa şeyleri doğru mu yapıyoruz?"* 35 modül "şeyleri doğru
yapma" tarafında olgun. Eksik olan, yöneticinin **dikkatini önceliklendiren** bir üst katman.
MBO mantığı: panel hedefe (öğrenci başarısı, tahsilat, memnuniyet) göre değil, varlık tipine göre
(öğrenci/öğretmen/sınav) organize. Bu, kurum sahibinin zihinsel modeline değil veri şemasına uyuyor.

### 🔨 CHRISTENSEN — Jobs-to-be-Done
> "Müşteriler bir ürünü işe alır. Bu panel hangi iş için işe alınıyor?"

Kurum admini bu paneli üç farklı "iş" için işe alıyor, ve bunlar farklı tasarım ister:
- **Günlük operasyon işi** (yoklama, not, ödev, mesaj) → sıklık yüksek, hız kritik. Bugün iyi.
- **Haftalık/aylık karar işi** (hangi sınıf geride, kim ödememiş, hangi öğretmen yüklü) → bugün
  zayıf; dashboard demo sınava sabitli, çapraz-modül sinyal yok.
- **Kriz/operasyon işi** (yedek al, geri dön, neden patladı) → panel bu işi *hiç* almıyor;
  CLI'a havale ediyor. Admin paniklediği anda terminale gidemez.

Kritik içgörü: 35 modül **özellik** olarak sunulmuş ama **iş** olarak gruplanmamış. Navigasyon
"Kişiler / Akademik / Sınav" diye varlıkla bölünmüş; oysa kullanıcı "yeni dönem açılışı" veya
"sınav sonrası kapanış" gibi **iş akışları** ile gelir. Bir iş, 5–6 modüle dağılmış durumda.

### 🕸️ MEADOWS — Sistem Yapısı & Kaldıraç Noktaları
> "Sistemin davranışı yapısından doğar. 35 düz modül bir yapı değil, bir liste."

Bu sistemin yapısını çizersek: 35 düğüm, aralarında **görünür bağ yok**. Öğrenci → veli → ödeme →
sınav → rapor zinciri veride var (`GuardianStudent`, `PaymentInstallment`, `ExamResult`) ama
arayüzde her modül ada. Kullanıcı bağ kurmayı kendi kafasında yapıyor → bilişsel yük, hata.

**Kaldıraç noktaları (en düşük→en yüksek etki):**
- *Düşük kaldıraç:* yeni modül eklemek (36., 37. modül) — listeyi uzatır, sorunu büyütür.
- *Orta kaldıraç:* dashboard'u demo'dan ayırıp gerçek sinyallere bağlamak.
- *Yüksek kaldıraç:* **bilgi mimarisini değiştirmek** — düz listeyi aramaya/iş-akışına dönüştürmek,
  modülleri varlık yerine **karar/iş** etrafında bağlamak. Bu, *kurallar* ve *bilgi akışı*
  seviyesinde müdahale (Meadows hiyerarşisinde en güçlü iki kaldıraçtan).
- *En yüksek kaldıraç:* sistemin *amacını* yansıtmak — RBAC redesign zaten backend'de var ama
  arayüz hâlâ ikili. Granüler yetkiyi UI'ye yansıtmak, paneli "her şeyi gören tek admin"den
  "rolüne göre daraltılmış görünüm"e çevirir — bu **paradigma** değişimi.

Geri besleme döngüsü eksiği: panelde aksiyon → sonuç görünürlüğü yok. Admin duyuru gönderir,
teslim raporu ayrı modülde; ödeme planı kurar, tahsilat sinyali dashboard'a dönmez.

### ✏️ DOUMONT — İletişim & Yapısal Netlik
> "Mesaj, alıcının bilişsel yükünü azaltmalı. 35 eşit-ağırlıklı menü maddesi mesaj değil, gürültü."

Bilgi mimarisi açısından düz 35-madde liste **navigasyon değil envanter**. Miller'ın 7±2 kuralı
çoktan aşılmış. Gruplama var (7 grup) ama gruplar eşit görsel ağırlıkta ve hepsi hep açık.
Net üç problem:
- **Bulunabilirlik:** arama olmadan 35 maddede "şablon nerede?" diye göz taraması gerekiyor.
- **Önceliklendirme:** "Sistem Sağlığı" ile "Öğrenciler" aynı görsel ağırlıkta — oysa biri günde
  50 kez, diğeri ayda 1 kez kullanılıyor. Sıklık arayüze yansımıyor.
- **Tutarsız sözcük:** "Operasyon" grubu hem iş aracı (Kullanıcılar) hem salt-doküman (UAT/Rollback)
  karıştırıyor; kullanıcı tıklayınca aksiyon bekliyor, statik kart buluyor → beklenti ihlali.

Çözüm iletişimsel: **komut paleti (Cmd-K) + arama** maddeleri ezberlemekten kurtarır; sık
kullanılanları öne çeker; statik referans panellerini "rehber/yardım" olarak ayrı etiketler.

### 🛡️ TALEB — Risk & Antifırılganlık
> "Kırılganlık, stres anında seçeneğin olmamasıdır. Operasyon paneli tam da burada çuvallıyor."

En büyük *kuyruk riski* operasyon grubunda: yedek-restore, rollback, gözlemlenebilirlik **panelde
salt-okunur**. Kriz anında (veri bozulması, hatalı toplu işlem) admin'in panelden yapabileceği
*hiçbir geri-alma yok* — CLI'a ve teknik personele bağımlı. Bu, **tek nokta kırılganlık**:
sistem normalde çalışırken sorun yok, ama tam stres anında seçenek sıfır.

Olumlu tarafta sistem bazı yerlerde *sağlam (robust)*: RLS çift savunma, token rotation, evidence
zinciri. Ama sağlamlık ≠ antifırılganlık. Panel hatadan **öğrenmiyor**: başarısız import quarantine'e
düşüyor (`ImportQuarantine` modeli var) ama admin'i panelde proaktif uyaran bir sinyal yok.

Asimetri kuralı: dashboard'daki **sabit demo examId** küçük görünür ama asimetrik risk taşır —
admin gerçek veriyle baktığını sanıp demo sınavın grafiğine bakarak karar verebilir. *Yanlış
güven*, hiç-veri'den daha tehlikeli. Önce bu kapatılmalı (ucuz, yüksek getiri).

---

## 2. 🧩 Sentez

**🤝 Yakınsayan görüşler (uzlaşı):**
- **Veri girişi olgun, karar desteği yok.** 5 uzman da aynı boşluğu farklı dilden söylüyor:
  Drucker "etkinlik", Christensen "haftalık karar işi", Meadows "geri besleme döngüsü",
  Doumont "önceliklendirme", Taleb "proaktif uyarı".
- **Bilgi mimarisi en yüksek kaldıraç.** Yeni modül eklemek değil, mevcut 35'i yeniden
  yapılandırmak (arama + iş-akışı + rol-bazlı görünüm) en yüksek getirili müdahale.
- **Operasyon grubu yarım.** Hem Christensen (kriz işi alınmıyor) hem Taleb (stres anında
  seçenek yok) aynı yere işaret ediyor.

**⚖️ Üretken gerilimler:**
- **Meadows (yeni yapı kur) ⚡ Taleb (önce kırılganlığı kapat).** Büyük IA yeniden yapısı
  cazip ama riskli; Taleb "önce ucuz ve yüksek-getirili düzeltmeler" (demo examId, eksik uyarılar)
  der. → *Çözüm:* ucuz düzeltmeler önce (Faz B), yapısal değişim sonra (Faz A genişletme).
- **Christensen (iş-akışı etrafında yeniden grupla) ⚡ Doumont (mevcut gruplamayı bozma, üstüne
  arama koy).** Tam yeniden gruplama kullanıcı alışkanlığını bozar. → *Çözüm:* mevcut grupları
  koru, **üstüne** komut paleti + iş-akışı kısayolları ekle (additive, yıkıcı değil).

**🕸️ Sistem kaldıraç sırası (Meadows):**
1. Paradigma: ikili RBAC → granüler rol-bazlı görünüm (backend hazır, UI değil)
2. Bilgi akışı: dashboard'u gerçek çapraz-modül sinyallere bağla
3. Kurallar: arama/komut paleti ile navigasyon kuralını değiştir
4. Parametreler: tek tek modül iyileştirmeleri (en düşük kaldıraç)

**💬 Çekirdek mesaj (Doumont):** *Panel bir "yönetim sistemi" değil, 35 ayrı "veri formu"nun
toplamı. Eksik olan üst katman: arama, karar ekranı, kriz aksiyonları, rol-bazlı görünüm.*

**⚠️ Kör noktalar:**
- Porter perspektifi (bu analizde ikincil): SaaS'ta admin paneli kalitesi **geçiş maliyeti /
  yapışkanlık** moat'ıdır. İyi panel = düşük churn. Plan bunu rekabet avantajı olarak da çerçeveler.
- Mobil/tablet kullanım: kurum sahibi sahada tablet kullanır mı? Veri yok — araştırılmalı.
- Performans: 35 modül + react-query; ölçüm yok. Plan öncesi profil gerekebilir.

---

## 3. Kapsamlı Geliştirme Planı (admin-panel odaklı)

> Mevcut `MASTER_PLAN.md` ve `development-plan-2026-06-02.md` ürün-genelidir. Bu plan **yalnız
> admin paneli (kurum) deneyimini** ele alır ve onları tamamlar. Eforlar göreli (S/M/L).

### Faz B — Ucuz & Yüksek Getiri (önce; Taleb önceliği) — ~1 hafta
*Amaç: yanlış güveni ve körlüğü kapat.*

- **B1 · Dashboard demo-bağını kır** (S, 🔴). `kurum-dashboard.tsx:15` sabit `examId`'yi kaldır →
  son yayımlanmış `ReportSnapshot`/`Exam`'i sorgula; veri yoksa "henüz sınav yok" boş-durumu.
- **B2 · Karar sinyalleri şeridi** (M). Dashboard'a aksiyon kartları: bekleyen destek talebi
  (`SupportTicket`), geciken ödeme (`PaymentInstallment`), karantinadaki import (`ImportQuarantine`),
  devamsızlık eşiği. Her kart ilgili modüle derin link.
- **B3 · Statik referans panellerini etiketle** (S). 6 operasyon panelini "Rehber/Referans"
  rozetiyle işaretle → kullanıcı aksiyon beklemesin (Doumont beklenti-ihlali düzeltmesi).

**Kapı:** `pnpm typecheck && pnpm test`; dashboard boş-durum + gerçek-veri E2E.

### Faz A — Bilgi Mimarisi & Navigasyon (en yüksek kaldıraç) — ~2–3 hafta
*Amaç: 35 düz modülü aranabilir, önceliklendirilmiş bir sisteme çevir.*

- **A1 · Komut paleti (Cmd-K)** (M, 🔴). Tüm modüller + sık aksiyonlar üzerinde fuzzy arama.
  Düz listeyi ezberlemeyi bitirir (Doumont). Mevcut `navigation.ts` veri kaynağı olarak yeniden kullanılır.
- **A2 · Global varlık araması** (L). Öğrenci/öğretmen/veli/sınıf'ta tek kutudan arama → detay
  sayfasına git. Backend liste endpoint'leri mevcut (`listing` modülü).
- **A3 · Sık kullanılan / son ziyaret** (S). Sidebar üstünde dinamik kısayol; sıklığı arayüze yansıtır.
- **A4 · İş-akışı kısayolları** (M). "Yeni dönem açılışı", "sınav sonrası kapanış" gibi çok-modüllü
  akışları tek giriş noktasından sıralı sun (Christensen iş-bazlı gruplama, additive).

**Kapı:** komut paleti + arama için Playwright senaryoları (web E2E kapsamı zaten ince — bu fazda artar).

### Faz C — Operasyon Modüllerini Aksiyon Alınabilir Yap (Taleb antifırılganlık) — ~3–4 hafta
*Amaç: kriz anında panelden seçenek üret.*

- **C0 · Karar:** her operasyon modülü için "panelden aksiyon mı, CLI-only mi?" açık karar +
  dokümante et. Bazıları (prod evidence zinciri) bilinçli CLI-only kalabilir — o zaman panel bunu
  *açıkça* söylesin, sahte buton koyma.
- **C1 · Yedek/Restore tetikleme** (L, 🔴). Panelden korumalı (çift-onay + rol) yedek alma ve
  restore-drill tetikleme; durum/sonuç görünürlüğü. Backend job + audit log zorunlu.
- **C2 · Gözlemlenebilirlik canlı** (M). Statik kartları gerçek metrik/health akışına bağla
  (`metrics`, `health` modülleri mevcut).
- **C3 · Güvenlik denetimi canlı** (M). Salt-okunur kanıt → gerçek son güvenlik olayları/uyarıları.

**Kapı:** her yıkıcı aksiyon için audit log + RBAC + çift-onay testi.

### Faz D — RBAC Granülerliğini UI'ye Yansıt (en yüksek kaldıraç / paradigma) — ~2–3 hafta
*Amaç: "her şeyi gören tek admin" → rol-bazlı daraltılmış görünüm.*

- **D1 · Modül görünürlüğünü role bağla** (M, 🔴). `hasInstitutionAccess` ikili kontrolünü backend
  RBAC redesign'ın (commit `2226807`) yetki modeline bağla; nav modülleri yetkilere göre filtrelensin.
- **D2 · Rol önizleme → işlevsel impersonation** (L). Bugün statik kart olan `rol-onizleme`,
  admin'in bir rolün gerçek görünümünü güvenli (salt-okunur) önizlemesine dönüşsün.

**Kapı:** RBAC matris E2E (`me-access-matrix.e2e.test.ts` deseni admin tarafına genişler).

### Faz E — Sertleştirme & Doğrulama — ~1–2 hafta
- **E1 · Admin akışları E2E** (M). improvement-analysis P3'teki ince web kapsamını kapat:
  login→dashboard→kritik modül akışları.
- **E2 · Performans profili** (S). 35 modül + react-query yük profili; gerekirse lazy/prefetch.
- **E3 · Boş-durum & hata-durum geçişi** (S). Tüm modüllerde tutarlı boş/hata/yükleniyor desenleri.

---

## 4. Önerilen Sıra & Gerekçe

```
B (ucuz/yüksek getiri, körlüğü kapat)
  → A (bilgi mimarisi, en yüksek günlük getiri)
    → D (RBAC paradigma; A'nın nav altyapısını kullanır)
    → C (antifırılganlık; bağımsız, paralel yürüyebilir)
      → E (sertleştirme; süreklilik)
```

- **B önce** çünkü demo-examId yanlış-güven riski ucuz ama yüksek getirili (Taleb asimetri).
- **A ikinci** çünkü her admin her gün navigasyonla temas eder — en yüksek kümülatif getiri (Meadows kaldıraç).
- **C, A/D'den bağımsız** → ayrı kol olarak paralel ilerleyebilir.
- **Yeni modül eklemek bilinçli olarak yok** — Meadows: en düşük kaldıraç, sorunu büyütür.

**Açık kararlar (kullanıcıdan onay bekleyen):**
1. Operasyon modülleri panelden aksiyon mı alacak yoksa bilinçli CLI-only mı kalacak? (Faz C kapsamını belirler)
2. Mobil/tablet admin kullanımı hedef mi? (responsive efor)
3. Faz sırası onayı — B→A önceliğine katılıyor musunuz?
