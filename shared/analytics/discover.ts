import type { BookRecord } from "../types";
import { isPublishableBook } from "./book";
import { LAUNCH_MONTHS } from "./reliability";
import { STOPWORDS, splitTitleWords } from "./titles";

/**
 * Where the ideas come from.
 *
 * Every other screen in this app answers "is this niche any good?" — and all of
 * them start from a phrase the publisher has to already have. That is the wrong
 * half of the problem on the day nothing comes to mind, and browsing categories
 * does not fix it: a category page shows the *top* of the category, which is the
 * most generic, most contested part of it. The subniche is not up there.
 *
 * It is, however, written on the covers. A bestseller titled "Dieta mediterránea
 * para adultos mayores" ranking at 4.000 and published five months ago *is* the
 * finding, and a bestseller list is a hundred of them. So this reads the list the
 * app already downloads and asks two questions of it:
 *
 *   1. which phrases repeat across the titles that sell — those are subniches
 *      the category itself is telling you about; and
 *   2. which of those books are young enough that their rank proves the door is
 *      open *now* rather than in 2019.
 *
 * Neither needs a new request. The bestseller list and its detail pages are
 * already fetched to compute the category's badge threshold; everything below
 * was being thrown away afterwards.
 */

export interface PhraseIdea {
  term: string;
  words: number;
  /** Bestsellers whose title or subtitle carries it. */
  books: number;
  /** What those books rank at. The median, so one runaway does not carry it. */
  medianBsr: number | null;
  /** How many of them are recent enough to prove the niche is open now. */
  young: number;
  /** Real titles carrying it, so the phrase is recognisable at a glance. */
  examples: string[];
  score: number;
}

export interface YoungRanker {
  book: BookRecord;
  ageMonths: number;
  /**
   * True while the rank can still be the launch rather than a rate — the same
   * window the estimate reliability uses, for the same reason.
   */
  launching: boolean;
}

export interface Discovery {
  phrases: PhraseIdea[];
  young: YoungRanker[];
  /** Books the reading is based on. */
  analysed: number;
  /** How many carried a publication date, so the young list reads honestly. */
  dated: number;
}

/**
 * A phrase in this share of the list is the category's own vocabulary, not a
 * subniche: "recetas" in a cookery list says nothing anyone can act on.
 */
const GENERIC_SHARE = 0.4;
/** One author's wording. Two is a pattern. */
const MIN_BOOKS = 2;
/**
 * A niche is a thing plus a qualifier, and one word on its own is neither.
 *
 * Without this the miner offered "sin", "toda", "recetas" and "cocina" as ideas
 * — and ranked them above "recetas sin gluten", because repeating a lot is
 * exactly what a category's own vocabulary does. Frequency alone points at the
 * shelf, not at a gap in it. The rare genuine one-word niche ("thermomix")
 * still turns up inside a two-word phrase, so almost nothing is lost and the
 * card stops printing nonsense.
 */
const MIN_MEANING = 2;
/**
 * How recent a bestseller has to be for its rank to prove the niche is open
 * today. A year is long enough that the book is past its launch and short
 * enough that the market it entered is still the current one.
 */
const YOUNG_MONTHS = 12;
/**
 * Phrases longer than this are one book's subtitle, not a niche. Counted with
 * the little words included, since "dieta mediterránea para adultos" spends two
 * of its slots on words that carry nothing.
 */
const MAX_WORDS = 5;

