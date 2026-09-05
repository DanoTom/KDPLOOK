import type { BookRecord } from "../types";

/**
 * Whether a result is a book somebody could publish against.
 *
 * A search for "agenda psicologo" on Amazon.es returns Finocam and Q Kalon
 * diaries alongside the KDP titles: mass-market stationery, made in factories,
 * sold through retail distribution, ranking at BSR 6 and selling thousands a
 * month. They are real results and they do hold page-one slots — but they are
 * not competition a self-publisher can displace, and averaging them in
 * describes a market nobody is in. On that search the median goes from 16 sales
 * a month to 2.25 once they are set aside: the difference between a niche worth
 * entering and one that is dead.
 *
 * The test is the detail page. Every book carries a page count or a publisher;
 * stationery carries neither.
 *
 * For a row whose detail page was never opened the test is the search card
 * itself, which already says what the thing is: every book on Amazon carries a
 * format — "Tapa blanda", "Versión Kindle" — and a pair of headphones does not.
 * Trusting unread rows was right for stationery, which is shelved as a book and
 * formatted like one, and badly wrong for things that are not books at all: a
 * fast scan of "comunicar o conectar" on amazon.es opened with three JBL
 * headsets, the first of them credited with 3.770 sales a month, and every
 * figure describing that "niche" was really describing consumer electronics.
 *
 * It lives in its own file because both the scoring and the entry criteria need
 * it, and having either import the other formed a cycle — one that left the
 * competition curve reading `undefined` thresholds and scoring NaN, depending
 * on which module a bundler happened to load first.
 */
export function isPublishableBook(book: BookRecord): boolean {
  // Deliberately not a rescue for enriched rows: a Finocam diary is formatted
  // like a book, so letting the format vouch for one would undo the stationery
  // test above.
  if (!book.enriched) return book.format !== "other";
  return book.pages !== null || book.publisher !== null;
}

/**
 * A rank this deep means the title is not selling at all.
 *
 * Lives here, with the other question every module asks of a result, so that
 * the entry criteria and the title analysis can both read it without either
 * importing the other.
 */
export const DEAD_BSR = 2_000_000;

/**
 * Reviews a title collects per month on the shelf.
 *
 * The better reading of "can I get in here". How many reviews the leader has
 * says how long it has been selling; how fast a *recent* entrant accumulates
 * them says what you would have to match, and over how long. Forty reviews is
 * a wall if the newcomers gather one a month and a fortnight's work if they
 * gather twenty.
 */
export function reviewsPerMonth(book: BookRecord): number | null {
  if (book.reviews === null || book.ageMonths === null) return null;
  // Under a month on sale the divisor makes the rate meaningless.
  if (book.ageMonths < 1) return null;
  return Math.round((book.reviews / book.ageMonths) * 10) / 10;
}
