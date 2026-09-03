import type { BookFormat, BookRecord, Marketplace } from "../../shared/types";
import { allMatches, decodeEntities, firstMatch, parseInteger, parsePrice, parseRating, stripTags } from "./html";

export interface SearchPageResult {
  items: BookRecord[];
  totalResults: number | null;
  resultsCountText: string | null;
  rawItemCount: number;
  /** Amazon itself said there is nothing here, in its own words. */
  noResults: boolean;
}

/** Words Amazon uses for the binding, across the storefronts we support. */
const FORMAT_WORDS: Array<{ re: RegExp; format: BookFormat }> = [
  { re: /mass market paperback|libro de bolsillo/i, format: "paperback" },
  { re: /paperback|tapa blanda|taschenbuch|broch[ée]|copertina flessibile|capa comum|pocketbok/i, format: "paperback" },
  { re: /hardcover|tapa dura|gebundene ausgabe|gebundenes buch|reli[ée]|copertina rigida|capa dura|inbunden/i, format: "hardcover" },
  { re: /kindle edition|versi[óo]n kindle|kindle ausgabe|format kindle|edizione kindle|edi[çc][ãa]o kindle|kindle/i, format: "kindle" },
  { re: /audible|audiobook|audiolibro|h[öo]rbuch|livre audio/i, format: "audible" },
  { re: /spiral[- ]bound|espiral|spiralbindung/i, format: "spiral" },
  { re: /board book|libro de cart[óo]n|pappbilderbuch/i, format: "board" },
];

const FORMAT_LABELS: Record<BookFormat, string> = {
  paperback: "Tapa blanda",
  hardcover: "Tapa dura",
  kindle: "Kindle",
  audible: "Audiolibro",
  spiral: "Espiral",
  board: "Cartoné",
  other: "Otro",
};

const SPONSORED_RE = /(>\s*sponsored\s*<|>\s*patrocinado\s*<|>\s*gesponsert\s*<|>\s*sponsoris[ée]\s*<|>\s*sponsorizzato\s*<|s-sponsored-label|sp-sponsored-result|AdHolder)/i;
const KU_RE = /kindle unlimited|kindleunlimited/i;

/**
 * Slice the result list into one HTML block per product.
 *
 * Nested markup makes it impractical to find each card's closing tag by regex,
 * so we cut from one `data-asin` card to the start of the next one — sibling
 * cards are sequential, which makes those slices exact for every card but the
 * last, which we bound with the pagination footer.
 */
function trimToResultList(html: string): string {
  // Search pages are ~1-2 MB and the half above the result list is mostly
  // navigation and inline JS. Cutting it keeps the Worker CPU budget intact.
  for (const marker of ['class="s-main-slot', 'data-component-type="s-search-results"', 'id="search"']) {
    const idx = html.indexOf(marker);
    if (idx > 0) return html.slice(idx);
  }
  return html;
}

function splitResultBlocks(html: string): Array<{ asin: string; block: string; index: number }> {
  const cardRe = /<div[^>]*\sdata-asin="([A-Z0-9]{10})"[^>]*>/gi;
  const starts: Array<{ asin: string; at: number }> = [];
  let m: RegExpExecArray | null;

  while ((m = cardRe.exec(html)) !== null) {
    const tag = m[0];
    // Keep only the real search-result cards; Amazon also stamps data-asin on
    // carousels, "explore similar" strips and video widgets.
    const isResult =
      /data-component-type="s-search-result"/i.test(tag) ||
      /class="[^"]*\bs-result-item\b[^"]*"/i.test(tag) ||
      /data-uuid=/i.test(tag);
    if (!isResult) continue;
    if (starts.length && starts[starts.length - 1].asin === m[1]) continue;
    starts.push({ asin: m[1], at: m.index });
  }

  const tail = findTailBoundary(html);
  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : Math.min(tail, start.at + 30000);
    return { asin: start.asin, block: html.slice(start.at, end), index: i };
  });
}

function findTailBoundary(html: string): number {
  for (const marker of ['s-pagination-container', 'class="s-pagination', 'data-component-type="s-result-info-bar"', '<div class="s-desktop-toolbar']) {
    const idx = html.lastIndexOf(marker);
    if (idx > 0) return idx;
  }
  return html.length;
}

function extractTitle(block: string): string | null {
  return firstMatch(block, [
    /<h2[^>]*\saria-label="([^"]{3,400})"/i,
    /data-cy="title-recipe"[\s\S]{0,900}?<h2[^>]*>[\s\S]{0,300}?<span[^>]*>([^<]{3,400})<\/span>/i,
    /<h2[^>]*>[\s\S]{0,300}?<span[^>]*>([^<]{3,400})<\/span>/i,
    /<a[^>]*class="[^"]*s-line-clamp[^"]*"[^>]*>\s*<span[^>]*>([^<]{3,400})<\/span>/i,
    /<img[^>]*class="[^"]*\bs-image\b[^"]*"[^>]*\salt="([^"]{3,400})"/i,
    /<img[^>]*\salt="([^"]{3,400})"[^>]*class="[^"]*\bs-image\b[^"]*"/i,
  ]);
}

