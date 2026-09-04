/**
 * The ten categories.
 *
 * KDP lets a book pick a couple of categories when it is published, and that is
 * where most self-publishers stop. Support will add up to eight more if you ask
 * and give them the exact browse paths — so a book can sit in ten bestseller
 * lists instead of two, and the orange badge only has to be winnable in one of
 * them.
 *
 * That makes this the one screen in the app that turns work already done into
 * money: no new book, no new keyword. The reason it is worth automating is that
 * the choice is a measurement, not a taste — the right eight are the ones whose
 * #1 sells least, and reading that by hand means opening a hundred pages.
 *
 * Nothing here re-derives how hard a category is: that already lives in
 * `summariseCategory`, calibrated once, and this orders and explains what it
 * returns. The genuinely new thing is the last function — the message, with the
 * paths in it, ready to send.
 */

/** What support will add on top of the ones chosen at publication. */
export const HIDDEN_CATEGORY_SLOTS = 8;
/** Where a book can end up in total, and so how many badges are in play. */
export const TOTAL_CATEGORY_SLOTS = 10;

export interface PlacementCandidate {
  node: string;
  name: string;
  /** Full path from the department, which is what the ticket has to carry. */
  path: string[];
  /** The bestseller list itself, so support can check without searching. */
  url: string;
  /** Estimated monthly units the #1 is doing: the bar for the badge. */
  salesToNumber1: number | null;
  bsrNumber1: number | null;
  /** How many books of the list were actually read. */
  read: number;
}

export type BadgeReach = "asequible" | "exigente" | "duro";

export interface PlacementRead extends PlacementCandidate {
  /** Null when nothing could be read, so the row says so instead of guessing. */
  reach: BadgeReach | null;
  note: string;
}

/**
 * Where the bands come from.
 *
 * Not new numbers: the whole app already turns on "a book selling about one a
 * day", which is the rank the entry criteria call proven demand. Applied here
 * it reads plainly — if the category's #1 is doing less than a sale a day, the
 * badge is something a launch can take; several a day and it is somebody's
 * business you would be trying to displace.
 */
const SALES_PER_DAY = 30.44;
const REACHABLE = SALES_PER_DAY;
const HARD = SALES_PER_DAY * 3;

export function readPlacements(candidates: PlacementCandidate[]): PlacementRead[] {
  return candidates
    .map((candidate): PlacementRead => {
      const sales = candidate.salesToNumber1;
      if (sales === null) {
        return {
          ...candidate,
          reach: null,
          note: candidate.read === 0
            ? "Amazon no devolvió libros de esta lista."
            : "Se leyó la lista pero sin clasificación: no se puede medir el listón.",
        };
      }
      const perDay = sales / SALES_PER_DAY;
      if (sales <= REACHABLE) {
        return {
          ...candidate,
          reach: "asequible",
          note: `El primero vende unas ${Math.round(sales)} al mes —menos de una al día—. Un lanzamiento con algo de empuje puede pasarle.`,
        };
      }
      if (sales <= HARD) {
        return {
          ...candidate,
          reach: "exigente",
          note: `El primero mueve unas ${Math.round(sales)} al mes (${perDay.toFixed(1)} al día). Se puede, pero no por accidente.`,
        };
      }
      return {
        ...candidate,
        reach: "duro",
        note: `El primero va por ${Math.round(sales)} al mes (${perDay.toFixed(1)} al día). Aquí el badge es de alguien que vive de esto.`,
      };
    })
    // Cheapest badge first; a category that could not be read goes last rather
    // than sorting as if it were free.
    .sort((a, b) => (a.salesToNumber1 ?? Infinity) - (b.salesToNumber1 ?? Infinity));
}

export interface CategoryRequestOptions {
  /** The book being placed. */
  title: string;
  asin: string;
  /** The store the categories belong to, e.g. "amazon.es". */
  store: string;
  chosen: PlacementRead[];
}

/**
 * The message to paste into KDP support.
 *
 * Written to be sent as-is: it names the book, says exactly what is being asked
 * for, and lists each category as a path *and* a link, because the path is what
 * the agent types into their tool and the link is what settles any ambiguity
 * about which of three similarly named shelves is meant. Requests that make the
 * agent go and look things up are the ones that come back with questions.
 */
export function categoryRequestEmail(opts: CategoryRequestOptions): string {
  const lines: string[] = [];
  lines.push(`Asunto: Añadir categorías al libro ${opts.asin}`);
  lines.push("");
  lines.push("Hola,");
  lines.push("");
  lines.push(
    `Me gustaría solicitar que se añadan las siguientes categorías a mi libro ` +
    `«${opts.title}» (ASIN ${opts.asin}) en ${opts.store}. El contenido del libro ` +
    `encaja con todas ellas.`,
  );
  lines.push("");
  opts.chosen.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.path.join(" > ")}`);
    lines.push(`   ${item.url}`);
  });
  lines.push("");
  lines.push("Muchas gracias por vuestra ayuda.");
  return lines.join("\n");
}
