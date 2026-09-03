import type { AppSettings, BookRecord, MarketplaceId } from "../types";

/**
 * The operator's own entry criteria, applied to a scanned niche.
 *
 * Everything here comes from the KDP field guide supplied by the publisher who
 * uses this tool, not from thresholds invented for the app. The three gates are
 * its "check verde"; the warnings are its list of niches to walk away from even
 * when the numbers look good. Each gate states the requirement it applied so
 * the reasoning stays inspectable rather than hidden inside a score.
 */

export interface Gate {
  id: "competencia" | "demanda" | "viabilidad";
  label: string;
  pass: boolean | null;
  value: string;
  requirement: string;
  detail: string;
}

export interface RedFlag {
  id: string;
  severity: "alto" | "medio";
  label: string;
  detail: string;
}

export interface ExpertReview {
  gates: Gate[];
  passed: number;
  evaluated: number;
  flags: RedFlag[];
  tone: "great" | "good" | "mixed" | "bad" | "unknown";
  headline: string;
}

/**
 * The rank below which a title makes roughly a sale a day in that storefront.
 * The guide gives .com and .es directly; the rest are extrapolated from
 * relative market size and are the weakest numbers here.
 */
const DEMAND_BSR: Partial<Record<MarketplaceId, number>> = {
  "com": 300_000, "es": 10_000, "co.uk": 66_000, "de": 60_000,
  "fr": 30_000, "it": 21_000, "ca": 24_000, "com.mx": 9_000,
  "com.br": 9_000, "co.jp": 45_000, "com.au": 15_000, "in": 12_000,
  "nl": 12_000, "pl": 6_000, "se": 6_000,
};

export function demandBsrFor(marketplace: MarketplaceId): number {
  return DEMAND_BSR[marketplace] ?? 30_000;
}

/** Results counts above which the guide considers a Spanish-market niche crowded. */
export const RESULTS_GREEN = 1_000;
export const RESULTS_LIMIT = 2_000;
/** Review counts: beatable, hard, and effectively unassailable head-on. */
export const REVIEWS_BEATABLE = 200;
export const REVIEWS_UNREACHABLE = 1_000;
/** Below this list price a low-content title cannot fund its own advertising. */
export const PRICE_WAR_BELOW = 8;
/** A rank this deep means the title is not selling at all. */
export const DEAD_BSR = 2_000_000;
/** How many selling competitors the guide wants before calling demand proven. */
export const MIN_PROVEN = 3;

export function reviewExpertise(
  items: BookRecord[],
  opts: { marketplace: MarketplaceId; totalResults: number | null; settings: AppSettings },
): ExpertReview {
  const { marketplace, totalResults } = opts;
  const demandBsr = demandBsrFor(marketplace);

  const organic = items.filter((b) => !b.sponsored).sort((a, b) => a.position - b.position);
  const page1 = organic.slice(0, 20);
  const enriched = page1.filter((b) => b.enriched && b.bsr !== null);

  // --- Gate 1: how crowded the query is -------------------------------------
  const competencia: Gate = {
    id: "competencia",
    label: "Competencia",
    pass: totalResults === null ? null : totalResults <= RESULTS_LIMIT,
    value: totalResults === null ? "sin dato" : `${totalResults.toLocaleString("es")} resultados`,
    requirement: `≤ ${RESULTS_LIMIT.toLocaleString("es")} (óptimo ≤ ${RESULTS_GREEN.toLocaleString("es")})`,
    detail:
      totalResults === null ? "Amazon no devolvió el recuento de resultados."
      : totalResults <= RESULTS_GREEN ? "Nicho verde: se puede indexar en primera página de forma orgánica."
      : totalResults <= RESULTS_LIMIT ? "Competencia baja-media: viable con algo de publicidad."
      : marketplace === "es" || marketplace === "com.mx"
        ? "Saturado para el mercado hispano. Hay que subnichar a una cola más larga."
        : "Saturado: hay que subnichar a una palabra clave de cola más larga.",
  };

  // --- Gate 2: are enough titles actually selling ---------------------------
  const selling = enriched.filter((b) => (b.bsr ?? Infinity) <= demandBsr);
  const demanda: Gate = {
    id: "demanda",
    label: "Demanda demostrada",
    pass: enriched.length === 0 ? null : selling.length >= MIN_PROVEN,
    value: enriched.length === 0 ? "sin BSR leído" : `${selling.length} de ${enriched.length} con BSR ≤ ${demandBsr.toLocaleString("es")}`,
    requirement: `≥ ${MIN_PROVEN} libros vendiendo`,
    detail:
      enriched.length === 0 ? "No se pudo leer la clasificación de ningún libro; repite el escaneo."
      : selling.length >= MIN_PROVEN ? "Hay varios competidores con ventas constantes: la demanda existe."
      : "Pocos libros venden de verdad aquí. Puede ser un término que se busca poco.",
  };

  // --- Gate 3: is the social proof beatable ---------------------------------
  const withReviews = page1.filter((b) => b.reviews !== null);
  const beatable = withReviews.filter((b) => (b.reviews ?? 0) < REVIEWS_BEATABLE);
  const allEntrenched = withReviews.length > 0 && withReviews.every((b) => (b.reviews ?? 0) > REVIEWS_UNREACHABLE);
  const viabilidad: Gate = {
    id: "viabilidad",
    label: "Viabilidad de entrada",
    pass: withReviews.length === 0 ? null : !allEntrenched && beatable.length >= MIN_PROVEN,
    value: withReviews.length === 0 ? "sin reseñas leídas" : `${beatable.length} de ${withReviews.length} con < ${REVIEWS_BEATABLE} reseñas`,
    requirement: `≥ ${MIN_PROVEN} competidores por debajo de ${REVIEWS_BEATABLE}`,
    detail:
      withReviews.length === 0 ? "No se leyó el número de reseñas."
      : allEntrenched ? `Todos superan las ${REVIEWS_UNREACHABLE.toLocaleString("es")} reseñas: la prueba social es una barrera casi insuperable de frente.`
      : beatable.length >= MIN_PROVEN ? "Hay huecos alcanzables: con 15-20 reseñas honestas se compite de tú a tú."
      : "La primera página está consolidada; entrar exige meses de posicionamiento sostenido.",
  };

  const gates = [competencia, demanda, viabilidad];
  const evaluated = gates.filter((g) => g.pass !== null).length;
  const passed = gates.filter((g) => g.pass === true).length;

  return {
    gates,
    passed,
    evaluated,
    flags: detectRedFlags(items, { marketplace, totalResults, demandBsr, selling }),
    tone:
      evaluated === 0 ? "unknown"
      : passed === 3 ? "great"
      : passed === 2 ? "good"
      : passed === 1 ? "mixed" : "bad",
    headline:
      evaluated === 0 ? "No hay datos suficientes para aplicar los criterios de entrada."
      : passed === 3 ? "Cumple los tres criterios de entrada."
      : `Cumple ${passed} de ${evaluated} criterios evaluados.`,
  };
}

