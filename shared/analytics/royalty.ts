import type { PrintingCosts, RoyaltyInput, RoyaltyOutput } from "../types";

/**
 * KDP royalty maths.
 *
 * Printing costs are Amazon's US figures and Amazon revises them periodically,
 * so every number below is a *default* that the Settings page can override —
 * check kdp.amazon.com > Help > Printing Costs before trusting a tight margin.
 */
export const DEFAULT_PRINTING_COSTS: PrintingCosts = {
  bwRegularFixed: 2.3,        // ≤108 pages, black ink, regular trim
  bwRegularPerPage: 0.012,    // 110-828 pages, on top of a $1.00 fixed part
  bwRegularFixedMaxPages: 108,
  bwLargeFixed: 2.84,
  bwLargePerPage: 0.017,
  colorRegularFixed: 3.6,
  colorRegularPerPage: 0.0255,
  premiumColorFixed: 0.85,
  premiumColorPerPage: 0.0525,
  hardcoverFixed: 5.65,
  hardcoverPerPage: 0.012,
};

/**
 * The constant that sits in front of the per-page tier — "$1.00 + $0.012/page"
 * in the United States. It is a currency amount, so it is not the same number
 * on Amazon.es, and it lives in the editable rates rather than here.
 */
function fixedPart(costs: PrintingCosts): number {
  return typeof costs.overThresholdFixed === "number" ? costs.overThresholdFixed : 1.0;
}

export function printingCost(
  pages: number,
  format: "paperback" | "hardcover" | "kindle",
  ink: "bw" | "color" | "premium",
  trim: "regular" | "large",
  costs: PrintingCosts,
): number {
  if (format === "kindle") return 0;
  const p = Math.max(24, Math.min(1000, Math.round(pages || 100)));

  if (format === "hardcover") {
    const perPage = ink === "premium" ? costs.premiumColorPerPage : costs.hardcoverPerPage;
    return round2(costs.hardcoverFixed + perPage * p);
  }

  if (ink === "premium") {
    return round2(costs.premiumColorFixed + costs.premiumColorPerPage * p);
  }

  if (ink === "color") {
    return p <= costs.bwRegularFixedMaxPages
      ? round2(costs.colorRegularFixed)
      : round2(fixedPart(costs) + costs.colorRegularPerPage * p);
  }

  // Black ink
  if (trim === "large") {
    return p <= costs.bwRegularFixedMaxPages
      ? round2(costs.bwLargeFixed)
      : round2(fixedPart(costs) + costs.bwLargePerPage * p);
  }
  return p <= costs.bwRegularFixedMaxPages
    ? round2(costs.bwRegularFixed)
    : round2(fixedPart(costs) + costs.bwRegularPerPage * p);
}

/** Kindle delivery fee, charged only on the 70% plan. */
function deliveryCost(fileSizeMb: number): number {
  return round2(Math.max(0, fileSizeMb) * 0.15);
}

export function computeRoyalty(input: RoyaltyInput, costs: PrintingCosts): RoyaltyOutput {
  const notes: string[] = [];
  const price = Math.max(0, input.price || 0);

  if (input.format === "kindle") {
    // 70% applies only inside the $2.99–$9.99 band (US); outside it, 35%.
    const eligible = price >= 2.99 && price <= 9.99;
    const rate = eligible ? 0.7 : 0.35;
    const delivery = eligible ? deliveryCost(input.fileSizeMb ?? 1) : 0;
    const royalty = round2(price * rate - delivery);
    if (!eligible && price > 0) {
      notes.push("Fuera del rango $2.99–$9.99 la regalía Kindle baja al 35% y no se cobra entrega.");
    }
    if (eligible) notes.push(`Coste de entrega estimado: ${fmt(delivery)} (0,15 $/MB).`);
    return {
      royaltyRate: rate,
      printingCost: 0,
      deliveryCost: delivery,
      royaltyPerUnit: royalty,
      marginPct: price > 0 ? round2((royalty / price) * 100) : 0,
      breakEvenPrice: eligible ? round2(delivery / rate) : 0,
      notes,
    };
  }

  const print = printingCost(input.pages, input.format, input.ink, input.trim, costs);
  const rate = 0.6;
  const royalty = round2(price * rate - print);
  const breakEven = round2(print / rate);

  if (royalty <= 0) {
    notes.push(`A este precio no hay regalía: necesitas al menos ${fmt(breakEven)} para cubrir la impresión.`);
  }
  if (input.format === "paperback" && price < 2.99) {
    notes.push("KDP exige un precio mínimo de lista que depende del coste de impresión.");
  }
  notes.push(
    typeof costs.overThresholdFixed === "number"
      ? "Impresión calculada con las tarifas que mediste con tus propios libros."
      : "Impresión estimada con las tarifas de EE. UU. en dólares. Si publicas en otra tienda, mídelas con tus libros en Ajustes.",
  );

  return {
    royaltyRate: rate,
    printingCost: print,
    deliveryCost: 0,
    royaltyPerUnit: royalty,
    marginPct: price > 0 ? round2((royalty / price) * 100) : 0,
    breakEvenPrice: breakEven,
    notes,
  };
}

