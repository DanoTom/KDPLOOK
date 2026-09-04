import type { AppSettings, BookRecord, MarketplaceId } from "../types";
import { computeRoyalty } from "./royalty";
import { isPublishableBook } from "./book";

/**
 * What it would take to enter a niche.
 *
 * The rest of the app answers "what is happening here". This answers the
 * question a publisher actually acts on: to hold a place on page one, how many
 * copies a month is that, how much review history am I up against, what would
 * my own book earn per copy, and how many copies is my income target.
 *
 * Everything here is arithmetic over figures shown elsewhere in the report —
 * no new estimate is invented — except the review rate, which is an
 * assumption and is surfaced as one.
 */
export interface EntryPlan {
  /** Rank whose holder you would have to outsell, 1-based and organic. */
  targetPosition: number | null;
  targetTitle: string | null;
  targetSalesPerMonth: number | null;
  targetSalesPerDay: number | null;
  reviewsToBeat: number | null;

  suggestedPrice: number | null;
  suggestedPages: number | null;
  royaltyPerUnit: number | null;
  printingCost: number | null;

  /** Units a month needed to reach the income target at that royalty. */
  unitsForTarget: number | null;
  /** Months of selling at the entry rate before matching the review count. */
  monthsToReviews: number | null;

  feasibility: "alcanzable" | "exigente" | "duro" | "sin datos";
  headline: string;
  notes: string[];
  /** The guide's price/length target, and how this niche compares to it. */
  golden: GoldenCombo | null;
}

/**
 * The "combinación dorada" from the operator guide: 104 pages of black ink on
 * 8.5 x 11, priced 9.99-12.99, which clears 4.50-6.00 a copy. The page count is
 * not arbitrary — Amazon charges a flat print fee up to 108 pages and switches
 * to per-page above it, so 104 buys the most book for the least cost.
 */
export interface GoldenCombo {
  pages: number;
  priceLow: number;
  priceHigh: number;
  royaltyLow: number;
  royaltyHigh: number;
  /** Cost of the niche's own median length versus the 104-page target. */
  extraPrintCost: number | null;
  fits: boolean;
  advice: string;
}

export interface EntryPlanInput {
  items: BookRecord[];
  settings: AppSettings;
  marketplace: MarketplaceId;
  /** Monthly royalty target, in the storefront's currency. */
  targetIncome: number;
  /** Reviews earned per hundred copies sold. An assumption, not a measurement. */
  reviewsPerHundredSales: number;
  /** Rank being aimed at. Ten is page-one visibility on most queries. */
  aimPosition?: number;
}

export function buildEntryPlan(input: EntryPlanInput): EntryPlan {
  const { items, settings, targetIncome, reviewsPerHundredSales } = input;
  const aim = input.aimPosition ?? 10;

  // Commercial stationery holds page-one slots but is not a title to displace:
  // aiming at a Finocam diary selling 1.600 a month sets a bar that has nothing
  // to do with publishing a book.
  const organic = items
    .filter((book) => !book.sponsored && isPublishableBook(book))
    .sort((a, b) => a.position - b.position);
  const band = organic.filter((book) => book.position <= aim);

  // The listing to displace: the weakest one still holding a place in the band
  // whose rank we could actually read.
  const target = [...band].reverse().find((book) => book.salesPerMonth !== null) ?? null;

  const prices = band.map((b) => b.price).filter((v): v is number => v !== null);
  const pages = band.map((b) => b.pages).filter((v): v is number => v !== null);
  const reviews = band.map((b) => b.reviews).filter((v): v is number => v !== null);

  const suggestedPrice = median(prices);
  const suggestedPages = median(pages);
  const reviewsToBeat = target?.reviews ?? median(reviews);

  const royalty = suggestedPrice !== null
    ? computeRoyalty(
        {
          price: suggestedPrice,
          pages: suggestedPages ?? 120,
          format: "paperback",
          ink: "bw",
          trim: "regular",
          marketplace: input.marketplace,
        },
        settings.printing,
      )
    : null;

  const royaltyPerUnit = royalty && royalty.royaltyPerUnit > 0 ? royalty.royaltyPerUnit : null;
  const targetSales = target?.salesPerMonth ?? null;

  const unitsForTarget = royaltyPerUnit ? Math.ceil(targetIncome / royaltyPerUnit) : null;
  const monthsToReviews =
    reviewsToBeat !== null && targetSales !== null && targetSales > 0 && reviewsPerHundredSales > 0
      ? Math.round((reviewsToBeat / (targetSales * (reviewsPerHundredSales / 100))) * 10) / 10
      : null;

  const feasibility: EntryPlan["feasibility"] =
    targetSales === null ? "sin datos"
    : targetSales <= 30 ? "alcanzable"
    : targetSales <= 120 ? "exigente"
    : "duro";

  const notes: string[] = [];
  if (suggestedPrice !== null) {
    notes.push(`Precio de referencia: la mediana del top ${aim}. Salirte mucho por arriba exige justificarlo con más páginas o mejor acabado.`);
  }
  if (royalty && royalty.printingCost > 0 && suggestedPages) {
    notes.push(`Impresión calculada para ${suggestedPages} páginas en blanco y negro, tamaño regular. Cambiar a color multiplica el coste.`);
  }
  if (monthsToReviews !== null) {
    notes.push(`El plazo de reseñas asume ${reviewsPerHundredSales} por cada 100 ventas: es una suposición del sector, no un dato medido. Ajústala si conoces tu tasa real.`);
  }
  if (target && target.ageMonths !== null && target.ageMonths < 2) {
    // The bar is set by whatever the target sells, and a launch rank overstates
    // that. Better to know the bar may be lower than to walk away from the niche.
    notes.push(
      `El libro de referencia lleva menos de dos meses publicado: su ritmo sale de un ranking de lanzamiento, ` +
      `así que el listón para entrar es probablemente más bajo de lo que marca aquí.`,
    );
  }
  if (royaltyPerUnit === null && suggestedPrice !== null) {
    notes.push("A ese precio y con esa extensión la impresión se come la regalía: necesitarías menos páginas o un precio más alto.");
  }

  const golden = buildGolden(settings, input.marketplace, suggestedPrice, suggestedPages);
  if (golden && !golden.fits) notes.push(golden.advice);

  return {
    golden,
    targetPosition: target?.position ?? null,
    targetTitle: target?.title ?? null,
    targetSalesPerMonth: targetSales,
    targetSalesPerDay: targetSales !== null ? Math.round((targetSales / 30.44) * 100) / 100 : null,
    reviewsToBeat,
    suggestedPrice,
    suggestedPages,
    royaltyPerUnit,
    printingCost: royalty?.printingCost ?? null,
    unitsForTarget,
    monthsToReviews,
    feasibility,
    headline: headlineFor(feasibility, targetSales, aim),
    notes,
  };
}

