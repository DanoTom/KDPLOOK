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
 * stationery carries neither. Only applied to enriched rows, since an unread
 * listing is missing both for an entirely different reason.
 *
 * It lives in its own file because both the scoring and the entry criteria need
 * it, and having either import the other formed a cycle — one that left the
 * competition curve reading `undefined` thresholds and scoring NaN, depending
 * on which module a bundler happened to load first.
 */
export function isPublishableBook(book: BookRecord): boolean {
  if (!book.enriched) return true;
  return book.pages !== null || book.publisher !== null;
}
