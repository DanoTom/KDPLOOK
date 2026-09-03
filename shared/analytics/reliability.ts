import type { RankPoint } from "../types";

/**
 * Whether a BSR snapshot can be read as a monthly run rate.
 *
 * Every BSR→ventas curve in existence — this one, KDSpy's, Publisher Rocket's —
 * answers the same question: "a book that holds this rank steadily sells about
 * this much". The word doing the work is *steadily*. Amazon's rank is a decaying
 * weighted average of recent orders, so on a title with almost no history a
 * single sale can produce a startlingly good rank for a day or two, and ads pay
 * for exactly that kind of burst. Multiplying that snapshot by 30 invents a
 * month that never happened.
 *
 * This module does not correct the estimate — there is nothing to correct it
 * with — it says out loud when the estimate's own assumption does not hold, so
 * the number is read as a ceiling instead of a forecast.
 */

export type ReliabilityLevel = "solida" | "provisional" | "techo";

export interface SustainedRead {
  /** Median of the observed ranks: what the book holds, not what it touched. */
  medianBsr: number;
  bestBsr: number;
  worstBsr: number;
  samples: number;
  spanDays: number;
  /** worst / best. A wide swing means one reading lands anywhere in the band. */
  swing: number;
}

export interface EstimateReliability {
  level: ReliabilityLevel;
  label: string;
  tone: "good" | "warn" | "bad";
  /** Why the snapshot does or does not represent a sustained rate. */
  reasons: string[];
  /** What would make it measurable. */
  advice: string | null;
  /** Plausible band around the point estimate, as multipliers of it. */
  lowFactor: number;
  highFactor: number;
  /** The rank series, when the book has been followed long enough to have one. */
  sustained: SustainedRead | null;
}

export interface ReliabilityInput {
  bsr: number | null;
  /** Months since publication, from the detail page. */
  ageMonths: number | null;
  reviews: number | null;
  /** The point estimate being judged, in units per month. */
  salesPerMonth: number | null;
  /** Daily samples from the watchlist, oldest first. */
  history?: RankPoint[];
}

/** A launch runs hot for about this long: honeymoon placement plus ad spend. */
const LAUNCH_MONTHS = 2;
/** Until roughly here the rank still carries the launch, just less of it. */
const SETTLING_MONTHS = 4;
/** Ranks spread this wide over a week make any single reading a coin toss. */
const WIDE_SWING = 4;

const DAY = 24 * 60 * 60 * 1000;

/** Median rank across the samples, plus how far they spread. */
export function readSeries(history: RankPoint[] | undefined): SustainedRead | null {
  if (!history || history.length < 3) return null;
  const ranks = history
    .map((point) => point.bsr)
    .filter((bsr): bsr is number => typeof bsr === "number" && Number.isFinite(bsr) && bsr > 0);
  if (ranks.length < 3) return null;

  // The window the ranks actually cover, not the window the watchlist covers:
  // samples taken before Amazon started publishing a rank would otherwise
  // stretch "3 muestras en 30 días" out of three consecutive days.
  const times = history
    .filter((point) => typeof point.bsr === "number" && Number.isFinite(point.bsr) && point.bsr > 0)
    .map((point) => point.capturedAt)
    .filter((t) => Number.isFinite(t));
  const spanDays = times.length >= 2
    ? Math.round(((Math.max(...times) - Math.min(...times)) / DAY) * 10) / 10
    : 0;
  if (spanDays < 5) return null;

  const sorted = [...ranks].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianBsr = Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
  const bestBsr = sorted[0];
  const worstBsr = sorted[sorted.length - 1];

  return {
    medianBsr,
    bestBsr,
    worstBsr,
    samples: ranks.length,
    spanDays,
    swing: Math.round((worstBsr / Math.max(1, bestBsr)) * 10) / 10,
  };
}

/** Ordered worst-last, so a check can only ever make the reading stricter. */
const LEVELS: ReliabilityLevel[] = ["solida", "provisional", "techo"];

