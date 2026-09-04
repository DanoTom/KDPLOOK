import type {
  AppSettings, BookRecord, MarketplaceId, NicheSummary, Signal, Verdict,
} from "../types";
import { calibrationFor, salesPerMonth } from "./bsr";
import { RESULTS_GREEN, RESULTS_LIMIT, reviewExpertise } from "./checklist";
import { isPublishableBook } from "./book";
import { estimateRoyaltyPerUnit } from "./royalty";
import { currencySymbolFor } from "../currency";

/** Months elapsed since an ISO date, or null when the date is unknown. */
export function monthsSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(then)) return null;
  const months = (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
  return months < 0 ? 0 : Math.round(months * 10) / 10;
}

/** Fill in every derived metric on a book we have search + detail data for. */
export function deriveMetrics(
  book: BookRecord,
  marketplace: MarketplaceId,
  settings: AppSettings,
): BookRecord {
  const sales = salesPerMonth(book.bsr, book.format, marketplace, calibrationFor(settings, marketplace));
  const royalty = estimateRoyaltyPerUnit(book.price, book.pages, book.format, settings.printing);
  const revenue = sales !== null && royalty !== null ? Math.round(sales * royalty * 100) / 100 : null;
  const ageMonths = monthsSince(book.publishedAt);

  return {
    ...book,
    salesPerMonth: sales,
    royaltyPerUnit: royalty,
    revenuePerMonth: revenue,
    ageMonths,
    weakness: weaknessScore(book, ageMonths, settings),
  };
}

/**
 * How beatable a single competitor looks, 0-100. Few reviews, a mediocre
 * rating, an old listing and a self-published imprint all mean there is room
 * to out-publish it.
 */
