import type { AppSettings, BookRecord, MarketplaceId } from "../types";
import type { ContentProfile, ContentType } from "./content";
import { isPublishableBook } from "./book";
import { CONTENT_PROFILES, inferContentType } from "./content";

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
  id: "competencia" | "demanda" | "viabilidad" | "precio";
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
  /** Which of the three businesses this niche is, and its own numbers. */
  profile: ContentProfile;
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
/** The guide's floor for a healthy royalty once printing is paid. */
export const PRICE_HEALTHY = 9.99;
/**
 * Average ratings below this do not mean weak rivals. In visually demanding
 * niches — detailed illustration, photography, coin or stamp catalogues — it
 * means KDP's own paper cannot render the book well, and buyers say so in
 * one-star reviews. The next publisher in gets the same treatment.
 */
export const RATING_TECHNICAL = 4.1;
/** A rank this deep means the title is not selling at all. */
export const DEAD_BSR = 2_000_000;
/** How many selling competitors the guide wants before calling demand proven. */
export const MIN_PROVEN = 3;

/**
 * The rank the rest of the field has to reach, as a multiple of the daily-sale
 * threshold.
 *
 * Asking for three books under the daily-sale rank was a US-shaped
 * expectation. Spain is a much smaller market: two real scans of live Spanish
 * niches came back with zero books under BSR 10.000 — the best was 15.726 — so
 * that bar fails almost every Spanish niche and the tool would only ever say
 * no. A healthy niche is better described in two parts: a leader who does sell
 * daily, and a peloton around three times deeper that sells weekly. Under
 * either one alone there is no market to enter.
 */
const PELOTON_MULTIPLE = 3;

export function reviewExpertise(
  items: BookRecord[],
  opts: {
    marketplace: MarketplaceId; totalResults: number | null; settings: AppSettings;
    /** Overrides what the niche's own page counts and prices imply. */
    contentType?: ContentType;
  },
): ExpertReview {
  const { marketplace, totalResults } = opts;
  const demandBsr = demandBsrFor(marketplace);
  // A journal, a puzzle book and a non-fiction guide are judged on different
  // numbers. Read which one this niche is rather than applying one set to all.
  const profile = CONTENT_PROFILES[opts.contentType ?? inferContentType(items)];

  // Commercial stationery is not a rival to beat: a Finocam diary at BSR 59
  // would satisfy "demanda demostrada" while telling a publisher nothing.
  const organic = items
    .filter((b) => !b.sponsored && isPublishableBook(b))
    .sort((a, b) => a.position - b.position);
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
  // Two halves: somebody selling every day, and a field behind them selling
  // every week. `selling` stays the daily bar — the red flags below reason
  // about who is genuinely moving copies.
  const peloton = demandBsr * PELOTON_MULTIPLE;
  const selling = enriched.filter((b) => (b.bsr ?? Infinity) <= demandBsr);
  const steady = enriched.filter((b) => (b.bsr ?? Infinity) <= peloton);
  const leader = enriched.length ? Math.min(...enriched.map((b) => b.bsr ?? Infinity)) : Infinity;
  const hasLeader = leader <= demandBsr;
  const demanda: Gate = {
    id: "demanda",
    label: "Demanda demostrada",
    pass: enriched.length === 0 ? null : hasLeader && steady.length >= MIN_PROVEN,
    value: enriched.length === 0 ? "sin BSR leído"
      : `${steady.length} de ${enriched.length} con BSR ≤ ${peloton.toLocaleString("es")}` +
        (hasLeader ? `, el mejor en ${leader.toLocaleString("es")}` : ""),
    requirement: `≥ ${MIN_PROVEN} vendiendo cada semana y uno que venda a diario (BSR ≤ ${demandBsr.toLocaleString("es")})`,
    detail:
      enriched.length === 0 ? "No se pudo leer la clasificación de ningún libro; repite el escaneo."
      : hasLeader && steady.length >= MIN_PROVEN ? "Hay un líder vendiendo a diario y un pelotón detrás con ventas semanales: el nicho mueve dinero."
      : !hasLeader && steady.length >= MIN_PROVEN ? `Se vende, pero nadie baja de ${demandBsr.toLocaleString("es")}: ninguno vende a diario. El techo de ingresos es bajo.`
      : hasLeader ? "Un libro vende bien y detrás no hay nadie: mira si el nicho depende de un solo vendedor."
      : "Pocos libros venden de verdad aquí. Puede ser un término que se busca poco.",
  };

  // --- Gate 3: is the social proof beatable ---------------------------------
  const withReviews = page1.filter((b) => b.reviews !== null);
  const beatable = withReviews.filter((b) => (b.reviews ?? 0) < profile.beatableReviews);
  const allEntrenched = withReviews.length > 0 && withReviews.every((b) => (b.reviews ?? 0) > REVIEWS_UNREACHABLE);
  const viabilidad: Gate = {
    id: "viabilidad",
    label: "Viabilidad de entrada",
    pass: withReviews.length === 0 ? null : !allEntrenched && beatable.length >= MIN_PROVEN,
    value: withReviews.length === 0 ? "sin reseñas leídas" : `${beatable.length} de ${withReviews.length} con < ${profile.beatableReviews} reseñas`,
    requirement: `≥ ${MIN_PROVEN} competidores por debajo de ${profile.beatableReviews} (${profile.label.toLowerCase()})`,
    detail:
      withReviews.length === 0 ? "No se leyó el número de reseñas."
      : allEntrenched ? `Todos superan las ${REVIEWS_UNREACHABLE.toLocaleString("es")} reseñas: la prueba social es una barrera casi insuperable de frente.`
      : beatable.length >= MIN_PROVEN ? "Hay huecos alcanzables: con 15-20 reseñas honestas se compite de tú a tú."
      : "La primera página está consolidada; entrar exige meses de posicionamiento sostenido.",
  };

  // --- Gate 4: does the niche's price leave a royalty ------------------------
  const pagePrices = page1.map((b) => b.price).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const medianPrice = pagePrices.length ? pagePrices[Math.floor(pagePrices.length / 2)] : null;
  const precio: Gate = {
    id: "precio",
    label: "Precio del nicho",
    pass: medianPrice === null ? null : medianPrice >= profile.priceFloor,
    value: medianPrice === null ? "sin precios leídos" : `${medianPrice.toFixed(2)} de mediana`,
    requirement: `≥ ${profile.priceFloor.toFixed(2)} (${profile.label.toLowerCase()})`,
    detail:
      medianPrice === null ? "No se leyó ningún precio."
      : medianPrice >= profile.priceFloor ? `El nicho soporta el precio que pide un ${profile.label.toLowerCase()}: la regalía puede financiar publicidad.`
      : `Por debajo de ${profile.priceFloor.toFixed(2)} la regalía se queda corta para un ${profile.label.toLowerCase()} una vez pagada la impresión, y no da para pujar por un clic.`,
  };

  const gates = [competencia, demanda, viabilidad, precio];
  const evaluated = gates.filter((g) => g.pass !== null).length;
  const passed = gates.filter((g) => g.pass === true).length;

  return {
    gates,
    passed,
    evaluated,
    profile,
    flags: detectRedFlags(items, { marketplace, totalResults, demandBsr, selling, page1 }),
    tone:
      evaluated === 0 ? "unknown"
      : passed === evaluated ? "great"
      : passed >= evaluated - 1 ? "good"
      : passed > 0 ? "mixed" : "bad",
    headline:
      evaluated === 0 ? "No hay datos suficientes para aplicar los criterios de entrada."
      : passed === 3 ? "Cumple los tres criterios de entrada."
      : `Cumple ${passed} de ${evaluated} criterios evaluados.`,
  };
}

