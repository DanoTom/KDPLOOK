import type { BookRecord } from "../types";
import { DEAD_BSR, isPublishableBook } from "./book";

/**
 * What the titles that sell have in common.
 *
 * A niche report says whether to enter. This says what to call the book once
 * you do — and it is the one thing a scan already has the data for and was
 * throwing away. Every title on page one is right there; the question worth
 * asking of them is not which words are frequent, but which words are frequent
 * *among the books that sell*. "Agenda" appears in everything. "Profesional"
 * appearing in four of the five sellers and in none of the rest is a finding.
 *
 * Bigrams matter more than single words here, because titles are bought on
 * phrases — "letra grande", "para principiantes" — not on vocabulary.
 */
export interface TitleTerm {
  term: string;
  words: number;
  /** Titles containing it among the books used as the reference group. */
  inSelling: number;
  /** Titles containing it across the whole page. */
  inAll: number;
  /**
   * How much more common it is among sellers than on the page as a whole.
   * Above 1 means the sellers use it and the rest do not.
   */
  lift: number;
}

/**
 * How the reference group was chosen — because in a small market it is often
 * not "the ones that sell".
 *
 * Two real scans of Spanish niches came back with a single book under the
 * weekly-sale rank out of eight and eleven read. Requiring two sellers meant
 * this card simply never appeared on the market the app is actually used in.
 * The fix is the one the demand gate already got: keep the strict reading when
 * the market supports it, and otherwise compare against the best-ranked part
 * of the page and say so, instead of showing nothing.
 */
export type TitleBasis = "venden" | "mejores" | "posicion";

export interface TitleAnalysis {
  /** Terms the reference group shares, most distinctive first. */
  terms: TitleTerm[];
  basis: TitleBasis;
  sellers: number;
  analysed: number;
  /** Ranks the reference group holds; null when no rank was read at all. */
  bestBsr: number | null;
  worstBsr: number | null;
}

/**
 * Words that carry no positioning. Kept deliberately short: a stoplist that
 * removes too much hides the phrases the analysis exists to find.
 */
export const STOPWORDS = new Set([
  "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "a",
  "en", "con", "por", "para", "del", "al", "su", "sus", "lo", "que", "se",
  "más", "mas", "the", "of", "and", "for", "with", "to", "in", "a", "an",
  "your", "you", "book", "libro", "libros", "edition", "edición", "edicion",
  "vol", "volumen", "nuevo", "nueva",
]);

/** The title as words, punctuation gone and nothing else removed. */
export function splitTitleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[|:;,.()¡!¿?"'«»\-–—/+]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function tokeniseTitle(title: string): string[] {
  return splitTitleWords(title)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

/** Single words and adjacent pairs, deduplicated within one title. */
function termsIn(title: string): Set<string> {
  const words = tokeniseTitle(title);
  const out = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function analyseTitles(items: BookRecord[], sellingBsr: number): TitleAnalysis {
  const books = items.filter((b) => !b.sponsored && isPublishableBook(b) && b.title);
  const ranked = books
    .filter((b): b is BookRecord & { bsr: number } => b.bsr !== null)
    .sort((a, b) => a.bsr - b.bsr);

  // First choice: the books that actually sell, on the same rank the entry
  // criteria use. Second: when almost nobody in this market clears that bar,
  // the best-ranked third of the page — still the books Amazon puts ahead of
  // the rest, and the card says which reading it made.
  //
  // Page order is the last resort, and only when no rank was read anywhere —
  // which the demand gate already treats as a scan that failed rather than a
  // page where nothing sells. Once some ranks did come back, a listing without
  // one has not sold, and its place on the shelf is not evidence of anything:
  // letting page order stand in there quietly rescued the very case the rank
  // floor exists to reject, a page whose best two listings sit three million
  // deep.
  const alive = ranked.filter((b) => b.bsr <= DEAD_BSR);
  const selling = alive.filter((b) => b.bsr <= sellingBsr);
  let basis: TitleBasis;
  let sellers: BookRecord[];
  if (selling.length >= 2) {
    basis = "venden";
    sellers = selling;
  } else if (alive.length >= 2) {
    basis = "mejores";
    sellers = alive.slice(0, Math.max(2, Math.min(alive.length - 1, Math.ceil(books.length / 3))));
  } else if (ranked.length === 0) {
    basis = "posicion";
    sellers = books.slice(0, Math.max(3, Math.ceil(books.length / 3)));
  } else {
    // Ranks came back and nothing in them is selling. Nothing to copy.
    basis = "mejores";
    sellers = alive;
  }

  // Only meaningful when the ranks are what chose the group; on page order
  // they would read as a claim the reading never made.
  const sellerRanks = basis === "posicion"
    ? []
    : sellers.map((b) => b.bsr).filter((v): v is number => v !== null);
  const empty = {
    terms: [] as TitleTerm[],
    basis,
    sellers: sellers.length,
    analysed: books.length,
    bestBsr: sellerRanks.length ? Math.min(...sellerRanks) : null,
    worstBsr: sellerRanks.length ? Math.max(...sellerRanks) : null,
  };
  // Under four titles there is no "most of them" to find. When every book on
  // the page sells, the group is the page: every lift comes out at 1 and the
  // card correctly reports shared vocabulary and nothing distinctive.
  if (books.length < 4 || sellers.length < 2) return empty;

  const countIn = (pool: BookRecord[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const book of pool) {
      for (const term of termsIn(`${book.title} ${book.subtitle ?? ""}`)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
    return counts;
  };

  const inAll = countIn(books);
  const inSelling = countIn(sellers);

  const terms: TitleTerm[] = [];
  for (const [term, sellingCount] of inSelling) {
    // A term used by one seller is a coincidence, not a pattern.
    if (sellingCount < 2) continue;
    const allCount = inAll.get(term) ?? sellingCount;
    const sellingShare = sellingCount / sellers.length;
    const allShare = allCount / books.length;
    terms.push({
      term,
      words: term.split(" ").length,
      inSelling: sellingCount,
      inAll: allCount,
      lift: Math.round((sellingShare / Math.max(0.01, allShare)) * 100) / 100,
    });
  }

  // Distinctive first, then common: a term the sellers own beats one everybody
  // uses, and among equals the more frequent one is the safer bet.
  terms.sort((a, b) => (b.lift - a.lift) || (b.inSelling - a.inSelling) || (b.words - a.words));
  return { ...empty, terms: terms.slice(0, 24) };
}
