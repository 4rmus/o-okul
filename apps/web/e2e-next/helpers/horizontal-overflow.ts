import { expect, type Page } from "@playwright/test";

interface HorizontalOverflowOffender {
  left: number;
  overflow: number;
  position: string;
  right: number;
  selector: string;
  transform: string;
}

export interface HorizontalOverflowMeasurement {
  offenders: HorizontalOverflowOffender[];
  rootOverflow: number;
}

export async function inspectHorizontalOverflow(page: Page): Promise<HorizontalOverflowMeasurement> {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const viewportWidth = documentElement.clientWidth;
    const rootOverflow = Math.max(
      documentElement.scrollWidth - viewportWidth,
      body.scrollWidth - body.clientWidth,
    );

    function isInsideContainedScroller(element: Element) {
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== body) {
        const style = window.getComputedStyle(ancestor);
        const rect = ancestor.getBoundingClientRect();
        if (
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          rect.left >= -1 &&
          rect.right <= viewportWidth + 1
        ) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    }

    const offenders = Array.from(document.querySelectorAll("body *"))
      .flatMap((element): HorizontalOverflowOffender[] => {
        if (element instanceof SVGElement && element.tagName.toLowerCase() !== "svg") return [];
        if (element.closest('[aria-hidden="true"], [inert]')) return [];

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0";
        if (!isVisible || isInsideContainedScroller(element)) return [];

        const overflow = Math.ceil(Math.max(rect.right - viewportWidth, 0 - rect.left, 0));
        if (overflow <= 1) return [];

        const htmlElement = element as HTMLElement;
        const className =
          typeof htmlElement.className === "string"
            ? htmlElement.className.trim().replace(/\s+/g, ".")
            : "";
        return [{
          left: Math.round(rect.left),
          overflow,
          position: style.position,
          right: Math.round(rect.right),
          selector: `${element.tagName.toLowerCase()}${htmlElement.id ? `#${htmlElement.id}` : ""}${
            className ? `.${className}` : ""
          }`,
          transform: style.transform,
        }];
      })
      .sort((left, right) => right.overflow - left.overflow)
      .slice(0, 8);

    return { offenders, rootOverflow };
  });
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const result = await inspectHorizontalOverflow(page);
  const offenderText = result.offenders
    .map(
      (item) =>
        `${item.selector} +${item.overflow}px [${item.left}..${item.right}; ${item.position}; ${item.transform}]`,
    )
    .join(", ");

  expect(
    result.rootOverflow,
    `${label}: kök yatay taşma ${result.rootOverflow}px${offenderText ? `; adaylar: ${offenderText}` : ""}`,
  ).toBeLessThanOrEqual(1);
  expect(
    result.offenders,
    `${label}: viewport dışına taşan görünür öğeler${offenderText ? `: ${offenderText}` : ""}`,
  ).toEqual([]);
}