/** Piecewise-linear mapping through [input, output] anchors. */
function curve(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/**
 * What a phrase's books rank at, as points. Ranks inside a bestseller list are
 * good by definition, so this separates the top of the list from its tail
 * rather than judging whether they sell at all.
 */
const RANK_ANCHORS: Array<[number, number]> = [
  [1_000, 25], [10_000, 20], [50_000, 13], [150_000, 7], [400_000, 2],
];

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Words that carry the meaning: what makes "sin gluten" worth more than "sin". */
function contentWords(phrase: string): number {
  return phrase.split(" ").filter((w) => !STOPWORDS.has(w) && !/^\d+$/.test(w)).length;
}

/**
 * Every phrase of up to five adjacent words in a title.
 *
 * Built over the words as written, little ones included, and then trimmed at
 * the edges — because these phrases are handed back as things to go and search,
 * not as vocabulary. Dropping the stopwords first would join words that were
 * never next to each other and propose "recetas cocina", a phrase nobody types,
 * as if it were a niche.
 */
function phrasesIn(title: string): Set<string> {
  const words = splitTitleWords(title);
  const out = new Set<string>();
  for (let size = 1; size <= MAX_WORDS; size++) {
    for (let i = 0; i + size <= words.length; i++) {
      const slice = words.slice(i, i + size);
      const first = slice[0];
      const last = slice[slice.length - 1];
      // A phrase that opens or closes on a hinge word is a fragment: "de la
      // abuela", "recetas de". Numbers close a phrase fine — "agenda 2027" is
      // a real search — but never open one.
      if (STOPWORDS.has(first) || /^\d+$/.test(first)) continue;
      if (STOPWORDS.has(last)) continue;
      if (!contentWords(slice.join(" "))) continue;
      out.add(slice.join(" "));
    }
  }
  return out;
}

export function discoverIdeas(items: BookRecord[]): Discovery {
  const books = items.filter((b) => !b.sponsored && isPublishableBook(b) && b.title);
  const dated = books.filter((b) => b.ageMonths !== null).length;

  // --- the books that prove a door is open ----------------------------------
  const young = books
    .filter((b): b is BookRecord & { ageMonths: number } =>
      b.ageMonths !== null && b.ageMonths <= YOUNG_MONTHS)
    .map((book) => ({
      book,
      ageMonths: book.ageMonths,
      launching: book.ageMonths < LAUNCH_MONTHS,
    }))
    // Best rank first: on this list every book sells, so the question is which
    // of the recent ones sells most.
    .sort((a, b) => (a.book.bsr ?? Infinity) - (b.book.bsr ?? Infinity));

  if (books.length < 6) {
    // Below this the share test cannot separate a subniche from the category's
    // own vocabulary — two books out of four is 50% of everything.
    return { phrases: [], young, analysed: books.length, dated };
  }

  // --- the phrases the list repeats -----------------------------------------
  const carriers = new Map<string, BookRecord[]>();
  for (const book of books) {
    for (const term of phrasesIn(`${book.title} ${book.subtitle ?? ""}`)) {
      const list = carriers.get(term);
      if (list) list.push(book);
      else carriers.set(term, [book]);
    }
  }

  const phrases: PhraseIdea[] = [];
  for (const [term, group] of carriers) {
    if (group.length < MIN_BOOKS) continue;
    // Present in this much of the list: that is what the category is called,
    // not a niche inside it.
    if (group.length / books.length >= GENERIC_SHARE) continue;

    const words = term.split(" ").length;
    const meaning = contentWords(term);
    if (meaning < MIN_MEANING) continue;
    const ranks = group.map((b) => b.bsr).filter((v): v is number => v !== null && v > 0);
    const medianBsr = median(ranks);
    const youngCount = group.filter((b) => b.ageMonths !== null && b.ageMonths <= YOUNG_MONTHS).length;

    // Four things make a phrase worth a scan, and each is visible in the row
    // beside it so the number never has to be taken on faith:
    //   · repetition — several authors converged on it;
    //   · length — "dieta" is a shelf, "dieta mediterránea" is a niche;
    //   · rank — its books are near the top of the list, not its tail;
    //   · youth — somebody entered recently and it worked.
    // Repetition counts, but it saturates fast and deliberately: past a
    // handful of books a phrase is drifting back towards being the category's
    // own name, and it should not outrank a sharper phrase for that.
    const repetition = Math.min(group.length, 4) * 7;
    const length = meaning >= 3 ? 22 : 14;
    const rank = medianBsr !== null ? curve(medianBsr, RANK_ANCHORS) : 8;
    const youth = Math.min(youngCount, 3) * 6;

    phrases.push({
      term,
      words,
      books: group.length,
      medianBsr,
      young: youngCount,
      examples: group.slice(0, 3).map((b) => b.title),
      score: Math.round(repetition + length + rank + youth),
    });
  }

  // A phrase that contains another scoring at least as well makes the shorter
  // one redundant: showing "dieta", "dieta mediterránea" and "mediterránea" as
  // three ideas is one idea and two ways of wasting a click.
  const ordered = phrases.sort((a, b) => (b.score - a.score) || (b.books - a.books));
  const kept: PhraseIdea[] = [];
  for (const phrase of ordered) {
    const covered = kept.some((seen) =>
      seen.words > phrase.words && seen.term.includes(phrase.term) && seen.books >= phrase.books);
    if (!covered) kept.push(phrase);
  }

  return { phrases: kept.slice(0, 30), young, analysed: books.length, dated };
}