/** Traps where the headline numbers look good but the niche is not enterable. */
function detectRedFlags(
  items: BookRecord[],
  ctx: {
    marketplace: MarketplaceId; totalResults: number | null; demandBsr: number;
    selling: BookRecord[]; page1: BookRecord[];
  },
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

  // The "Hábitos Atómicos" effect: the term is searched, and every sale under
  // it belongs to a brand. Distinct from a publisher monopoly — plenty of
  // indies can be present, they just do not sell. This is the shape of a
  // keyword that gets typed constantly and bought by nobody new.
  const sellingIndies = ctx.selling.filter((b) => b.selfPublished === true);
  if (ctx.selling.length >= MIN_PROVEN && sellingIndies.length === 0) {
    flags.push({
      id: "marca-monopoliza",
      severity: "alto",
      label: "Las búsquedas se las lleva una marca",
      detail: "Se vende aquí, pero ningún autor independiente está entre los que venden: el volumen pertenece a un título de marca y quien busca ya sabe qué libro quiere. Publicar aquí da impresiones y ninguna compra.",
    });
  }

  // A niche whose sellers average under 4.1 stars is usually one KDP paper
  // cannot print well — not a niche of weak rivals waiting to be beaten.
  const rated = ctx.selling.filter((b) => b.rating !== null);
  if (rated.length >= 3) {
    const avg = rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length;
    if (avg < RATING_TECHNICAL) {
      flags.push({
        id: "dificultad-tecnica",
        severity: "medio",
        label: "Nicho difícil de imprimir bien",
        detail: `Los que venden promedian ${avg.toFixed(1)}★. Cuando las valoraciones bajan de ${RATING_TECHNICAL} en un nicho visual, suele ser el papel de KDP el que no da la calidad que el comprador espera — y el siguiente en publicar se lleva las mismas reseñas de una estrella.`,
      });
    }
  }

  // A subject with no book older than a couple of years is a fashion, not a
  // market: the asset stops earning when the fashion passes.
  const dated = ctx.page1.filter((b) => b.enriched && b.ageMonths !== null);
  if (dated.length >= 5 && dated.every((b) => (b.ageMonths ?? 0) < 24)) {
    flags.push({
      id: "moda-pasajera",
      severity: "medio",
      label: "Sin catálogo consolidado",
      detail: "Ningún libro de la primera página pasa de dos años. Un tema sin fondo de catálogo suele ser una moda: funciona unos meses y después el libro deja de venderse para siempre.",
    });
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