function extractImage(block: string): string {
  const src = firstMatch(block, [
    /<img[^>]*class="[^"]*\bs-image\b[^"]*"[^>]*\ssrc="([^"]+)"/i,
    /<img[^>]*\ssrc="([^"]+)"[^>]*class="[^"]*\bs-image\b[^"]*"/i,
    /<img[^>]*\ssrc="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i,
  ]);
  return src ?? "";
}

function extractAuthor(block: string): string {
  // The byline row sits right under the title and starts with a localized "by".
  const bylineRegions = [
    /data-cy="title-recipe"[\s\S]{0,1500}?(<div class="a-row a-size-base a-color-secondary[\s\S]{0,600}?<\/div>)/i,
    /(<div class="a-row a-size-base a-color-secondary[^"]*"[^>]*>[\s\S]{0,600}?<\/div>)/i,
    /(<div[^>]*class="[^"]*a-color-secondary[^"]*"[^>]*>[\s\S]{0,600}?<\/div>)/i,
  ];
  for (const region of bylineRegions) {
    const m = region.exec(block);
    if (!m) continue;
    const text = stripTags(m[1]);
    const cleaned = cleanByline(text);
    if (cleaned) return cleaned;
  }
  const anchor = firstMatch(block, [
    /<a[^>]*class="[^"]*a-size-base[^"]*a-link-normal[^"]*"[^>]*>([^<]{2,80})<\/a>/i,
  ]);
  return anchor ? cleanByline(anchor) ?? "" : "";
}

function cleanByline(text: string): string | null {
  if (!text) return null;
  let out = text
    .replace(/^(?:by|de|von|par|di|door|av|przez)\s+/i, "")
    .replace(/\s*\|\s*.*$/, "")
    .replace(/\s*,\s*et al\.?$/i, "")
    .replace(/\s*\(author\)|\s*\(autor(?:a)?\)/i, "")
    .trim();
  // Drop rows that are clearly not a byline (dates, prices, format labels).
  if (!out || out.length < 2 || out.length > 120) return null;
  if (/^\d/.test(out) && /\d{4}/.test(out)) return null;
  if (/^(kindle|paperback|hardcover|tapa|audible)/i.test(out)) return null;
  return out;
}

function extractFormat(block: string): { format: BookFormat; label: string } {
  const candidates = allMatches(
    block,
    /<a[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>\s*<span[^>]*a-color-secondary[^>]*>([^<]{3,40})<\/span>/gi,
  ).concat(
    allMatches(block, /<span[^>]*class="[^"]*a-size-base a-color-secondary a-text-normal[^"]*"[^>]*>([^<]{3,40})<\/span>/gi),
  );

  for (const candidate of candidates) {
    for (const { re, format } of FORMAT_WORDS) {
      if (re.test(candidate)) return { format, label: candidate.trim() || FORMAT_LABELS[format] };
    }
  }
  // Fall back to scanning the whole card.
  for (const { re, format } of FORMAT_WORDS) {
    if (re.test(block)) return { format, label: FORMAT_LABELS[format] };
  }
  return { format: "other", label: FORMAT_LABELS.other };
}

function extractPrice(block: string): number | null {
  const offscreen = firstMatch(block, [
    /<span class="a-price"[^>]*>\s*<span class="a-offscreen">([^<]+)<\/span>/i,
    /<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/i,
  ]);
  const price = parsePrice(offscreen);
  if (price) return price;

  const whole = firstMatch(block, [/<span class="a-price-whole">([\d.,\s]+)/i]);
  const fraction = firstMatch(block, [/<span class="a-price-fraction">(\d+)</i]);
  if (whole) {
    const composed = parsePrice(`${whole.replace(/[^\d.,]/g, "")}${fraction ? "." + fraction : ""}`);
    if (composed) return composed;
  }
  return null;
}

function extractRating(block: string): number | null {
  const raw = firstMatch(block, [
    /<span class="a-icon-alt">([^<]+)<\/span>/i,
    /\saria-label="([\d.,]+\s+(?:out of|de|von|sur|su|van)[^"]*)"/i,
    /data-cy="reviews-block"[\s\S]{0,400}?aria-label="([^"]+)"/i,
  ]);
  return parseRating(raw);
}

