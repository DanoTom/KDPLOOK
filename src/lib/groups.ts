/** Mirrors the Worker's probe groups; kept here so the UI can sequence them. */
export type ProbeGroup =
  | "base" | "alphabetA" | "alphabetB" | "digits" | "questions" | "suffixes" | "prefixes" | "related";

export const QUICK_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB"];
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
