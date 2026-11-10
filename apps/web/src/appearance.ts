export type Appearance = "plain" | "whiteboard" | "blackboard";

// Keep this function self-contained: the same code runs before paint and on user selection.
export function applyAppearance(preference?: string) {
  let appearance = preference;
  if (appearance === undefined) {
    try {
      appearance = localStorage.getItem("o-okul-appearance") ?? undefined;
      if (appearance !== "plain" && appearance !== "whiteboard" && appearance !== "blackboard") {
        appearance = localStorage.getItem("o-okul-theme") === "dark" ? "blackboard" : "whiteboard";
      }
    } catch {
      appearance = "whiteboard";
    }
  }
  if (appearance !== "plain" && appearance !== "whiteboard" && appearance !== "blackboard") {
    appearance = "whiteboard";
  }
  const theme = appearance === "blackboard" ? "dark" : "light";
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.dataset.theme = theme;
  if (preference !== undefined) {
    try {
      localStorage.setItem("o-okul-appearance", appearance);
      localStorage.setItem("o-okul-theme", theme);
    } catch {
      // A blocked storage area must not prevent the current page from changing appearance.
    }
  }
}

export const appearanceBootstrapScript = `(${applyAppearance.toString()})();`;
