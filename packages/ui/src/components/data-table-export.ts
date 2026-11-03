/**
 * Ekranda görünen tablo hücrelerinin metin anlık görüntüsü (DEC-20261102-08 tablo dışa aktarma).
 *
 * Dışa aktarma veriyi yeniden çekmez ve satır verisinden yeniden biçimlendirmez: DataTable'ın o an çizdiği başlık
 * ve hücre metnini okur. Böylece dosya ekrandaki biçimin aynısıdır; maskeli TC ve telefon maskeli kalır. Seçim
 * kutusu ve işlem sütunu, düğme ve ikon içerikleri, gizli öğeler ve mobil ayrıntı satırları alınmaz. Bir hücre
 * içindeki öğe `data-export-value` taşıyorsa (örneğin "Göster" ile açılabilen bir değer) yalnız o değer yazılır.
 */
export interface DataTableSnapshot {
  headers: string[];
  rows: string[][];
}

export interface ReadDataTableSnapshotOptions {
  /** Dışa aktarılmayacak ek sütun anahtarları; seçim ve "actions" sütunları her zaman dışarıda kalır. */
  excludeColumnKeys?: readonly string[];
}

const alwaysExcludedColumnKeys = ["__select", "actions"];
const skippedElementSelector = "button, svg, input, select, textarea, [hidden], [aria-hidden='true'], .uh-visually-hidden, [data-export-skip]";

export function readDataTableSnapshot(table: HTMLTableElement, options: ReadDataTableSnapshotOptions = {}): DataTableSnapshot {
  const excluded = new Set([...alwaysExcludedColumnKeys, ...(options.excludeColumnKeys ?? [])]);
  const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>(":scope > thead > tr > th[data-column-key]"))
    .filter((cell) => !excluded.has(cell.dataset.columnKey ?? ""));
  const columnKeys = headerCells.map((cell) => cell.dataset.columnKey ?? "");
  const bodyRows = Array.from(table.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr"))
    .filter((row) => row.dataset.mobileDetail !== "true" && row.dataset.state === undefined);

  return {
    headers: headerCells.map(readCellText),
    rows: bodyRows.map((row) => columnKeys.map((key) => {
      const cell = Array.from(row.cells).find((candidate) => candidate.dataset.columnKey === key);
      return cell ? readCellText(cell) : "";
    })),
  };
}

function readCellText(cell: HTMLTableCellElement): string {
  return collectText(cell).replace(/\s+/g, " ").trim();
}

function collectText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const exportValue = element.getAttribute("data-export-value");
  if (exportValue !== null) return ` ${exportValue} `;
  if (element.matches(skippedElementSelector)) return "";
  const text = Array.from(element.childNodes).map(collectText).join("");
  // Blok öğeler (satır içi liste, rozet grubu) ekranda ayrı satırda görünür; metinleri birbirine yapışmasın.
  return element.tagName === "BR" || element.tagName === "DIV" || element.tagName === "LI" || element.tagName === "P" ? ` ${text} ` : text;
}
