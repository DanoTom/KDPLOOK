import type { BookRecord } from "../types";
import { isPublishableBook } from "./book";

/**
 * Low, medium and high content are three different businesses.
 *
 * A journal, a puzzle book and a 160-page non-fiction guide share a shelf and
 * nothing else: they are priced differently, cost different amounts to print,
 * earn different royalties, and their rivals become beatable at different
 * review counts. Judging all three against one set of numbers — which is what
 * this app did — reads a healthy non-fiction niche as overpriced and a journal
 * niche as unusually generous.
 *
 * The figures come from the operator's own guide and the expert material behind
 * `docs/criterio-kdp.md`.
 */
export type ContentType = "bajo" | "medio" | "alto";

export interface ContentProfile {
  id: ContentType;
  label: string;
  /** What the niche should be charging for the royalty to work. */
  priceFloor: number;
  priceCeiling: number;
  /** The page count that earns most per copy in this format. */
  sweetSpotPages: number;
  pagesLow: number;
  pagesHigh: number;
  /** Below this many reviews a competitor is reachable. */
  beatableReviews: number;
  /** Royalty a well-made title in this format should clear per copy. */
  royaltyTarget: number;
  note: string;
}

export const CONTENT_PROFILES: Record<ContentType, ContentProfile> = {
  bajo: {
    id: "bajo",
    label: "Bajo contenido",
    priceFloor: 6,
    priceCeiling: 8,
    // Nothing to lay out, so the page count is set by what the buyer expects.
    sweetSpotPages: 100,
    pagesLow: 80,
    pagesHigh: 100,
    beatableReviews: 300,
    royaltyTarget: 2,
    note: "Cuadernos y libretas. Sin barrera de entrada y con guerra de precios constante: el margen (~2 €) no da para pagar publicidad, así que se depende del posicionamiento orgánico.",
  },
  medio: {
    id: "medio",
    label: "Medio contenido",
    priceFloor: 9.99,
    priceCeiling: 12.99,
    // KDP charges a flat print fee up to 108 pages and per-page above it, so
    // 104 buys the most book for the least cost.
    sweetSpotPages: 104,
    pagesLow: 90,
    pagesHigh: 108,
    beatableReviews: 200,
    royaltyTarget: 4.5,
    note: "Pasatiempos, colorear, actividades. Exige software o plantillas, y ahí está la barrera que te protege. 104 páginas es el máximo antes de que Amazon empiece a cobrar por página.",
  },
  alto: {
    id: "alto",
    label: "Alto contenido",
    priceFloor: 14.99,
    priceCeiling: 24.99,
    sweetSpotPages: 150,
    // Starts where the flat print fee stops: above 108 pages KDP charges per
    // page, so the medio economics no longer hold and the book has to be
    // priced as a long one. Declared as 120 before, which left 109-119 in no
    // profile at all while the classifier was handing those niches to alto.
    pagesLow: 109,
    pagesHigh: 180,
    // Redacción de calidad is the barrier, so fewer rivals are entrenched and a
    // leader with under a hundred reviews is genuinely reachable.
    beatableReviews: 100,
    royaltyTarget: 6,
    note: "No ficción y guías. Cuesta escribirlo bien, y eso mismo mantiene fuera a la competencia: con un líder por debajo de 100 reseñas se compite de verdad.",
  },
};

/**
 * Read the content type off the niche rather than asking for it.
 *
 * Page count separates the three cleanly enough — the print-fee threshold at
 * 108 pages is a real boundary publishers design around — and the price breaks
 * the tie when the lengths are ambiguous.
 */
/** Above this many pages KDP stops charging a flat print fee. */
const FLAT_FEE_PAGES = 108;
/**
 * The two prices that place a niche when its length leaves the answer open.
 * Both are the profiles' own declared edges rather than new numbers: a niche
 * charging inside the 6-8 band is selling notebooks, one charging what alto
 * asks is selling books.
 */
