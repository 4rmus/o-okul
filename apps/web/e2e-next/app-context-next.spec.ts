import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";
import { ContextBar, CrudPage, WorkflowStepper, type DataTableColumn } from "@o-okul/ui";
import { tenantRoleLabel } from "@o-okul/shared-types";
import { institutionNavGroups, institutionNavGroupsV2, institutionOperationEvidenceItems } from "../app/(app)/_shared/navigation.js";
import { buildListUrl } from "../src/list-controls.js";

const columns: Array<DataTableColumn<{ id: string }>> = [
  { header: "Kayıt", key: "record", render: (row) => row.id },
];

test("liste aramasını yalnız serileştirme sınırında kırpar", () => {
  const url = new URL(buildListUrl("https://example.test/records", {
    limit: 10,
    page: 1,
    q: "  iki kelime  ",
    sort: "",
  }));

  expect(url.searchParams.get("q")).toBe("iki kelime");
});

test("CrudPage durum önceliğini ve filtreli boş durumu korur", () => {
  const render = (props: Partial<Parameters<typeof CrudPage<{ id: string }>>[0]>) =>
    renderToStaticMarkup(createElement(CrudPage<{ id: string }>, {
      columns,
      getRowKey: (row) => row.id,
      rows: [],
      ...props,
    }));

  expect(render({ error: "Hata", loading: true })).toContain("Yükleniyor");
  expect(render({ error: "Hata", loading: true })).not.toContain("Hata");
  expect(render({ error: "Hata", rows: [{ id: "gizli-kayıt" }] })).not.toContain("gizli-kayıt");
  expect(render({ filteredEmptyState: "Filtre sonucu yok", hasActiveFilters: true })).toContain("Filtre sonucu yok");
  expect(render({ emptyState: "İlk kayıt bekleniyor" })).toContain("İlk kayıt bekleniyor");
  expect(render({ rows: [{ id: "görünen-kayıt" }] })).toContain("görünen-kayıt");
});

test("kurum rail ve ürün terimleri yeni bağlamı kullanır", () => {
  expect(institutionNavGroups.map((group) => group.label)).toEqual([
    "Bugün",
    "Öğrenci ve eğitim",
    "Sınav ve rapor",
    "İletişim",
    "Yönetim",
  ]);
  expect(institutionOperationEvidenceItems.every((item) => item.hiddenFromRail)).toBe(true);
  expect(tenantRoleLabel("TENANT_ADMIN")).toBe("Kurum yöneticisi");
});

test("Shell v2 yedi alanı aynı route kaynağından üretir", () => {
  expect(institutionNavGroupsV2.map((group) => group.label)).toEqual([
    "Bugün",
    "Kişiler",
    "Akademik",
    "Sınav",
    "İletişim",
    "Finans",
    "Ayarlar",
  ]);
  const legacyHrefs = institutionNavGroups
    .flatMap((group) => group.items)
    .filter((item) => !item.hiddenFromRail)
    .map((item) => item.href)
    .sort();
  const v2Hrefs = institutionNavGroupsV2.flatMap((group) => group.items).map((item) => item.href).sort();
  expect(v2Hrefs).toEqual(legacyHrefs);
  expect(new Set(v2Hrefs).size).toBe(v2Hrefs.length);
});

test("ContextBar ve WorkflowStepper erişilebilir sözleşmeyi korur", () => {
  const context = renderToStaticMarkup(createElement(ContextBar, {
    items: [{ label: "Sınav", value: "LGS Genel Deneme" }],
    label: "Sınav bağlamı",
  }));
  const steps = renderToStaticMarkup(createElement(WorkflowStepper, {
    steps: [
      { id: "definition", label: "Sınav tanımı", state: "complete" },
      { id: "report", label: "Rapor", state: "current" },
    ],
  }));

  expect(context).toContain('aria-label="Sınav bağlamı"');
  expect(context).toContain("LGS Genel Deneme");
  expect(steps).toContain('aria-current="step"');
  expect(steps).toContain("Tamamlandı");
  expect(steps).toContain("Sıradaki");
});