const GOLDEN_PAGES = 104;
const GOLDEN_PRICE_LOW = 9.99;
const GOLDEN_PRICE_HIGH = 12.99;

function buildGolden(
  settings: AppSettings,
  marketplace: MarketplaceId,
  nichePrice: number | null,
  nichePages: number | null,
): GoldenCombo | null {
  const royaltyAt = (price: number, pages: number) =>
    computeRoyalty(
      { price, pages, format: "paperback", ink: "bw", trim: "regular", marketplace },
      settings.printing,
    );

  const low = royaltyAt(GOLDEN_PRICE_LOW, GOLDEN_PAGES);
  const high = royaltyAt(GOLDEN_PRICE_HIGH, GOLDEN_PAGES);

  // Past 108 pages the flat print fee gives way to a per-page charge, so the
  // gap between the niche's typical length and the target is real money.
  const extraPrintCost = nichePages !== null
    ? Math.round((royaltyAt(GOLDEN_PRICE_LOW, nichePages).printingCost - low.printingCost) * 100) / 100
    : null;

  const priceFits = nichePrice === null || nichePrice >= GOLDEN_PRICE_LOW;
  const lengthFits = nichePages === null || nichePages <= 110;

  let advice: string;
  if (!priceFits) {
    advice = `El precio mediano del nicho (${nichePrice?.toFixed(2)}) queda por debajo del objetivo de ${GOLDEN_PRICE_LOW}: la regalía no daría margen para publicidad.`;
  } else if (!lengthFits && extraPrintCost !== null && extraPrintCost > 0) {
    advice = `Los competidores rondan las ${nichePages} páginas. Bajar a ${GOLDEN_PAGES} ahorraría ${extraPrintCost.toFixed(2)} de impresión por ejemplar: Amazon cobra tarifa plana hasta 108 páginas y por página a partir de ahí.`;
  } else {
    advice = `Este nicho encaja con la combinación dorada: ${GOLDEN_PAGES} páginas a ${GOLDEN_PRICE_LOW}-${GOLDEN_PRICE_HIGH}.`;
  }

  return {
    pages: GOLDEN_PAGES,
    priceLow: GOLDEN_PRICE_LOW,
    priceHigh: GOLDEN_PRICE_HIGH,
    royaltyLow: low.royaltyPerUnit,
    royaltyHigh: high.royaltyPerUnit,
    extraPrintCost,
    fits: priceFits && lengthFits,
    advice,
  };
}

function headlineFor(
  feasibility: EntryPlan["feasibility"],
  targetSales: number | null,
  aim: number,
): string {
  if (feasibility === "sin datos") {
    return `No se pudo leer la clasificación de los primeros ${aim} resultados, así que no hay con qué medir la entrada.`;
  }
  const perDay = Math.max(1, Math.round((targetSales ?? 0) / 30.44));
  if (feasibility === "alcanzable") {
    return `Entrar al top ${aim} pide del orden de ${Math.round(targetSales ?? 0)} ventas al mes — alrededor de ${perDay} al día. Está al alcance de un lanzamiento bien hecho.`;
  }
  if (feasibility === "exigente") {
    return `Para el top ${aim} harían falta unas ${Math.round(targetSales ?? 0)} ventas al mes (~${perDay} al día). Se puede, pero no con un lanzamiento pasivo.`;
  }
  return `El top ${aim} exige unas ${Math.round(targetSales ?? 0)} ventas al mes (~${perDay} al día). Busca un ángulo más específico antes de comprometer un título aquí.`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 100) / 100;
}