function extractReviews(block: string): number | null {
  const reviewRegion = /data-cy="reviews-block"([\s\S]{0,1200})/i.exec(block)?.[1] ?? block;

  // Newer markup exposes the count in the link's aria-label.
  const ariaLabel = firstMatch(reviewRegion, [
    /aria-label="[^"]*?([\d][\d.,\s]{0,12})\s*(?:ratings?|reviews?|calificaciones|valoraciones|rese[ñn]as|bewertungen|rezensionen|[ée]valuations|commentaires|recensioni|avalia[çc][õo]es|beoordelingen)"/i,
  ]);
  const fromAria = parseInteger(ariaLabel);
  if (fromAria) return fromAria;

  const spanCount = firstMatch(reviewRegion, [
    /<span[^>]*class="[^"]*s-underline-text[^"]*"[^>]*>\s*\(?([\d][\d.,\s]{0,12})\)?\s*<\/span>/i,
    /<a[^>]*class="[^"]*s-underline-link-text[^"]*"[^>]*>\s*<span[^>]*>\s*\(?([\d][\d.,\s]{0,12})\)?\s*<\/span>/i,
    /<span[^>]*aria-label="[^"]*"[^>]*class="[^"]*a-size-base[^"]*"[^>]*>\s*([\d][\d.,\s]{0,12})\s*<\/span>/i,
  ]);
  const fromSpan = parseInteger(spanCount);
  if (fromSpan !== null && fromSpan >= 0 && fromSpan < 10_000_000) return fromSpan;

  return null;
}

function extractResultsCount(html: string): { total: number | null; text: string | null } {
  const region =
    /data-component-type="s-result-info-bar"([\s\S]{0,3000})/i.exec(html)?.[1] ??
    /<h1[^>]*>([\s\S]{0,1500}?)<\/h1>/i.exec(html)?.[1] ??
    html.slice(0, 40000);

  const text = stripTags(
    /<span[^>]*>([^<]*(?:results?|resultados|Ergebnisse|r[ée]sultats|risultati|resultaten)[^<]*)<\/span>/i.exec(region)?.[1] ??
      /(\d[\d.,\s]*\s*(?:results?|resultados|Ergebnisse|r[ée]sultats|risultati))/i.exec(stripTags(region))?.[1] ??
      "",
  );
  if (!text) return { total: null, text: null };

  // "1-16 of over 40,000 results" — the biggest number in the phrase is the total.
  const numbers = (text.match(/[\d][\d.,\s]*/g) ?? [])
    .map((n) => parseInteger(n))
    .filter((n): n is number => n !== null);
  const total = numbers.length ? Math.max(...numbers) : null;
  return { total, text: text.slice(0, 120) };
}

/**
 * Amazon's own "nothing matched" banner, across the storefront languages we
 * support. Worth telling apart from a parse failure: one is an answer about the
 * market — usually a department that simply has no books for the phrase — and
 * the other is a bug in this file. Reporting the first as the second sends the
 * operator hunting for a problem that does not exist.
 */
const NO_RESULTS_RE = new RegExp(
  [
    "No results for", "No results found", "did not match any products",
    "No hay resultados para", "No se han encontrado resultados", "no ha obtenido resultados",
    "Keine Ergebnisse f\u00fcr", "Aucun r\u00e9sultat pour", "Nessun risultato per",
    "Geen resultaten voor", "Nenhum resultado para", "Brak wynik\u00f3w", "Inga resultat",
  ].join("|"),
  "i",
);

export function parseSearchPage(
  html: string,
  marketplace: Marketplace,
  startPosition = 0,
  maxItems = 60,
): SearchPageResult {
  const { total, text } = extractResultsCount(html);
  const blocks = splitResultBlocks(trimToResultList(html)).slice(0, maxItems);
  const items: BookRecord[] = [];
  let position = startPosition;

  for (const { asin, block } of blocks) {
    const title = extractTitle(block);
    if (!title) continue;

    const sponsored = SPONSORED_RE.test(block);
    if (!sponsored) position += 1;

    const { format, label } = extractFormat(block);
    items.push({
      asin,
      title: decodeEntities(title).trim(),
      author: extractAuthor(block),
      url: `https://${marketplace.host}/dp/${asin}`,
      image: extractImage(block),
      format,
      formatLabel: label,
      price: extractPrice(block),
      rating: extractRating(block),
      reviews: extractReviews(block),
      sponsored,
      kindleUnlimited: KU_RE.test(block),
      position: sponsored ? 0 : position,

      bsr: null,
      categoryRanks: [],
      pages: null,
      publisher: null,
      publishedAt: null,
      language: null,
      isbn: null,
      dimensions: null,
      selfPublished: null,
      enriched: false,

      salesPerMonth: null,
      revenuePerMonth: null,
      royaltyPerUnit: null,
      ageMonths: null,
      weakness: null,
    });
  }

  return {
    items,
    totalResults: total,
    resultsCountText: text,
    rawItemCount: blocks.length,
    // Only worth asking when nothing came back; a page full of books is an
    // answer already, and the regex costs a pass over the markup.
    noResults: blocks.length === 0 && NO_RESULTS_RE.test(html),
  };
}
