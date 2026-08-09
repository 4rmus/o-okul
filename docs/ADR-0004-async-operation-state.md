# ADR-0004: Ortak Asenkron İşlem Durumu

## Durum

Kabul edildi.

## Karar

Uzun işlemler `NOT_STARTED`, `READY_TO_START`, `QUEUED`, `PROCESSING`, `ACTION_REQUIRED`,
`READY`, `FAILED` ve `SUPERSEDED` durumlarını kullanır. Queue tamamlanması tek başına `READY`
değildir; kalıcı domain sonucu doğrulanmış olmalıdır. `FAILED` sabit hata kodu ve retry bilgisini,
tüm durumlar correlation kimliğini taşır.

## Gerekçe

Optik, değerlendirme, rapor ve import ekranlarının aynı gerçeği farklı spinner veya serbest metinle
yorumlaması yanlış başarı gösterimine yol açar.

## Kaynak İzi

- Karar ID: DEC-20260809-01
- Kanıt: mevcut raw-import/report snapshot testleri; sonraki `WF-01` shared contract dilimi

## Sonuçlar

- Bu ADR Gate B'de davranış değiştirmez; ortak tip ve UI adapter'ı `WF-01` kapsamıdır.
- Ham queue/job ayrıntısı kullanıcıya gösterilmez.
- Retry yeni idempotent operasyon olarak izlenir.
