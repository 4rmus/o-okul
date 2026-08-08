import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";
import { CrudPage, type DataTableColumn } from "@o-okul/ui";
import { tenantRoleLabel } from "@o-okul/shared-types";
import { institutionNavGroups, institutionOperationEvidenceItems } from "../app/(app)/_shared/navigation.js";
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