export function assessEstimate(input: ReliabilityInput): EstimateReliability {
  const sustained = readSeries(input.history);
  const reasons: string[] = [];
  let severity = 0;
  const raise = (next: ReliabilityLevel) => {
    severity = Math.max(severity, LEVELS.indexOf(next));
  };

  if (!input.bsr) {
    // Amazon assigns a sales rank on the first sale and keeps it afterwards, so
    // its absence is itself a reading — usually the plainest one the app can
    // give: this listing has not sold in this store. Worth saying, because the
    // alternative is four empty boxes and no explanation.
    const reasons = [
      "Amazon no publica un Best Sellers Rank para esta ficha, así que no hay nada de lo que derivar ventas.",
      "El ranking aparece con la primera venta y ya no se borra. Que no lo tenga suele significar exactamente eso: todavía no ha vendido en esta tienda.",
    ];
    if (input.ageMonths !== null && input.ageMonths >= LAUNCH_MONTHS) {
      reasons.push(
        `Lleva ${Math.round(input.ageMonths)} meses publicado, así que no es cuestión de esperar a que Amazon lo indexe: ` +
        `es el dato que tienes que cambiar.`,
      );
    }
    return {
      level: "techo",
      label: "Sin ranking",
      tone: "warn",
      reasons,
      advice: "Comprueba abajo si sales en las búsquedas: sin visibilidad no hay ventas, y sin ventas no hay ranking. Es el orden en el que se arregla.",
      lowFactor: 0,
      highFactor: 1,
      sustained,
    };
  }

  // --- age ------------------------------------------------------------------
  const age = input.ageMonths;
  if (age !== null && age < LAUNCH_MONTHS) {
    const days = Math.max(1, Math.round(age * 30.44));
    raise("techo");
    reasons.push(
      `Se publicó hace ${days} ${days === 1 ? "día" : "días"}. En un lanzamiento el BSR se mueve con muy pocas ventas ` +
      `—y con publicidad, aún con menos—, así que la cifra mensual es un techo, no una previsión.`,
    );
  } else if (age !== null && age < SETTLING_MONTHS) {
    const months = Math.round(age * 10) / 10;
    raise("provisional");
    reasons.push(
      `Lleva ${months} meses a la venta. El ranking todavía arrastra el empuje del lanzamiento, ` +
      `así que la estimación tiende a quedarse alta.`,
    );
  }

  // --- does the estimate square with the review history? ---------------------
  // A book selling what the curve claims would have collected reviews by now.
  // When it has none, the two figures cannot both be describing the same book.
  //
  // Strictly zero, never a null: the parser returns null both for a listing with
  // no reviews and for one whose review markup it failed to read, and treating
  // the second as the first would downgrade a sound estimate to a ceiling on the
  // strength of a parsing miss.
  const sales = input.salesPerMonth;
  if (age !== null && age >= LAUNCH_MONTHS && sales !== null && sales > 0 && input.reviews === 0) {
    const implied = Math.round(sales * Math.min(age, 12));
    if (implied >= 150) {
      raise("techo");
      reasons.push(
        `A este ritmo llevaría unas ${implied} ventas desde que salió y la ficha no tiene ninguna reseña. ` +
        `Una de las dos cosas no encaja, y lo habitual es que sobre la estimación.`,
      );
    } else if (implied >= 40) {
      raise("provisional");
      reasons.push(
        `A este ritmo llevaría unas ${implied} ventas y aún no tiene reseñas: encaja mal, aunque a esta escala ` +
        `todavía es posible.`,
      );
    }
  }

  // --- how much does the rank move? -----------------------------------------
  if (sustained) {
    if (sustained.swing >= WIDE_SWING) {
      raise("provisional");
      reasons.push(
        `Su BSR ha ido de ${fmt(sustained.bestBsr)} a ${fmt(sustained.worstBsr)} en ${sustained.spanDays} días. ` +
        `Con ese vaivén, una sola lectura puede caer en cualquier punto de la banda; la mediana (${fmt(sustained.medianBsr)}) es la referencia.`,
      );
    } else {
      reasons.push(
        `${sustained.samples} muestras en ${sustained.spanDays} días con el ranking estable alrededor de ` +
        `${fmt(sustained.medianBsr)}: aquí sí hay un ritmo que medir.`,
      );
    }
  } else {
    reasons.push("Es una única lectura del BSR de hoy, no un promedio.");
  }

  const level = LEVELS[severity];
  const advice =
    level === "techo" && age !== null && age < LAUNCH_MONTHS
      ? "Ninguna herramienta puede leer el ritmo real de un libro recién publicado: todas —esta, KDSpy, Publisher Rocket— convierten el BSR en ventas suponiendo un ritmo sostenido. Durante estas semanas el dato bueno es tu informe de regalías de KDP, no esta estimación."
      : !sustained
        ? "Añádelo al seguimiento: con una semana de muestras diarias la lectura pasa a hacerse sobre la mediana del ranking y deja de depender del día que te toque."
        : null;

  const band = BANDS[level];
  return {
    level,
    label: LABELS[level],
    tone: level === "solida" ? "good" : level === "provisional" ? "warn" : "bad",
    reasons,
    advice,
    lowFactor: band[0],
    highFactor: band[1],
    sustained,
  };
}

/**
 * How wide the honest band is around the point estimate. Even a settled book
 * gets one: the curve is fitted, not published.
 */
const BANDS: Record<ReliabilityLevel, [low: number, high: number]> = {
  solida: [0.6, 1.7],
  provisional: [0.35, 2.2],
  // For a launch the direction is knowable, not just the width: the projection
  // is the most the book could be doing, and zero is entirely possible.
  techo: [0, 1],
};

const LABELS: Record<ReliabilityLevel, string> = {
  solida: "Estimación asentada",
  provisional: "Estimación provisional",
  techo: "Léelo como techo",
};

function fmt(value: number): string {
  return Math.round(value).toLocaleString("es");
}

/** The band as a printable range, e.g. "0 – 24". */
export function estimateRange(value: number | null, reliability: EstimateReliability): [number, number] | null {
  if (value === null || !Number.isFinite(value)) return null;
  return [
    Math.round(value * reliability.lowFactor * 10) / 10,
    Math.round(value * reliability.highFactor * 10) / 10,
  ];
}
