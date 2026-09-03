import type { AppSettings, BookRecord, CategoryStats, MarketplaceId, Verdict } from "../types";

/**
 * Category metrics.
 *
 * The headline number is "sales to #1": the monthly run-rate of the book
 * currently holding the top spot, which is what a new title has to beat to
 * take the badge. It comes from that book's store-wide BSR run through the
 * sales curve — the same estimate used everywhere else in the app, with the
 * same caveats.
 */
export function summariseCategory(
  ranked: BookRecord[],
  opts: {
    node: string;
    name: string | null;
    marketplace: MarketplaceId;
    department: "print" | "kindle";
    listed: number;
    settings: AppSettings;
  },
): CategoryStats {
  const sampled = ranked.filter((book) => book.enriched);
  const at = (position: number): BookRecord | null => ranked[position - 1] ?? null;

  const prices = numbers(sampled.map((b) => b.price));
  const reviews = numbers(sampled.map((b) => b.reviews));
  const pages = numbers(sampled.map((b) => b.pages));
  const ages = numbers(sampled.map((b) => b.ageMonths));

  const knownPublisher = sampled.filter((b) => b.selfPublished !== null);
  const selfPublishedShare = knownPublisher.length
    ? knownPublisher.filter((b) => b.selfPublished).length / knownPublisher.length
    : null;
  const kindleUnlimitedShare = sampled.length
    ? sampled.filter((b) => b.kindleUnlimited).length / sampled.length
    : null;

  const stats: CategoryStats = {
    node: opts.node,
    name: opts.name,
    marketplace: opts.marketplace,
    department: opts.department,
    listed: opts.listed,
    sampled: sampled.length,
    scannedAt: Date.now(),

    salesToNumber1: at(1)?.salesPerMonth ?? null,
    salesToNumber10: at(10)?.salesPerMonth ?? null,
    salesToNumber20: at(20)?.salesPerMonth ?? null,
    bsrNumber1: at(1)?.bsr ?? null,
    bsrNumber10: at(10)?.bsr ?? null,

    selfPublishedShare: round(selfPublishedShare, 3),
    kindleUnlimitedShare: round(kindleUnlimitedShare, 3),
    avgPrice: round(mean(prices)),
    medianPrice: round(median(prices)),
    avgReviews: round(mean(reviews), 0),
    medianReviews: round(median(reviews), 0),
    avgPages: round(mean(pages), 0),
    medianAgeMonths: round(median(ages), 1),

    difficulty: 0,
    verdict: { label: "Sin datos", tone: "unknown", headline: "", reasoning: [] },
  };

  stats.difficulty = difficultyScore(stats);
  stats.verdict = buildVerdict(stats, opts.settings);
  return stats;
}

/**
 * How hard it is to reach the top 10 here. Driven by the run-rate you need to
 * displace the tenth title, then adjusted by how entrenched the incumbents look.
 */
function difficultyScore(stats: CategoryStats): number {
  const target = stats.salesToNumber10 ?? stats.salesToNumber1;
  if (target === null) return 50;

  // A category whose #10 sells a couple of copies a month is wide open;
  // one needing hundreds a month is a different sport.
  let score = curve(target, [
    [0, 4], [2, 12], [5, 22], [10, 32], [25, 45],
    [60, 58], [150, 72], [400, 86], [1000, 96], [3000, 100],
  ]);

  if (stats.medianReviews !== null) {
    score += curve(stats.medianReviews, [[0, -8], [50, -3], [200, 2], [800, 8], [3000, 14]]);
  }
  if (stats.selfPublishedShare !== null) {
    // Indies holding the list means the door is open to another one.
    score -= (stats.selfPublishedShare - 0.5) * 16;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildVerdict(stats: CategoryStats, settings: AppSettings): Verdict {
  if (stats.salesToNumber1 === null && stats.salesToNumber10 === null) {
    return {
      label: "Sin datos",
      tone: "unknown",
      headline: "No se pudo leer el BSR de los primeros puestos.",
      reasoning: ["Amplía la muestra o revisa el panel de diagnóstico: puede haber bloqueos de Amazon."],
    };
  }

  const reasoning: string[] = [];
  const toTen = stats.salesToNumber10;
  const toOne = stats.salesToNumber1;

  if (toOne !== null) {
    reasoning.push(`El #1 vende unas ${Math.round(toOne)} unidades/mes estimadas: esa es la vara para el badge de bestseller.`);
  }
  if (toTen !== null) {
    reasoning.push(`Para entrar al top 10 harían falta unas ${Math.round(toTen)} unidades/mes, algo más de ${Math.max(1, Math.round(toTen / 30.44))} al día.`);
  }
  if (stats.selfPublishedShare !== null) {
    const pct = Math.round(stats.selfPublishedShare * 100);
    reasoning.push(pct >= 50
      ? `El ${pct}% de la lista es autopublicado: KDP compite de igual a igual aquí.`
      : `Solo el ${pct}% es autopublicado; el resto son editoriales con más músculo.`);
  }
  if (stats.medianReviews !== null && stats.medianReviews < settings.weakReviewThreshold) {
    reasoning.push(`Mediana de ${Math.round(stats.medianReviews)} reseñas: los títulos de la lista aún no tienen prueba social sólida.`);
  }
  if (stats.sampled < 10) {
    reasoning.push("Muestra pequeña: amplía el número de fichas para afinar el veredicto.");
  }

  if (stats.difficulty <= 30) {
    return { label: "Excelente", tone: "great", headline: "Categoría accesible: el top 10 está al alcance de un lanzamiento cuidado.", reasoning };
  }
  if (stats.difficulty <= 50) {
    return { label: "Bueno", tone: "good", headline: "Categoría razonable si entras con producto y portada por encima de la media.", reasoning };
  }
  if (stats.difficulty <= 70) {
    return { label: "Ajustado", tone: "mixed", headline: "Exigente: entrar al top 10 requiere ventas sostenidas, no solo un buen lanzamiento.", reasoning };
  }
  return { label: "Difícil", tone: "bad", headline: "Muy competida: busca una subcategoría más específica dentro de esta rama.", reasoning };
}

// --- helpers ----------------------------------------------------------------

function numbers(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
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

function curve(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    if (value <= anchors[i][0]) {
      const [x0, y0] = anchors[i - 1];
      const [x1, y1] = anchors[i];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}