/**
 * Rough per-unit royalty for a competitor we only partially know: we have its
 * price, format and page count but not its ink or trim choice.
 */
export function estimateRoyaltyPerUnit(
  price: number | null,
  pages: number | null,
  format: string,
  costs: PrintingCosts,
): number | null {
  if (!price || price <= 0) return null;
  if (format === "kindle") {
    const eligible = price >= 2.99 && price <= 9.99;
    return round2(price * (eligible ? 0.7 : 0.35) - (eligible ? 0.15 : 0));
  }
  if (format === "audible" || format === "other") return null;
  const p = pages ?? 120;
  const print = printingCost(p, format === "hardcover" ? "hardcover" : "paperback", "bw", "regular", costs);
  return round2(Math.max(0, price * 0.6 - print));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmt(value: number): string {
  return `$${value.toFixed(2)}`;
}


/**
 * Work the printing rates out from books whose real cost is known.
 *
 * Amazon publishes these per storefront and per currency, revises them, and the
 * defaults here are the US table in dollars — so every royalty this app shows a
 * publisher on Amazon.es is off by whatever the euro table differs by. Rather
 * than shipping a guess at another country's numbers, the rates are measured:
 * KDP shows the printing cost of each of your own books, and two of them above
 * the flat-fee threshold determine the line exactly, since cost is
 * `fixed + perPage × pages` and two points fix a line.
 */
export interface PrintingSample {
  pages: number;
  cost: number;
}

export interface SolvedPrintingRates {
  /** Flat fee charged at or below the threshold. */
  flatFee: number | null;
  /** The constant in front of the per-page tier. */
  overThresholdFixed: number | null;
  perPage: number | null;
  usedShort: number;
  usedLong: number;
  /** Largest gap between a sample's real cost and what the fit predicts. */
  worstError: number | null;
}

export function solvePrintingRates(
  samples: PrintingSample[],
  thresholdPages: number,
): SolvedPrintingRates {
  const clean = samples.filter(
    (s) => Number.isFinite(s.pages) && Number.isFinite(s.cost) && s.pages > 0 && s.cost > 0,
  );
  const short = clean.filter((s) => s.pages <= thresholdPages);
  const long = clean.filter((s) => s.pages > thresholdPages);

  // At or below the threshold the page count does not matter, so the fee is
  // just what those books cost; the median keeps one odd entry from setting it.
  let flatFee: number | null = null;
  if (short.length) {
    const costs = short.map((s) => s.cost).sort((a, b) => a - b);
    const mid = Math.floor(costs.length / 2);
    flatFee = round2(costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2);
  }

  if (long.length < 2) {
    return { flatFee, overThresholdFixed: null, perPage: null, usedShort: short.length, usedLong: long.length, worstError: null };
  }

  // Least squares through the long samples: exact with two, and with more it
  // absorbs the rounding Amazon does to the cent.
  const n = long.length;
  const sumX = long.reduce((a, s) => a + s.pages, 0);
  const sumY = long.reduce((a, s) => a + s.cost, 0);
  const sumXY = long.reduce((a, s) => a + s.pages * s.cost, 0);
  const sumXX = long.reduce((a, s) => a + s.pages * s.pages, 0);
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) {
    // Every long sample has the same page count: one point, no line.
    return { flatFee, overThresholdFixed: null, perPage: null, usedShort: short.length, usedLong: n, worstError: null };
  }

  const perPage = (n * sumXY - sumX * sumY) / denom;
  const fixed = (sumY - perPage * sumX) / n;
  if (!(perPage > 0) || !(fixed >= 0)) {
    // A negative rate means the samples contradict the model rather than
    // measuring it — usually a typo, or books on different ink or trim.
    return { flatFee, overThresholdFixed: null, perPage: null, usedShort: short.length, usedLong: n, worstError: null };
  }

  const worstError = Math.max(...long.map((s) => Math.abs(s.cost - (fixed + perPage * s.pages))));
  return {
    flatFee,
    overThresholdFixed: round2(fixed),
    perPage: Math.round(perPage * 10000) / 10000,
    usedShort: short.length,
    usedLong: n,
    worstError: round2(worstError),
  };
}
