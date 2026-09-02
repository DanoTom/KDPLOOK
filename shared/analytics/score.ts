import type {
  AppSettings, BookRecord, MarketplaceId, NicheSummary, Signal, Verdict,
} from "../types";
import { salesPerMonth } from "./bsr";
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
  const sales = salesPerMonth(book.bsr, book.format, marketplace, settings.salesCurveCalibration);
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
  const pool = organic.length ? organic : items;
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
  const medianReviews = median(reviews);
  const medianBsr = median(bsrs);

  // --- demand ---------------------------------------------------------------
  let demand = avgSales !== null ? curve(avgSales, DEMAND_ANCHORS) : 0;
  if (avgSales === null && medianBsr !== null) {
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
  if (opts.totalResults !== null && opts.totalResults > 40_000) competition += 5;
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
  return summary;
}

function buildSignals(s: NicheSummary, settings: AppSettings, currency: string): Signal[] {
  const signals: Signal[] = [];
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  signals.push({
    id: "demand",
    label: "Demanda",
    value: s.avgSalesPerMonth !== null ? `${Math.round(s.avgSalesPerMonth)} ventas/mes (top 20)` : "sin datos de BSR",
    tone: s.demandScore >= 65 ? "good" : s.demandScore >= 40 ? "warn" : "bad",
    hint: "Media de ventas mensuales estimadas de los primeros resultados orgánicos.",
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

  if (s.demandScore >= 65) reasoning.push(`Hay demanda real: los primeros puestos venden ~${Math.round(s.avgSalesPerMonth ?? 0)} unidades/mes estimadas.`);
  else if (s.demandScore >= 40) reasoning.push("Demanda moderada: se vende, pero no esperes volumen alto desde el día uno.");
  else reasoning.push("Demanda baja: los libros del top rotan poco, el techo de ingresos es pequeño.");

  if (s.competitionScore <= 40) reasoning.push(`Competencia blanda: mediana de ${Math.round(s.medianReviews ?? 0)} reseñas en el top 20.`);
  else if (s.competitionScore <= 65) reasoning.push(`Competencia media: mediana de ${Math.round(s.medianReviews ?? 0)} reseñas; necesitarás portada y descripción por encima de la media.`);
  else reasoning.push(`Competencia dura: mediana de ${Math.round(s.medianReviews ?? 0)} reseñas, con títulos consolidados.`);

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