const LOW_CONTENT_PRICE = CONTENT_PROFILES.bajo.priceCeiling;
const HIGH_CONTENT_PRICE = 14;

export function inferContentType(items: BookRecord[]): ContentType {
  const books = items.filter((b) => !b.sponsored && isPublishableBook(b));
  const pages = books.map((b) => b.pages).filter((v): v is number => v !== null && v > 0);
  const prices = books.map((b) => b.price).filter((v): v is number => v !== null && v > 0);

  const medianOf = (values: number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const medianPages = medianOf(pages);
  const medianPrice = medianOf(prices);

  // Nothing read: medium is the least wrong default, and the picker is there.
  if (medianPages === null) {
    if (medianPrice === null) return "medio";
    if (medianPrice >= HIGH_CONTENT_PRICE) return "alto";
    return medianPrice >= LOW_CONTENT_PRICE ? "medio" : "bajo";
  }

  // KDP charges a flat print fee up to 108 pages and per page above it. It is
  // the one boundary in the format that Amazon publishes rather than one this
  // app estimates, so it is the one the split uses.
  if (medianPages > FLAT_FEE_PAGES) {
    // Long and cheap is a thick notebook, not a guide: nobody writes 160 pages
    // of non-fiction to sell them under the price of a coffee, and reading a
    // journal niche as alto would demand 14,99 of it and call it overpriced.
    return medianPrice !== null && medianPrice < LOW_CONTENT_PRICE ? "bajo" : "alto";
  }

  // Below the threshold bajo and medio overlap by design (80-100 against
  // 90-108), and the shelf price is what separates them — as it does in the
  // shop: 100 pages at 6,99 is a notebook, the same 100 at 11 is a puzzle
  // book. The line is bajo's own ceiling, so a niche charging inside the 6-8
  // band is read as the business that band belongs to — and the price-war flag
  // still fires on it. Without a price, medio sits in the middle of the three.
  if (medianPrice === null) return "medio";
  return medianPrice >= LOW_CONTENT_PRICE ? "medio" : "bajo";
}

/**
 * Formats where the page count lies about the work.
 *
 * A dated 200-page agenda is priced and printed like a high-content book, and
 * the page rule reads it as one — which is right about the money and wrong
 * about the barrier. `alto` earns its optimism from how hard the writing is;
 * a planner has no such moat. Rather than invent a fourth profile for a case
 * the picker can already override, say the part that does not transfer.
 */
const FORMAT_WORDS = [
  "agenda", "agendas", "planner", "planners", "planificador", "planificadora",
  "cuaderno", "cuadernos", "libreta", "libretas", "bloc", "diario", "diarios",
  "journal", "notebook", "calendario", "calendarios", "organizador",
  "bitácora", "bitacora", "dietario", "recetario", "álbum", "album",
];

/** Half the page naming a stationery format is the niche, not a coincidence. */
const FORMAT_SHARE = 0.5;

export function formatCaveat(items: BookRecord[], type: ContentType): string | null {
  if (type !== "alto") return null;
  const titles = items
    .filter((b) => !b.sponsored && isPublishableBook(b) && b.title)
    .map((b) => `${b.title} ${b.subtitle ?? ""}`.toLowerCase());
  if (titles.length < 4) return null;
  const hits = titles.filter((t) => FORMAT_WORDS.some((w) => new RegExp(`(^|[^a-záéíóúñ])${w}([^a-záéíóúñ]|$)`).test(t)));
  if (hits.length / titles.length < FORMAT_SHARE) return null;
  return (
    "Ojo: la mayoría de estos títulos son agendas, cuadernos o planificadores. Por extensión y precio " +
    "se comportan como alto contenido —y así se juzgan aquí—, pero la barrera no es escribir bien: " +
    "maquetar 200 páginas de plantilla lo hace cualquiera. Cuenta con más competencia nueva y más " +
    "presión sobre el precio de la que sugiere este perfil."
  );
}
