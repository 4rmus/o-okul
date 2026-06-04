import "dotenv/config";
import pg from "pg";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://migration:migration@localhost:5432/uzman_hocam";

type SeedMode = "demo" | "minimal";

const seedMode = parseSeedMode(process.env.SEED_MODE);
const pool = new pg.Pool({ connectionString: databaseUrl });
const demoPasswordHash = "scrypt:demo-auth-salt:uG-yNMDIMmz8JL5XDnE2Eoc939a2mw8PcRPoJb8CXac";

const demoSubjectUsers = [
  { id: "user-demo-assistant", email: "assistant@demo.local", name: "Demo Müdür Yardımcısı", role: "ASSISTANT_ADMIN" },
  { id: "user-demo-teacher", email: "teacher@demo.local", name: "Demo Öğretmen", role: "TEACHER" },
  { id: "user-demo-student", email: "student@demo.local", name: "Demo Öğrenci", role: "STUDENT" },
  { id: "user-demo-guardian", email: "guardian@demo.local", name: "Demo Veli", role: "GUARDIAN" },
] as const;

type LearningOutcomeSeed = {
  id: string;
  code: string;
  branch: string;
  title: string;
  level: string;
};

const learningOutcomes: LearningOutcomeSeed[] = [
  { id: "learning-outcome-demo-mat-8-1-1", code: "MAT.8.1.1", branch: "Matematik", title: "Çarpanlar ve katlar", level: "8" },
  { id: "learning-outcome-demo-tur-8-2-1", code: "TUR.8.2.1", branch: "Türkçe", title: "Paragrafta anlam", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-001", code: "LGS26.TUR.8.001", branch: "Türkçe", title: "Fiilimsiler", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-002", code: "LGS26.TUR.8.002", branch: "Türkçe", title: "Cümlenin Ögeleri", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-003", code: "LGS26.TUR.8.003", branch: "Türkçe", title: "Cümle Türleri", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-004", code: "LGS26.TUR.8.004", branch: "Türkçe", title: "İsim ve Fiil Cümlesi", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-005", code: "LGS26.TUR.8.005", branch: "Türkçe", title: "Kurallı ve Devrik Cümle", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-006", code: "LGS26.TUR.8.006", branch: "Türkçe", title: "Basit Cümle", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-007", code: "LGS26.TUR.8.007", branch: "Türkçe", title: "Birleşik Cümle", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-008", code: "LGS26.TUR.8.008", branch: "Türkçe", title: "Sıralı Cümle", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-009", code: "LGS26.TUR.8.009", branch: "Türkçe", title: "Bağlı Cümle", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-010", code: "LGS26.TUR.8.010", branch: "Türkçe", title: "Sözcükte Anlam", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-011", code: "LGS26.TUR.8.011", branch: "Türkçe", title: "Cümlede Anlam İlişkileri", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-012", code: "LGS26.TUR.8.012", branch: "Türkçe", title: "Cümle Yorumlama", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-013", code: "LGS26.TUR.8.013", branch: "Türkçe", title: "Metin Türleri", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-014", code: "LGS26.TUR.8.014", branch: "Türkçe", title: "Söz Sanatları", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-015", code: "LGS26.TUR.8.015", branch: "Türkçe", title: "Yazım Kuralları", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-016", code: "LGS26.TUR.8.016", branch: "Türkçe", title: "Noktalama İşaretleri", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-017", code: "LGS26.TUR.8.017", branch: "Türkçe", title: "Paragrafın Anlam Yönü", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-018", code: "LGS26.TUR.8.018", branch: "Türkçe", title: "Paragrafın Yapı Yönü", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-019", code: "LGS26.TUR.8.019", branch: "Türkçe", title: "Tablo ve Grafik İnceleme", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-020", code: "LGS26.TUR.8.020", branch: "Türkçe", title: "Görsel Yorumlama", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-021", code: "LGS26.TUR.8.021", branch: "Türkçe", title: "Sözel Mantık", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-022", code: "LGS26.TUR.8.022", branch: "Türkçe", title: "Fiillerde Çatı", level: "8" },
  { id: "learning-outcome-demo-lgs26-tur-023", code: "LGS26.TUR.8.023", branch: "Türkçe", title: "Anlatım Bozuklukları", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-001", code: "LGS26.MAT.8.001", branch: "Matematik", title: "Çarpanlar ve Katlar", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-002", code: "LGS26.MAT.8.002", branch: "Matematik", title: "Üslü İfadeler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-003", code: "LGS26.MAT.8.003", branch: "Matematik", title: "Kareköklü İfadeler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-004", code: "LGS26.MAT.8.004", branch: "Matematik", title: "Veri Analizi", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-005", code: "LGS26.MAT.8.005", branch: "Matematik", title: "Basit Olayların Olma Olasılığı", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-006", code: "LGS26.MAT.8.006", branch: "Matematik", title: "Cebirsel İfadeler ve Özdeşlikler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-007", code: "LGS26.MAT.8.007", branch: "Matematik", title: "Doğrusal Denklemler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-008", code: "LGS26.MAT.8.008", branch: "Matematik", title: "Eşitsizlikler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-009", code: "LGS26.MAT.8.009", branch: "Matematik", title: "Üçgenler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-010", code: "LGS26.MAT.8.010", branch: "Matematik", title: "Eşlik ve Benzerlik", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-011", code: "LGS26.MAT.8.011", branch: "Matematik", title: "Geometrik Cisimler", level: "8" },
  { id: "learning-outcome-demo-lgs26-mat-012", code: "LGS26.MAT.8.012", branch: "Matematik", title: "Dönüşüm Geometrisi", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-001", code: "LGS26.FEN.8.001", branch: "Fen Bilimleri", title: "Mevsimler ve İklimler", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-002", code: "LGS26.FEN.8.002", branch: "Fen Bilimleri", title: "DNA ve Genetik Kod", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-003", code: "LGS26.FEN.8.003", branch: "Fen Bilimleri", title: "Basınç", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-004", code: "LGS26.FEN.8.004", branch: "Fen Bilimleri", title: "Madde ve Endüstri: Periyodik Sistem", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-005", code: "LGS26.FEN.8.005", branch: "Fen Bilimleri", title: "Fiziksel ve Kimyasal Değişimler", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-006", code: "LGS26.FEN.8.006", branch: "Fen Bilimleri", title: "Asitler ve Bazlar", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-007", code: "LGS26.FEN.8.007", branch: "Fen Bilimleri", title: "Madde ve Endüstri", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-008", code: "LGS26.FEN.8.008", branch: "Fen Bilimleri", title: "Basit Makineler", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-009", code: "LGS26.FEN.8.009", branch: "Fen Bilimleri", title: "Canlılar ve Enerji İlişkileri", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-010", code: "LGS26.FEN.8.010", branch: "Fen Bilimleri", title: "Enerji Dönüşümleri ve Çevre Bilimi", level: "8" },
  { id: "learning-outcome-demo-lgs26-fen-011", code: "LGS26.FEN.8.011", branch: "Fen Bilimleri", title: "Elektrik Yükleri ve Elektrik Enerjisi", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-001", code: "LGS26.DIN.8.001", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Kader ve Kaza İnancı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-002", code: "LGS26.DIN.8.002", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Kader ve Evrendeki Yasalar", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-003", code: "LGS26.DIN.8.003", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Allah Her Şeyi Bir Ölçüye Göre Yaratmıştır", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-004", code: "LGS26.DIN.8.004", branch: "Din Kültürü ve Ahlak Bilgisi", title: "İnsanın İradesi ve Kader", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-005", code: "LGS26.DIN.8.005", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Kaderle İlgili Kavramlar", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-006", code: "LGS26.DIN.8.006", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Peygamber Tanıyorum: Hz. Musa", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-007", code: "LGS26.DIN.8.007", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Ayet Tanıyorum: Ayet el-Kürsi ve Anlamı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-008", code: "LGS26.DIN.8.008", branch: "Din Kültürü ve Ahlak Bilgisi", title: "İslam'ın Paylaşma ve Yardımlaşmaya Verdiği Önem", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-009", code: "LGS26.DIN.8.009", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Zekât ve Sadaka İbadeti", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-010", code: "LGS26.DIN.8.010", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Zekât ve Sadakanın Bireysel ve Toplumsal Faydaları", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-011", code: "LGS26.DIN.8.011", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Peygamber Tanıyorum: Hz. Şuayb", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-012", code: "LGS26.DIN.8.012", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Sure Tanıyorum: Maûn Suresi ve Anlamı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-013", code: "LGS26.DIN.8.013", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Din, Birey ve Toplum", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-014", code: "LGS26.DIN.8.014", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Dinin Temel Gayesi", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-015", code: "LGS26.DIN.8.015", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Peygamber Tanıyorum: Hz. Yusuf", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-016", code: "LGS26.DIN.8.016", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Sure Tanıyorum: Asr Suresi ve Anlamı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-017", code: "LGS26.DIN.8.017", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in Doğruluğu ve Güvenilir Kişiliği", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-018", code: "LGS26.DIN.8.018", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in Merhametli ve Affedici Oluşu", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-019", code: "LGS26.DIN.8.019", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in İstişareye Önem Vermesi", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-020", code: "LGS26.DIN.8.020", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in Davasındaki Cesaret ve Kararlılığı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-021", code: "LGS26.DIN.8.021", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in Hakkı Gözetmedeki Hassasiyeti", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-022", code: "LGS26.DIN.8.022", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Hz. Muhammed'in İnsanlara Değer Vermesi", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-023", code: "LGS26.DIN.8.023", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Sure Tanıyorum: Kureyş Suresi ve Anlamı", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-024", code: "LGS26.DIN.8.024", branch: "Din Kültürü ve Ahlak Bilgisi", title: "İslam Dininin Temel Kaynakları", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-025", code: "LGS26.DIN.8.025", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Kur'an-ı Kerim'in Ana Konuları", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-026", code: "LGS26.DIN.8.026", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Kur'an-ı Kerim'in Temel Özellikleri", level: "8" },
  { id: "learning-outcome-demo-lgs26-din-027", code: "LGS26.DIN.8.027", branch: "Din Kültürü ve Ahlak Bilgisi", title: "Bir Peygamber Tanıyorum: Hz. Nuh", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-001", code: "LGS26.INK.8.001", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Bir Kahraman Doğuyor", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-002", code: "LGS26.INK.8.002", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Milli Uyanış: Bağımsızlık Yolunda Atılan Adımlar", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-003", code: "LGS26.INK.8.003", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Milli Bir Destan: Ya İstiklal Ya Ölüm", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-004", code: "LGS26.INK.8.004", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Çağdaş Türkiye Yolunda Adımlar", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-005", code: "LGS26.INK.8.005", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Demokratikleşme Çabaları", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-006", code: "LGS26.INK.8.006", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Atatürkçülük", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-007", code: "LGS26.INK.8.007", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "Atatürk Dönemi Türk Dış Politikası ve Atatürk'ün Ölümü", level: "8" },
  { id: "learning-outcome-demo-lgs26-ink-008", code: "LGS26.INK.8.008", branch: "T.C. İnkılap Tarihi ve Atatürkçülük", title: "İkinci Dünya Savaşı ve Sonrası", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-001", code: "LGS26.ING.8.001", branch: "İngilizce", title: "Friendship", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-002", code: "LGS26.ING.8.002", branch: "İngilizce", title: "Teen Life", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-003", code: "LGS26.ING.8.003", branch: "İngilizce", title: "In the Kitchen", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-004", code: "LGS26.ING.8.004", branch: "İngilizce", title: "On the Phone", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-005", code: "LGS26.ING.8.005", branch: "İngilizce", title: "The Internet", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-006", code: "LGS26.ING.8.006", branch: "İngilizce", title: "Adventures", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-007", code: "LGS26.ING.8.007", branch: "İngilizce", title: "Tourism", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-008", code: "LGS26.ING.8.008", branch: "İngilizce", title: "Chores", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-009", code: "LGS26.ING.8.009", branch: "İngilizce", title: "Science", level: "8" },
  { id: "learning-outcome-demo-lgs26-ing-010", code: "LGS26.ING.8.010", branch: "İngilizce", title: "Natural Forces", level: "8" },
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");

    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES ('system', 'System', 'system', 'ACTIVE', now())
       ON CONFLICT ("slug") DO UPDATE SET "updatedAt" = now()`,
    );

    const systemUser = await client.query<{ id: string }>(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ('user-system', 'system@example.test', 'System Admin', $1, now())
       ON CONFLICT ("email") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = now()
       RETURNING "id"`,
      [demoPasswordHash],
    );

    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ('membership-system-admin', 'system', $1, 'SYSTEM_ADMIN', now())
       ON CONFLICT ("tenantId", "userId", "role") DO UPDATE SET "updatedAt" = now()`,
      [systemUser.rows[0]?.id],
    );

    if (seedMode === "minimal") {
      await client.query("COMMIT");
      console.log("Seeded minimal system tenant and SYSTEM_ADMIN");
      return;
    }

    const tenant = await client.query<{ id: string }>(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES ('tenant-demo', 'Demo Kurum', 'demo', 'ACTIVE', now())
       ON CONFLICT ("slug") DO UPDATE SET "updatedAt" = now()
       RETURNING "id"`,
    );

    const user = await client.query<{ id: string }>(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES ('user-demo-admin', 'admin@demo.local', 'Demo Yönetici', $1, now())
       ON CONFLICT ("email") DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = now()
       RETURNING "id"`,
      [demoPasswordHash],
    );

    await client.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES ('membership-demo-admin', $1, $2, 'TENANT_ADMIN', now())
       ON CONFLICT ("tenantId", "userId", "role") DO UPDATE SET "updatedAt" = now()`,
      [tenant.rows[0]?.id, user.rows[0]?.id],
    );

    const tenantId = tenant.rows[0]?.id;
    for (const subjectUser of demoSubjectUsers) {
      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT ("email") DO UPDATE
         SET "name" = EXCLUDED."name",
             "passwordHash" = EXCLUDED."passwordHash",
             "updatedAt" = now()`,
        [subjectUser.id, subjectUser.email, subjectUser.name, demoPasswordHash],
      );

      await client.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, $4::"TenantRole", now())
         ON CONFLICT ("tenantId", "userId", "role") DO UPDATE SET "updatedAt" = now()`,
        [`membership-${subjectUser.id}`, tenantId, subjectUser.id, subjectUser.role],
      );
    }

    await client.query(
      `INSERT INTO "Class" ("id", "tenantId", "name", "level", "updatedAt")
       VALUES ('class-demo-8-a', $1, '8-A', '8', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "name" = EXCLUDED."name",
           "level" = EXCLUDED."level",
           "deletedAt" = NULL,
           "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "branch", "userId", "updatedAt")
       VALUES ('teacher-demo-main', $1, 'Demo', 'Öğretmen', 'Matematik', 'user-demo-teacher', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "firstName" = EXCLUDED."firstName",
           "lastName" = EXCLUDED."lastName",
           "branch" = EXCLUDED."branch",
           "userId" = EXCLUDED."userId",
           "deletedAt" = NULL,
           "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "Student" (
         "id", "tenantId", "classId", "responsibleTeacherId", "status", "firstName", "lastName", "studentNo", "email", "userId", "updatedAt"
       )
       VALUES ('student-demo-main', $1, 'class-demo-8-a', 'teacher-demo-main', 'ACTIVE', 'Demo', 'Öğrenci', 'DEMO-001', 'student@demo.local', 'user-demo-student', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "classId" = EXCLUDED."classId",
           "responsibleTeacherId" = EXCLUDED."responsibleTeacherId",
           "status" = EXCLUDED."status",
           "firstName" = EXCLUDED."firstName",
           "lastName" = EXCLUDED."lastName",
           "studentNo" = EXCLUDED."studentNo",
           "email" = EXCLUDED."email",
           "userId" = EXCLUDED."userId",
           "deletedAt" = NULL,
           "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "StudentClassHistory" (
         "id", "tenantId", "studentId", "classId", "startsAt", "reason", "updatedAt"
       )
       VALUES ('student-class-history-demo-main', $1, 'student-demo-main', 'class-demo-8-a', '2026-06-01'::date, 'CREATED', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "studentId" = EXCLUDED."studentId",
           "classId" = EXCLUDED."classId",
           "startsAt" = EXCLUDED."startsAt",
           "endsAt" = NULL,
           "reason" = EXCLUDED."reason",
           "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "phone", "userId", "updatedAt")
       VALUES ('guardian-demo-main', $1, 'Demo', 'Veli', '5550000000', 'user-demo-guardian', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "firstName" = EXCLUDED."firstName",
           "lastName" = EXCLUDED."lastName",
           "phone" = EXCLUDED."phone",
           "userId" = EXCLUDED."userId",
           "deletedAt" = NULL,
           "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "GuardianStudent" (
         "id",
         "tenantId",
         "guardianId",
         "studentId",
         "relationshipType",
         "isPrimary",
         "canViewFinance",
         "canReceiveSms",
         "canReceiveAnnouncements",
         "canOpenSupportTickets",
         "updatedAt"
       )
       VALUES ('guardian-student-demo-main', $1, 'guardian-demo-main', 'student-demo-main', 'MOTHER', true, true, true, true, true, now())
       ON CONFLICT ("tenantId", "guardianId", "studentId") DO UPDATE SET
         "relationshipType" = EXCLUDED."relationshipType",
         "isPrimary" = EXCLUDED."isPrimary",
         "canViewFinance" = EXCLUDED."canViewFinance",
         "canReceiveSms" = EXCLUDED."canReceiveSms",
         "canReceiveAnnouncements" = EXCLUDED."canReceiveAnnouncements",
         "canOpenSupportTickets" = EXCLUDED."canOpenSupportTickets",
         "updatedAt" = now()`,
      [tenantId],
    );

    await client.query(
      `INSERT INTO "TeacherAssignment" (
         "id", "tenantId", "teacherId", "classId", "studentId", "role", "updatedAt"
       )
       VALUES
         ('teacher-assignment-demo-class', $1, 'teacher-demo-main', 'class-demo-8-a', NULL, 'CLASS_TEACHER', now()),
         ('teacher-assignment-demo-student', $1, 'teacher-demo-main', NULL, 'student-demo-main', 'RESPONSIBLE_TEACHER', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "teacherId" = EXCLUDED."teacherId",
           "classId" = EXCLUDED."classId",
           "studentId" = EXCLUDED."studentId",
           "role" = EXCLUDED."role",
           "updatedAt" = now()`,
      [tenantId],
    );

    const learningOutcomeValues = learningOutcomes
      .map((_, index) => {
        const offset = index * 6 + 1;
        return `($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, now())`;
      })
      .join(",\n         ");
    const learningOutcomeParams = learningOutcomes.flatMap((outcome) => [
      outcome.id,
      tenant.rows[0]?.id,
      outcome.code,
      outcome.branch,
      outcome.title,
      outcome.level,
    ]);

    await client.query(
      `INSERT INTO "LearningOutcome" ("id", "tenantId", "code", "branch", "title", "level", "updatedAt")
       VALUES ${learningOutcomeValues}
       ON CONFLICT ("tenantId", "code") DO UPDATE
       SET "branch" = EXCLUDED."branch",
           "title" = EXCLUDED."title",
           "level" = EXCLUDED."level",
           "updatedAt" = now()`,
      learningOutcomeParams,
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseSeedMode(value: string | undefined): SeedMode {
  if (!value || value === "demo") return "demo";
  if (value === "minimal") return "minimal";
  throw new Error("SEED_MODE must be demo or minimal");
}

main()
  .finally(async () => {
    await pool.end();
  });
