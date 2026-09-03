/**
 * Seasonality, from the operator guide's own breakdown of the KDP year.
 *
 * A scan is a photograph. Taken inside a niche's peak it reads as a thriving
 * market; the same niche in its trough looks dead. Neither is the truth, and
 * without this the tool would keep presenting one as the other — which is
 * exactly how a seasonal niche gets entered three months too late.
 */

export interface SeasonProfile {
  id: string;
  label: string;
  /** Terms that place a keyword in this group, in Spanish and English. */
  match: RegExp;
  /** Months of the year, 1-12, when the niche sells hardest. */
  peak: number[];
  /** Months when it goes quiet. */
  trough: number[];
  note: string;
  /** Whether the guide states this group, or it is my extrapolation. */
  source: "guía" | "inferido";
}

export const SEASON_PROFILES: SeasonProfile[] = [
  {
    id: "actividades-infantiles",
    label: "Actividades e infantil",
    match: /sopa de letras|sopas de letras|colorear|colouring|coloring|activity book|libro de actividades|pasatiempos|laberintos|mazes|word search|puzzle|crucigrama|infantil|for kids|para ni[ñn]os/i,
    peak: [6, 7, 8, 11, 12],
    trough: [2, 3, 4],
    note: "Pico en vacaciones escolares (junio-agosto) y otra vez en Navidad como regalo. Cae en primavera.",
    source: "guía",
  },
  {
    id: "bienestar",
    label: "Salud, nutrición y bienestar",
    match: /diario de entrenamiento|entrenamiento|fitness|dieta|nutrici[óo]n|yoga|bienestar|wellness|h[áa]bitos|gratitud|meditaci[óo]n|workout|meal plan|adelgaz/i,
    peak: [12, 1, 2],
    trough: [5, 6, 7, 8],
    note: "Sostenido por el «año nuevo, vida nueva»: diciembre a febrero. Las ventas caen con fuerza a partir de primavera.",
    source: "guía",
  },
  {
    id: "regalo",
    label: "Libro regalo",
    match: /curiosidades|datos divertidos|fun facts|regalo|gift|101 cosas|para regalar|humor|broma/i,
    peak: [11, 12],
    trough: [],
    note: "Vende todo el año como regalo de cumpleaños, pero se multiplica en la campaña navideña.",
    source: "guía",
  },
  {
    id: "tematico-primavera",
    label: "Temático de primavera-verano",
    match: /vitral|stained glass|jard[íi]n|garden|playa|verano|summer|mandala/i,
    peak: [2, 3, 4, 5, 6, 7, 8],
    trough: [10, 11, 12, 1],
    note: "Ciclo marcado: vende bien de febrero a agosto y se desploma el resto del año.",
    source: "guía",
  },
  {
    id: "vuelta-al-cole",
    label: "Vuelta al cole",
    match: /agenda (?:docente|escolar|del profesor)|planificador (?:docente|escolar)|cuaderno escolar|teacher planner|lesson planner|curso \d{4}|\d{4}[- ]\d{2,4}/i,
    peak: [7, 8, 9],
    trough: [1, 2, 3, 4],
    note: "Concentra casi todas sus ventas entre julio y septiembre. En primavera el mismo nicho parece muerto.",
    // The guide places school notebooks in the activities group, but a teacher's
    // planner peaks at the start of term rather than during the holidays.
    source: "inferido",
  },
];

export interface SeasonInsight {
  profile: SeasonProfile | null;
  phase: "pico" | "entrando" | "valle" | "neutro";
  headline: string;
  advice: string;
}

/** Classify a keyword and say where in its cycle today falls. */
export function seasonInsight(keyword: string, now = new Date()): SeasonInsight {
  const profile = SEASON_PROFILES.find((p) => p.match.test(keyword)) ?? null;
  if (!profile) {
    return { profile: null, phase: "neutro", headline: "", advice: "" };
  }

  const month = now.getMonth() + 1;
  const nextMonth = (month % 12) + 1;
  const phase: SeasonInsight["phase"] =
    profile.peak.includes(month) ? "pico"
    : profile.peak.includes(nextMonth) ? "entrando"
    : profile.trough.includes(month) ? "valle"
    : "neutro";

  const headline =
    phase === "pico" ? `Estás mirando este nicho en su punto más alto del año.`
    : phase === "entrando" ? `Este nicho entra en temporada alta el mes que viene.`
    : phase === "valle" ? `Estás mirando este nicho en su temporada baja.`
    : `Este nicho es estacional, y hoy no estás ni en pico ni en valle.`;

  const advice =
    phase === "pico" ? "Las cifras de hoy son el techo del año, no la media: divídelas entre dos o tres para estimar un mes normal. Y si publicas ahora, llegas tarde a esta temporada — lo sensato es preparar el título para la siguiente."
    : phase === "entrando" ? "Buen momento para publicar: llegarías con el listado indexado justo cuando arranca la demanda."
    : phase === "valle" ? "Las cifras de hoy son el suelo del año. Un nicho que parece muerto ahora puede ser excelente en temporada — vuelve a medirlo en su pico antes de descartarlo."
    : "Ten en cuenta el ciclo antes de proyectar estas cifras a doce meses.";

  return { profile, phase, headline, advice };
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function monthNames(months: number[]): string {
  return months.map((m) => MONTHS[m - 1]).join(", ");
}
