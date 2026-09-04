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
    pagesLow: 120,
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
    if (medianPrice !== null && medianPrice >= 14) return "alto";
    return "medio";
  }
  if (medianPages > 115) return "alto";
  if (medianPages < 90) {
    // Short but expensive is a puzzle book, not a notebook.
    return medianPrice !== null && medianPrice >= 9 ? "medio" : "bajo";
  }
  return "medio";
}
