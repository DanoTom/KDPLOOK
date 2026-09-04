import type { BookRecord } from "../types";
import { isPublishableBook } from "./book";

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
  /** Titles containing it among the books that sell. */
  inSelling: number;
  /** Titles containing it across the whole page. */
  inAll: number;
  /**
   * How much more common it is among sellers than on the page as a whole.
   * Above 1 means the sellers use it and the rest do not.
   */
  lift: number;
}

export interface TitleAnalysis {
  /** Terms the sellers share, most distinctive first. */
  terms: TitleTerm[];
  sellers: number;
  analysed: number;
}

/**
 * Words that carry no positioning. Kept deliberately short: a stoplist that
 * removes too much hides the phrases the analysis exists to find.
 */
const STOPWORDS = new Set([
  "de", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "a",
  "en", "con", "por", "para", "del", "al", "su", "sus", "lo", "que", "se",
  "más", "mas", "the", "of", "and", "for", "with", "to", "in", "a", "an",
  "your", "you", "book", "libro", "libros", "edition", "edición", "edicion",
  "vol", "volumen", "nuevo", "nueva",
]);

function tokenise(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[|:;,.()¡!¿?"'«»\-–—/+]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
}

/** Single words and adjacent pairs, deduplicated within one title. */
function termsIn(title: string): Set<string> {
  const words = tokenise(title);
  const out = new Set<string>(words);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

export function analyseTitles(items: BookRecord[], sellingBsr: number): TitleAnalysis {
  const books = items.filter((b) => !b.sponsored && isPublishableBook(b) && b.title);
  // "Sells" is the same daily-sale bar the entry criteria use; when no rank was
  // read at all, position stands in — the top of page one is what Amazon ranks.
  const anyRank = books.some((b) => b.bsr !== null);
  const sellers = anyRank
    ? books.filter((b) => b.bsr !== null && b.bsr <= sellingBsr)
    : books.slice(0, Math.max(3, Math.ceil(books.length / 3)));

  if (books.length < 4 || sellers.length < 2) {
    return { terms: [], sellers: sellers.length, analysed: books.length };
  }

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
  return { terms: terms.slice(0, 24), sellers: sellers.length, analysed: books.length };
}
