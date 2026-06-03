export const uiPackageName = "Uzman Hocam UI";

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
