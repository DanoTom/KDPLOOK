/** Mirrors the Worker's probe groups; kept here so the UI can sequence them. */
export type ProbeGroup =
  | "base" | "alphabetA" | "alphabetB" | "digits" | "questions" | "suffixes" | "prefixes" | "related";

/**
 * The alphabet sweep only pays off on a broad seed: "agenda a", "agenda b"…
 * completes into dozens of phrases, while "agenda psicologo a" completes into
 * nothing. Asking the operator to know that — and to pick Rápido or Profundo
 * accordingly — was making the fast mode return a single row on exactly the
 * long-tail phrases it should be best at. The neighbourhood routes go in both.
 */
export const QUICK_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB", "related"];
export const DEEP_GROUPS: ProbeGroup[] = [
  "base", "alphabetA", "alphabetB", "related", "suffixes", "prefixes", "questions", "digits",
];

export const GROUP_LABELS: Record<ProbeGroup, string> = {
  base: "Semilla",
  alphabetA: "Alfabeto A-M",
  alphabetB: "Alfabeto N-Z",
  digits: "Dígitos",
  questions: "Preguntas",
  suffixes: "Sufijos",
  prefixes: "Prefijos",
  related: "Rutas cercanas",
};