/** Traps where the headline numbers look good but the niche is not enterable. */
function detectRedFlags(
  items: BookRecord[],
  ctx: { marketplace: MarketplaceId; totalResults: number | null; demandBsr: number; selling: BookRecord[] },
): RedFlag[] {
  const flags: RedFlag[] = [];
  const organic = items.filter((b) => !b.sponsored);
  const enriched = organic.filter((b) => b.enriched && b.bsr !== null);

  // One title selling while everything around it is dead means the demand is
  // being driven from outside Amazon, and standard ads will not reach it.
  if (ctx.selling.length > 0 && ctx.selling.length <= 2 && enriched.length >= 6) {
    const rest = enriched.filter((b) => !ctx.selling.includes(b));
    const dead = rest.filter((b) => (b.bsr ?? 0) > DEAD_BSR).length;
    if (dead / rest.length >= 0.7) {
      flags.push({
        id: "trafico-externo",
        severity: "alto",
        label: "Posible nicho de un solo vendedor",
        detail: "Uno o dos libros venden y el resto están muertos. Suele indicar tráfico externo (TikTok, Instagram) y no demanda nativa de Amazon: la publicidad estándar no llegaría a ese público.",
      });
    }
  }

  // Big houses outselling everyone is a fight over distribution, not metadata.
  const known = enriched.filter((b) => b.selfPublished !== null);
  const indiesSelling = ctx.selling.filter((b) => b.selfPublished === true).length;
  if (known.length >= 5 && indiesSelling < MIN_PROVEN) {
    const share = known.filter((b) => b.selfPublished).length / known.length;
    if (share < 0.4) {
      flags.push({
        id: "monopolio-editorial",
        severity: "alto",
        label: "Dominado por editoriales tradicionales",
        detail: `Solo ${indiesSelling} autor(es) independiente(s) con ventas constantes. Las editoriales grandes compiten con presupuestos y distribución física imposibles de igualar orgánicamente.`,
      });
    }
  }

  // Under about eight euros the royalty cannot absorb a click.
  const prices = organic.map((b) => b.price).filter((v): v is number => v !== null);
  if (prices.length >= 5) {
    const sorted = [...prices].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < PRICE_WAR_BELOW) {
      flags.push({
        id: "guerra-precios",
        severity: "medio",
        label: "Guerra de precios",
        detail: `Precio mediano de ${median.toFixed(2)}. Por debajo de ${PRICE_WAR_BELOW} la regalía no financia un clic de publicidad, así que dependerías de un posicionamiento orgánico inestable.`,
      });
    }
  }

  // Ads filling the top of the page means nobody survives organically.
  const firstRows = items.slice(0, 8);
  const sponsored = firstRows.filter((b) => b.sponsored).length;
  if (sponsored >= 4) {
    flags.push({
      id: "patrocinados",
      severity: "medio",
      label: "Patrocinados dominan la primera página",
      detail: `${sponsored} de los primeros ${firstRows.length} resultados son anuncios. Señal de que el tráfico orgánico no basta para sostener ventas en este término.`,
    });
  }

  if (ctx.totalResults !== null && ctx.totalResults > 50_000) {
    flags.push({
      id: "saturacion-extrema",
      severity: "alto",
      label: "Saturación extrema",
      detail: `${ctx.totalResults.toLocaleString("es")} resultados. Asomar la cabeza exigiría una inversión publicitaria que los márgenes de este tipo de libro no sostienen.`,
    });
  }

  return flags;
}
