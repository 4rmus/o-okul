import { expect, test } from "@playwright/test";

import {
  formatDate,
  formatDateKey,
  formatDateTime,
  formatPhone,
  formatRelativeDay,
  formatTime,
  formatTimeRange,
  formatTurkishPhoneInput,
  formatWallClockDateTime,
  istanbulDateKey,
  maskNationalId,
  maskPhone,
} from "../app/(app)/_shared/format.js";

// Saf biçimlendirme sözleşmesi; tarayıcı açmaz ve test makinesinin saat diliminden bağımsızdır.
test.describe("Türkçe biçimlendirme katmanı", () => {
  test("tarih ve saat Türkiye saatiyle yazılır", () => {
    expect(formatDate("2026-06-10T12:05:00.000Z")).toBe("10.06.2026");
    // 22:30 UTC İstanbul'da ertesi gündür.
    expect(formatDate("2026-06-10T22:30:00.000Z")).toBe("11.06.2026");
    expect(formatDateTime("2026-06-10T12:05:00.000Z")).toBe("10.06.2026 15:05");
    expect(formatDateTime("2026-06-10T12:05:00.000Z", { style: "medium" })).toBe("10 Haz 2026 15:05");
    expect(formatTime("2026-06-10T06:00:00.000Z")).toBe("09:00");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDateTime(null, { fallback: "Tarih belirtilmedi" })).toBe("Tarih belirtilmedi");
    expect(formatDate("tarih değil")).toBe("tarih değil");
  });

  test("takvim günü ve duvar saati kaydırılmaz", () => {
    expect(formatDateKey("2026-11-01")).toBe("1 Kas 2026");
    expect(formatDateKey("2026-11-01T23:30:00.000Z")).toBe("1 Kas 2026");
    expect(formatWallClockDateTime("2026-06-19T09:30:00.000Z")).toBe("19.06.2026 09:30");
    expect(istanbulDateKey(new Date("2026-11-01T21:30:00.000Z"))).toBe("2026-11-02");
  });

  test("saat aralığı ve göreli gün", () => {
    expect(formatTimeRange("2026-06-17T06:30:00.000Z", "2026-06-17T07:10:00.000Z")).toBe("09:30–10:10");
    expect(formatTimeRange("2026-06-17T06:30:00.000Z", "2026-06-18T07:10:00.000Z")).toBe("17.06.2026 09:30 – 18.06.2026 10:10");
    const now = new Date("2026-06-17T08:00:00.000Z");
    expect(formatRelativeDay("2026-06-17", now)).toBe("Bugün");
    expect(formatRelativeDay("2026-06-16", now)).toBe("Dün");
    expect(formatRelativeDay("2026-06-18T06:00:00.000Z", now)).toBe("Yarın");
    expect(formatRelativeDay("2026-06-14", now)).toBe("3 gün önce");
    expect(formatRelativeDay("2026-06-19", now)).toBe("2 gün sonra");
    expect(formatRelativeDay("2026-05-01", now)).toBe("1 May 2026");
  });

  test("telefon +90 ile gruplanır, maske yalnız son iki haneyi gösterir", () => {
    expect(formatPhone("5554443322")).toBe("+90 555 444 33 22");
    expect(formatPhone("05554443322")).toBe("+90 555 444 33 22");
    expect(formatPhone("+90 555 444 3322")).toBe("+90 555 444 33 22");
    expect(formatPhone("+49 30 1234567")).toBe("+49 30 1234567");
    expect(formatPhone(undefined)).toBe("-");
    expect(formatTurkishPhoneInput("0555444")).toBe("+90 555 444");
    expect(maskPhone("+905554443322")).toBe("••• ••• ••22");
    expect(maskPhone("••• ••• ••22")).toBe("••• ••• ••22");
    expect(maskPhone(undefined)).toBe("-");
  });

  test("TC kimlik en fazla son dört haneyle gösterilir", () => {
    expect(maskNationalId("12345678901")).toBe("*******8901");
    expect(maskNationalId("*******2362")).toBe("*******2362");
    expect(maskNationalId("1")).toBe("**********1");
    expect(maskNationalId(undefined)).toBe("-");
    for (const value of ["12345678901", "123 456 789 01"]) {
      expect(maskNationalId(value).replace(/\D/g, "").length).toBeLessThanOrEqual(4);
    }
  });
});
