import type { AppSettings, BookRecord, MarketplaceId } from "../types";
import { computeRoyalty } from "./royalty";

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

  const organic = items.filter((book) => !book.sponsored).sort((a, b) => a.position - b.position);
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
  if (royaltyPerUnit === null && suggestedPrice !== null) {
    notes.push("A ese precio y con esa extensión la impresión se come la regalía: necesitarías menos páginas o un precio más alto.");
  }

  return {
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