function weaknessScore(book: BookRecord, ageMonths: number | null, settings: AppSettings): number | null {
  if (book.reviews === null && book.rating === null && book.bsr === null) return null;
  let score = 50;

  const reviews = book.reviews ?? 0;
  if (reviews < 10) score += 26;
  else if (reviews < settings.weakReviewThreshold) score += 16;
  else if (reviews < 200) score += 4;
  else if (reviews < 800) score -= 12;
  else if (reviews < 3000) score -= 22;
  else score -= 30;

  if (book.rating !== null) {
    if (book.rating < 3.9) score += 14;
    else if (book.rating < 4.3) score += 6;
    else if (book.rating >= 4.7) score -= 8;
  }

  if (ageMonths !== null) {
    if (ageMonths > 60) score += 8;
    else if (ageMonths < 6) score -= 6;
  }

  if (book.selfPublished === true) score += 8;
  else if (book.selfPublished === false) score -= 10;

  if (!book.image) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// --- aggregate helpers -------------------------------------------------------

function nums(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Piecewise-linear mapping through a table of [input, output] anchors. */
function curve(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    if (value <= anchors[i][0]) {
      const [x0, y0] = anchors[i - 1];
      const [x1, y1] = anchors[i];
      const t = (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

const DEMAND_ANCHORS: Array<[number, number]> = [
  [0, 0], [1, 8], [3, 18], [6, 28], [12, 40], [25, 52],
  [50, 65], [100, 76], [200, 86], [400, 94], [800, 100],
];

/**
 * Competition implied by the size of the result set alone, on the operator's
 * thresholds. A floor rather than an addition: however weak the books on page
 * one look, ten thousand of them is not a quiet niche.
 */
const RESULTS_ANCHORS: Array<[number, number]> = [
  [0, 0], [200, 18], [RESULTS_GREEN, 34], [RESULTS_LIMIT, 52],
  [5_000, 70], [10_000, 78], [25_000, 87], [60_000, 94], [150_000, 100],
];

const COMPETITION_ANCHORS: Array<[number, number]> = [
  [0, 4], [10, 14], [25, 24], [50, 34], [100, 44], [250, 57],
  [500, 68], [1000, 78], [2500, 88], [6000, 95], [15000, 100],
];

export interface ScoreOptions {
  keyword: string;
  marketplace: MarketplaceId;
  settings: AppSettings;
  totalResults: number | null;
  resultsCountText: string | null;
}

export function summariseNiche(items: BookRecord[], opts: ScoreOptions): NicheSummary {
  const { settings, marketplace, keyword } = opts;
  const organic = items.filter((b) => !b.sponsored);
  const everything = organic.length ? organic : items;
  // Stationery stays in the table — it is on the shelf and worth seeing — but
  // out of every figure that describes the market for a publisher.
  const nonBooks = everything.filter((b) => !isPublishableBook(b));
  const pool = everything.filter(isPublishableBook);
  // The first page is what shoppers actually see, so scoring leans on it.
  const top = pool.slice(0, 20);
  const enriched = pool.filter((b) => b.enriched);

  const prices = nums(top.map((b) => b.price));
  const ratings = nums(top.map((b) => b.rating));
  const reviews = nums(top.map((b) => b.reviews));
  const bsrs = nums(top.map((b) => b.bsr));
  const sales = nums(top.map((b) => b.salesPerMonth));
  const revenues = nums(top.map((b) => b.revenuePerMonth));
  const pages = nums(enriched.map((b) => b.pages));
  const ages = nums(enriched.map((b) => b.ageMonths));

  const knownPublisher = enriched.filter((b) => b.selfPublished !== null);
  const selfPublishedShare = knownPublisher.length
    ? knownPublisher.filter((b) => b.selfPublished).length / knownPublisher.length
    : null;

  const lowReviewShare = top.length
    ? top.filter((b) => (b.reviews ?? 0) < settings.weakReviewThreshold).length / top.length
    : null;

  const freshShare = ages.length
    ? ages.filter((a) => a <= 18).length / ages.length
    : null;

  const avgSales = mean(sales);
  const medianSales = median(sales);
  const medianReviews = median(reviews);
  const medianBsr = median(bsrs);

  // --- demand ---------------------------------------------------------------
  // The median, not the mean: one runaway bestseller among the results would
  // otherwise make a slow niche look like a busy one.
  let demand = medianSales !== null ? curve(medianSales, DEMAND_ANCHORS) : 0;
  if (medianSales === null && medianBsr !== null) {
    // No royalty data but we do have ranks: fall back to a BSR-only read.
    demand = curve(1 / Math.max(1, medianBsr / 50_000), [[0, 0], [0.1, 15], [0.5, 40], [1, 60], [3, 80], [10, 95]]);
  }
  if (opts.totalResults !== null && opts.totalResults < 60) {
    // A near-empty result set usually means nobody is searching for this.
    demand *= 0.7;
  }

  // --- competition ----------------------------------------------------------
  let competition = medianReviews !== null ? curve(medianReviews, COMPETITION_ANCHORS) : 50;
  const avgRating = mean(ratings);
  if (avgRating !== null) {
    if (avgRating >= 4.7) competition += 5;
    else if (avgRating < 4.2) competition -= 6;
  }
  if (selfPublishedShare !== null) {
    // Indies on page one means the door is open; big houses mean it is not.
    competition -= (selfPublishedShare - 0.5) * 18;
  }
  if (freshShare !== null && freshShare > 0.35) competition -= 6;
  // How many books are already fighting for the term. The operator's own
  // criteria call under 1,000 a green niche, 1,000-2,000 workable with a small
  // ad budget, and over 2,000 saturated — but this only nudged the score past
  // 40,000, twenty times that limit. A term with 10,000 competitors could come
  // out "Bueno" while the entry gates on the same screen failed it.
  if (opts.totalResults !== null) {
    competition = Math.max(competition, curve(opts.totalResults, RESULTS_ANCHORS));
  }
  competition = Math.max(0, Math.min(100, competition));

  // --- opportunity ----------------------------------------------------------
  let opportunity = demand * 0.55 + (100 - competition) * 0.45;
  if (lowReviewShare !== null) opportunity += (lowReviewShare - 0.4) * 16;
  if (selfPublishedShare !== null) opportunity += (selfPublishedShare - 0.4) * 12;
  if (freshShare !== null) opportunity += (freshShare - 0.25) * 8;
  opportunity = Math.max(0, Math.min(100, opportunity));

  const confidence: NicheSummary["confidence"] =
    enriched.length >= 15 ? "high" : enriched.length >= 7 ? "medium" : "low";
  if (confidence === "low") opportunity = opportunity * 0.92 + 4; // pull toward neutral

  const summary: NicheSummary = {
    keyword,
    marketplace,
    scannedAt: Date.now(),
    resultsCountText: opts.resultsCountText,
    totalResults: opts.totalResults,
    analysed: pool.length,
    enriched: enriched.length,

    demandScore: Math.round(demand),
    competitionScore: Math.round(competition),
    opportunityScore: Math.round(opportunity),
    confidence,

    avgPrice: round(mean(prices)),
    medianPrice: round(median(prices)),
    avgRating: round(avgRating, 2),
    avgReviews: round(mean(reviews), 0),
    medianReviews: round(medianReviews, 0),
    medianBsr: round(medianBsr, 0),
    avgSalesPerMonth: round(avgSales, 1),
    medianSalesPerMonth: round(medianSales, 1),
    avgRevenuePerMonth: round(mean(revenues), 2),
    totalRevenuePerMonth: revenues.length ? round(revenues.reduce((a, b) => a + b, 0), 2) : null,
    selfPublishedShare: round(selfPublishedShare, 3),
    lowReviewShare: round(lowReviewShare, 3),
    freshShare: round(freshShare, 3),
    avgPages: round(mean(pages), 0),
    medianAgeMonths: round(median(ages), 1),

    verdict: { label: "Sin datos", tone: "unknown", headline: "", reasoning: [] },
    signals: [],
  };

  summary.signals = buildSignals(summary, settings, currencySymbolFor(marketplace));
  summary.verdict = buildVerdict(summary, settings);
  // The entry criteria are the operator's own, shown on the same screen. A
  // headline that reads "Excelente" while one of them fails is the app
  // contradicting itself, and the gate is the one that gets acted on.
  summary.verdict = capByGates(
    summary.verdict,
    reviewExpertise(items, { marketplace, totalResults: opts.totalResults, settings }),
  );

  // Stationery on page one is a finding, not noise to hide: it is shelf space a
  // self-published book cannot take, whatever the rest of the numbers say.
  if (nonBooks.length) {
    const share = nonBooks.length / (pool.length + nonBooks.length);
    summary.signals.push({
      id: "nonbooks",
      label: "No son libros KDP",
      value: `${nonBooks.length} de ${pool.length + nonBooks.length}`,
      tone: share >= 0.3 ? "bad" : "warn",
      hint: "Agendas y cuadernos comerciales (Finocam, Kokonote…): sin páginas ni editorial en su ficha. Ocupan la primera página pero no son competencia que puedas desplazar, así que quedan fuera de las cifras del nicho.",
    });
    if (share >= 0.25) {
      summary.verdict.reasoning.push(
        `${nonBooks.length} de los ${pool.length + nonBooks.length} resultados son papelería comercial, no libros: ` +
        `te quitan sitio en la primera página aunque no compitan contigo.`,
      );
    }
  }

  // A book published weeks ago holds a rank that reflects its launch, not a
  // rhythm, so the curve reads it as selling more than it does. One such title
  // is noise; several of them are the demand figure above being inflated, and
  // that is worth saying before anyone decides to enter on the strength of it.
  const dated = enriched.filter((b) => b.ageMonths !== null);
  const launches = dated.filter((b) => (b.ageMonths as number) < 2);
  if (dated.length >= 4 && launches.length / dated.length >= 0.25) {
    summary.signals.push({
      id: "launches",
      label: "Recién publicados",
      value: `${launches.length} de ${dated.length}`,
      tone: "warn",
      hint: "Llevan menos de dos meses a la venta. Su BSR todavía refleja el empujón del lanzamiento, así que sus ventas estimadas —y con ellas la demanda del nicho— salen altas.",
    });
    summary.verdict.reasoning.push(
      `${launches.length} de los ${dated.length} libros con fecha llevan menos de dos meses publicados: la demanda estimada está tirando hacia arriba.`,
    );
  }

  return summary;
}

function buildSignals(s: NicheSummary, settings: AppSettings, currency: string): Signal[] {
  const signals: Signal[] = [];
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  signals.push({
    id: "demand",
    label: "Demanda",
    value: s.medianSalesPerMonth !== null ? `${Math.round(s.medianSalesPerMonth)} ventas/mes (mediana)` : "sin datos de BSR",
    tone: s.demandScore >= 65 ? "good" : s.demandScore >= 40 ? "warn" : "bad",
    hint: "Mediana de ventas mensuales estimadas del top orgánico. Se usa la mediana porque una sola superventa distorsiona la media.",
  });

  signals.push({
    id: "reviews",
    label: "Reseñas medianas",
    value: s.medianReviews !== null ? String(Math.round(s.medianReviews)) : "—",
    tone: s.medianReviews === null ? "neutral" : s.medianReviews < settings.weakReviewThreshold ? "good" : s.medianReviews < 400 ? "warn" : "bad",
    hint: `Por debajo de ${settings.weakReviewThreshold} reseñas un libro nuevo puede alcanzar a la competencia en meses.`,
  });

  signals.push({
    id: "selfpub",
    label: "Autopublicados",
    value: pct(s.selfPublishedShare),
    tone: s.selfPublishedShare === null ? "neutral" : s.selfPublishedShare >= 0.5 ? "good" : s.selfPublishedShare >= 0.25 ? "warn" : "bad",
    hint: "Proporción de la primera página publicada de forma independiente. Alto = KDP compite de igual a igual.",
  });

  signals.push({
    id: "weak",
    label: "Rivales flojos",
    value: pct(s.lowReviewShare),
    tone: s.lowReviewShare === null ? "neutral" : s.lowReviewShare >= 0.5 ? "good" : s.lowReviewShare >= 0.3 ? "warn" : "bad",
    hint: `Porcentaje del top 20 con menos de ${settings.weakReviewThreshold} reseñas.`,
  });

  signals.push({
    id: "fresh",
    label: "Libros recientes",
    value: pct(s.freshShare),
    tone: s.freshShare === null ? "neutral" : s.freshShare >= 0.35 ? "good" : s.freshShare >= 0.15 ? "warn" : "bad",
    hint: "Publicados en los últimos 18 meses. Si hay varios, el nicho todavía admite entrantes.",
  });

  signals.push({
    id: "price",
    label: "Precio mediano",
    value: s.medianPrice !== null ? `${currency}${s.medianPrice.toFixed(2)}` : "—",
    tone: s.medianPrice === null ? "neutral" : s.medianPrice >= 9 ? "good" : s.medianPrice >= 6 ? "warn" : "bad",
    hint: "Techo de precio de la categoría; marca cuánta regalía por unidad puedes aspirar a cobrar.",
  });

  signals.push({
    id: "saturation",
    label: "Resultados totales",
    value: s.totalResults !== null ? s.totalResults.toLocaleString("es") : "—",
    tone: s.totalResults === null ? "neutral" : s.totalResults < 2000 ? "good" : s.totalResults < 20000 ? "warn" : "bad",
    hint: "Cuántos libros compiten por esta consulta. Menos de ~2.000 es un nicho manejable.",
  });

  return signals;
}

/** Verdict labels from best to worst, so a cap is a step down the list. */
const VERDICT_ORDER: Array<Verdict["label"]> = ["Excelente", "Bueno", "Ajustado", "Difícil"];

const VERDICT_TONE: Record<Verdict["label"], Verdict["tone"]> = {
  "Excelente": "great", "Bueno": "good", "Ajustado": "mixed", "Difícil": "bad", "Sin datos": "unknown",
};

/**
 * Hold the headline to what the entry criteria allow.
 *
 * The score weighs everything together and can come out warm on a niche the
 * criteria reject outright — too many competing books, no proven demand, no
 * beatable rival. Those are pass/fail conditions the publisher set, not
 * ingredients, so a failed one lowers the verdict rather than being averaged
 * away. It never raises one: a niche the gates like can still be a bad idea.
 */
function capByGates(verdict: Verdict, review: ReturnType<typeof reviewExpertise>): Verdict {
  if (verdict.label === "Sin datos") return verdict;

  const failed = review.gates.filter((gate) => gate.pass === false);
  const severe = review.flags.filter((flag) => flag.severity === "alto");
  if (!failed.length && !severe.length) return verdict;

  // One failed gate holds it below "Excelente"; two below "Bueno"; all three
  // leave nothing to recommend. A high-severity warning costs one step too.
  const steps = Math.min(3, failed.length + (severe.length ? 1 : 0));
  const current = VERDICT_ORDER.indexOf(verdict.label as Verdict["label"]);
  const capped = VERDICT_ORDER[Math.min(VERDICT_ORDER.length - 1, Math.max(current, steps))];
  if (capped === verdict.label) return verdict;

  const reasons = failed.map((gate) => gate.label.toLowerCase());
  if (severe.length) reasons.push(severe[0].label.toLowerCase());
  return {
    ...verdict,
    label: capped,
    tone: VERDICT_TONE[capped],
    reasoning: [
      ...verdict.reasoning,
      `Rebajado de «${verdict.label}» a «${capped}»: no cumple ${reasons.join(" ni ")}. ` +
      `Las cifras acompañan, pero tus propios criterios de entrada dicen que no.`,
    ],
  };
}

function buildVerdict(s: NicheSummary, settings: AppSettings): Verdict {
  if (s.analysed === 0) {
    return {
      label: "Sin datos",
      tone: "unknown",
      headline: "No se pudieron leer resultados para esta búsqueda.",
      reasoning: ["Revisa el panel de diagnóstico: puede ser un bloqueo de Amazon o una palabra clave sin resultados."],
    };
  }

  const reasoning: string[] = [];
  const score = s.opportunityScore;
  // Demand rests entirely on BSR. Without it there is nothing to say, and
  // saying "low demand" would report a scraping failure as a market finding.
  const hasDemandData = s.medianSalesPerMonth !== null || s.medianBsr !== null;

  if (!hasDemandData) {
    reasoning.push(
      `No se pudo leer el BSR de ningún libro (${s.enriched} de ${s.analysed} fichas), así que la demanda no se ha medido: ` +
      "esto es un bloqueo de Amazon, no una señal del nicho. Reintenta más tarde o baja el paralelismo en Ajustes.",
    );
  } else if (s.demandScore >= 65) {
    reasoning.push(`Hay demanda real: la mediana del top vende ~${Math.round(s.medianSalesPerMonth ?? 0)} unidades/mes estimadas.`);
  } else if (s.demandScore >= 40) {
    reasoning.push("Demanda moderada: se vende, pero no esperes volumen alto desde el día uno.");
  } else {
    reasoning.push("Demanda baja: los libros del top rotan poco, el techo de ingresos es pequeño.");
  }

  if (s.medianReviews === null) {
    reasoning.push("Sin datos de reseñas suficientes para medir la competencia.");
  } else if (s.competitionScore <= 40) {
    reasoning.push(`Competencia blanda: mediana de ${Math.round(s.medianReviews)} reseñas en el top 20.`);
  } else if (s.competitionScore <= 65) {
    reasoning.push(`Competencia media: mediana de ${Math.round(s.medianReviews)} reseñas; necesitarás portada y descripción por encima de la media.`);
  } else {
    reasoning.push(`Competencia dura: mediana de ${Math.round(s.medianReviews)} reseñas, con títulos consolidados.`);
  }

  // A handful of readable listings cannot support a verdict either way.
  if (!hasDemandData || s.enriched < 3) {
    return {
      label: "Sin datos",
      tone: "unknown",
      headline: "Escaneo incompleto: Amazon bloqueó casi todas las fichas, no hay base para un veredicto.",
      reasoning,
    };
  }

  if (s.selfPublishedShare !== null && s.selfPublishedShare >= 0.5) {
    reasoning.push("La primera página está dominada por autopublicados, señal de que KDP puede posicionar aquí.");
  } else if (s.selfPublishedShare !== null && s.selfPublishedShare < 0.25) {
    reasoning.push("Predominan editoriales tradicionales; ganar espacio orgánico será lento.");
  }

  if (s.lowReviewShare !== null && s.lowReviewShare >= 0.5) {
    reasoning.push(`El ${Math.round(s.lowReviewShare * 100)}% del top tiene menos de ${settings.weakReviewThreshold} reseñas: hay huecos alcanzables.`);
  }

  if (s.medianPrice !== null && s.medianPrice < 6) {
    reasoning.push("Precios medianos bajos: la regalía por unidad será ajustada, sobre todo en tapa blanda con muchas páginas.");
  }

  if (s.confidence === "low") {
    reasoning.push("Confianza baja: se enriquecieron pocos libros con datos de BSR. Amplía el enriquecimiento para afinar el veredicto.");
  }

  if (score >= 72) {
    return { label: "Excelente", tone: "great", headline: "Nicho con hueco claro: demanda sostenida y competencia batible.", reasoning };
  }
  if (score >= 58) {
    return { label: "Bueno", tone: "good", headline: "Nicho viable si entras con un producto por encima de la media.", reasoning };
  }
  if (score >= 44) {
    return { label: "Ajustado", tone: "mixed", headline: "Se puede, pero el margen de error es pequeño: afina ángulo y portada.", reasoning };
  }
  return { label: "Difícil", tone: "bad", headline: "Mejor buscar un ángulo más específico o una palabra clave vecina.", reasoning };
}
