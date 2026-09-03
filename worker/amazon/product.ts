import type { BookFormat, CategoryRank } from "../../shared/types";
import { decodeEntities, firstMatch, parseDate, parseInteger, parsePrice, parseRating, stripTags } from "./html";

export interface ProductDetail {
  asin: string;
  title: string | null;
  author: string | null;
  image: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  bsr: number | null;
  categoryRanks: CategoryRank[];
  pages: number | null;
  publisher: string | null;
  publishedAt: string | null;
  language: string | null;
  isbn: string | null;
  dimensions: string | null;
  format: BookFormat | null;
  formatLabel: string | null;
  selfPublished: boolean | null;
}

/**
 * Amazon detail pages weigh 1-2 MB, most of it inline JavaScript. Running a
 * dozen regexes across all of that burns the Worker CPU budget, so every
 * extractor below first narrows to a small window located with `indexOf`
 * (a native substring search) and only then applies patterns.
 */
function regionAround(html: string, needles: string[], before = 400, after = 4000): string | null {
  for (const needle of needles) {
    const idx = html.indexOf(needle);
    if (idx >= 0) return html.slice(Math.max(0, idx - before), Math.min(html.length, idx + after));
  }
  return null;
}

function regionAroundCI(html: string, lowerHtml: string, needles: string[], before = 200, after = 2400): string | null {
  for (const needle of needles) {
    const idx = lowerHtml.indexOf(needle.toLowerCase());
    if (idx >= 0) return html.slice(Math.max(0, idx - before), Math.min(html.length, idx + after));
  }
  return null;
}

const BSR_LABELS = [
  "Best Sellers Rank",
  "Best-sellers rank",
  "Amazon Best Sellers Rank",
  "Clasificación en los más vendidos",
  "Amazon Bestseller-Rang",
  "Classement des meilleures ventes",
  "Posizione nella classifica Bestseller",
  "Ranking dos mais vendidos",
  "Plaats in bestsellerlijst",
];

const PAGES_LABELS = ["Print length", "Número de páginas", "Longitud de impresión", "Páginas", "Seitenzahl der Print-Ausgabe", "Nombre de pages", "Lunghezza stampa", "Aantal pagina"];
const PUBLISHER_LABELS = ["Publisher", "Editorial", "Herausgeber", "Éditeur", "Editeur", "Editore", "Editora", "Uitgever"];
const PUBDATE_LABELS = ["Publication date", "Fecha de publicación", "Erscheinungstermin", "Date de publication", "Data di pubblicazione", "Data de publicação", "Publicatiedatum"];
const LANGUAGE_LABELS = ["Language", "Idioma", "Sprache", "Langue", "Lingua", "Taal"];
const DIMENSION_LABELS = ["Product Dimensions", "Dimensions", "Dimensiones del producto", "Dimensiones", "Produktabmessungen", "Dimensions du produit", "Dimensioni"];

const SELF_PUBLISHED_RE =
  /independently published|publicaci[óo]n independiente|independiente|createspace|kindle direct publishing|amazon digital services|amazon\.com services|self[- ]published|autopublicado|selbstverlag|books on demand|lulu\.com|bookbaby|draft2digital|ingramspark/i;

/**
 * Collect the detail widgets. Which one exists depends on the A/B bucket, so
 * we concatenate whichever are present and parse their union.
 */
function detailRegion(html: string): string {
  const WIDGET_LENGTH = 14000;
  const spans: Array<[number, number]> = [];
  for (const id of [
    'id="detailBulletsWrapper_feature_div"',
    'id="detailBullets_feature_div"',
    'id="productDetails_detailBullets_sections1"',
    'id="productDetails_techSpec_section_1"',
    'id="productDetailsTable"',
    'id="richProductInformation_feature_div"',
    'id="detailBullets"',
    'id="prodDetails"',
  ]) {
    const idx = html.indexOf(id);
    if (idx >= 0) spans.push([idx, Math.min(html.length, idx + WIDGET_LENGTH)]);
    if (spans.length >= 4) break;
  }

  if (spans.length) {
    // These widgets nest inside one another, so naively concatenating their
    // slices would feed the same sales-rank block to the parser twice. Merge
    // the overlapping ranges first and emit each byte at most once.
    spans.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [spans[0]];
    for (const [start, end] of spans.slice(1)) {
      const last = merged[merged.length - 1];
      if (start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged.map(([start, end]) => html.slice(start, end)).join("\n");
  }

  // No known widget id: fall back to a window around the sales-rank label,
  // which sits inside whatever detail block the page is using.
  const lower = html.toLowerCase();
  const fallback = regionAroundCI(html, lower, BSR_LABELS, 9000, 6000);
  return fallback ?? html.slice(0, 60000);
}

/**
 * Read one "label: value" pair. Amazon renders these as either a table row or
 * a detail bullet, and in both cases the value is bounded by the very next
 * closing tag — reading past it would splice the following field onto this one.
 */
/**
 * Amazon's "rich product information" widget, which most book pages now use
 * instead of bullet lists or the attribute table. Each field is a container
 * tagged with `data-rpi-attribute-name`, and the value sits in a child element
 * whose class contains `rpi-attribute-value`:
 *
 *   <div data-rpi-attribute-name="book_details-publisher" ...>
 *     <div class="rpi-attribute-label"><span>Publisher</span></div>
 *     <div class="rpi-attribute-value"><span>Independently published</span></div>
 *   </div>
 *
 * The attribute name carries the `book_details-` prefix on some fields and not
 * on others, so both spellings are tried.
 */
function readRpiField(html: string, names: string[]): string | null {
  for (const name of names) {
    for (const attr of [`data-rpi-attribute-name="book_details-${name}"`, `data-rpi-attribute-name="${name}"`]) {
      const idx = html.indexOf(attr);
      if (idx < 0) continue;
      const value = firstMatch(html.slice(idx, idx + 1400), [
        /class="[^"]*rpi-attribute-value[^"]*"[^>]*>\s*(?:<[a-z][^>]*>\s*)?([^<]{1,220})/i,
      ]);
      if (value) return value.trim().slice(0, 220) || null;
    }
  }
  return null;
}

/**
 * Find a label as *visible text*, never inside a tag.
 *
 * Searching the raw HTML for "Language" also hits attributes such as
 * `data-rpi-attribute-name="book_details-language"`, and reading the value
 * after that match yields fragments of markup rather than the field.
 */
/**
 * Turn a raw capture into a field value, or nothing at all.
 *
 * Amazon pads its detail separators with bidi control marks, and a strategy
 * that misses can easily come back holding a fragment of markup. Returning
 * null for those keeps a wrong value out of the UI: an honest dash is visibly
 * missing data, whereas "&rlm; : &lrm; <" reads as if it were a publisher.
 */
function sanitizeFieldValue(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const text = stripTags(raw)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/^[\s:.\u2013\u2014-]+/, "")
    .replace(/[\s:]+$/, "")
    .trim();
  if (text.length < 2) return null;
  // Leftover markup: a real value never carries these.
  if (/[<>]|data-[a-z-]+=|rpi-attribute|a-list-item|&[a-z]{2,6};/i.test(text)) return null;
  return text.slice(0, 220);
}

function findVisibleLabel(region: string, lowerRegion: string, label: string): number {
  const needle = label.toLowerCase();
  let from = 0;
  while (from <= lowerRegion.length) {
    const idx = lowerRegion.indexOf(needle, from);
    if (idx < 0) return -1;
    // Inside a tag when the nearest "<" before the match has not been closed.
    if (region.lastIndexOf(">", idx) >= region.lastIndexOf("<", idx)) return idx;
    from = idx + needle.length;
  }
  return -1;
}

function readDetailField(region: string, lowerRegion: string, labels: string[]): string | null {
  for (const label of labels) {
    const idx = findVisibleLabel(region, lowerRegion, label);
    if (idx < 0) continue;
    const window = region.slice(idx, idx + 900);

    // <th>Label</th><td>value</td>
    const cell = /^[\s\S]{0,200}?<\/th>\s*<td[^>]*>([\s\S]{0,400}?)<\/td>/i.exec(window);
    const fromCell = sanitizeFieldValue(cell?.[1]);
    if (fromCell) return fromCell;

    // <span class="a-text-bold">Label : </span> <span>value</span>
    const bullet = /^[\s\S]{0,200}?<\/span>\s*<span[^>]*>([\s\S]{0,400}?)<\/span>/i.exec(window);
    const fromBullet = sanitizeFieldValue(bullet?.[1]);
    if (fromBullet) return fromBullet;

    // Anything else: the first real text node after the label's own element.
    // Amazon wraps values in whatever container the current layout uses, so
    // rather than guess the tag we skip the label's markup and take the next
    // piece of text that survives sanitising.
    const labelEnd = window.indexOf("<", label.length);
    if (labelEnd >= 0) {
      for (const chunk of window.slice(labelEnd).split(/<[^>]*>/)) {
        const value = sanitizeFieldValue(chunk);
        if (value) return value;
      }
    }
  }
  return null;
}

/** Strip the "(See Top 100 in Books)" link text, which mimics a rank phrase. */
function cleanRankText(text: string): string {
  return text
    .replace(/\(\s*(?:see|ver|voir|siehe|vedi|veja)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBsr(html: string, lowerHtml: string, detail: string): { bsr: number | null; ranks: CategoryRank[] } {
  const lowerDetail = detail.toLowerCase();
  let block: string | null = null;
  for (const label of BSR_LABELS) {
    const idx = lowerDetail.indexOf(label.toLowerCase());
    if (idx >= 0) { block = detail.slice(idx, idx + 2400); break; }
  }
  if (!block) block = regionAroundCI(html, lowerHtml, BSR_LABELS, 0, 2400);
  if (!block) return { bsr: null, ranks: [] };

  // Each rank looks like "#3,024 in Books" ("n.º 3.024 en Libros",
  // "Nr. 3.024 in Bücher"), and on some storefronts the store-wide one arrives
  // with no "#" at all ("142,905 in Books").
  //
  // Turning every tag into a line break first is what makes this reliable:
  // each rank then sits on its own line, so a category name is bounded by the
  // element that holds it. Matching across the flattened text instead let the
  // final category swallow whatever section came next on the page.
  const lines = decodeEntities(block.replace(/<[^>]*>/g, "\n"))
    .split("\n")
    .map((line) => cleanRankText(line))
    // "See Top 100 in Books" is navigation that reads exactly like a rank.
    .filter((line) => line.length > 0 && !/^(?:see|ver|voir|siehe|vedi|veja)\b/i.test(line));

  const rankRe = /(?:#|n\.?\s?[ºo°]\s?|nr\.?\s?)?\s*([\d][\d.,\s]{0,12})\s+(?:in|en|dans|nella|nei|na|em|i)\s+(.{2,80}?)\s*$/i;

  const ranks: CategoryRank[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const m = rankRe.exec(line);
    if (!m) continue;
    const rank = parseInteger(m[1]);
    if (!rank || rank >= 50_000_000) continue;
    const name = m[2].replace(/[\s(:;,.]+$/, "").trim();
    if (name.length < 2) continue;
    const key = `${name.toLowerCase()}|${rank}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranks.push({ name, rank });
    if (ranks.length >= 8) break;
  }

  if (!ranks.length) return { bsr: null, ranks: [] };
  return { bsr: ranks[0].rank, ranks: ranks.slice(1) };
}

function extractPages(detail: string, lowerDetail: string): number | null {
  const raw = readDetailField(detail, lowerDetail, PAGES_LABELS);
  const fromLabel = parseInteger(raw?.match(/[\d.,]+/)?.[0] ?? null);
  if (fromLabel && fromLabel > 0 && fromLabel < 20000) return fromLabel;

  const loose = firstMatch(detail, [/([\d.,]{1,7})\s*(?:pages|páginas|Seiten|pagine|pagina's)\b/i]);
  const value = parseInteger(loose);
  return value && value > 0 && value < 20000 ? value : null;
}

const FORMAT_TABLE: Array<[RegExp, BookFormat]> = [
  [/hardcover|tapa dura|gebundene|reli[ée]|copertina rigida|capa dura/i, "hardcover"],
  [/mass market paperback|paperback|tapa blanda|taschenbuch|broch[ée]|copertina flessibile|capa comum/i, "paperback"],
  [/kindle/i, "kindle"],
  [/audible|audiobook|audiolibro|h[öo]rbuch/i, "audible"],
  [/spiral/i, "spiral"],
  [/board book/i, "board"],
];

function extractFormat(html: string): { format: BookFormat | null; label: string | null } {
  const region =
    regionAround(html, ['id="productSubtitle"', 'id="tmmSwatches"', 'id="formats"'], 200, 3000) ?? "";
  const label = firstMatch(region, [
    /id="productSubtitle"[^>]*>([^<]{3,60})</i,
    /class="[^"]*a-button-selected[^"]*"[\s\S]{0,500}?<span[^>]*class="[^"]*slot-title[^"]*"[^>]*>\s*<span[^>]*>([^<]{3,40})<\/span>/i,
  ]);
  const haystack = label ?? region;
  for (const [re, format] of FORMAT_TABLE) {
    if (re.test(haystack)) return { format, label: label?.trim() ?? null };
  }
  return { format: null, label: label?.trim() ?? null };
}

export function parseProductPage(html: string, asin: string): ProductDetail {
  const lowerHtml = html.toLowerCase();
  const detail = detailRegion(html);
  const lowerDetail = detail.toLowerCase();

  const { bsr, ranks } = extractBsr(html, lowerHtml, detail);
  const { format, label } = extractFormat(html);

  const publisherRaw =
    readRpiField(html, ["publisher"]) ?? readDetailField(detail, lowerDetail, PUBLISHER_LABELS);
  // Often written as "Independently published (May 1, 2023)".
  const publisher = publisherRaw
    ? publisherRaw.replace(/\s*\([^)]*\)\s*$/, "").replace(/[;,]\s*$/, "").trim().slice(0, 120) || null
    : null;

  const pubDateRaw =
    readRpiField(html, ["publication_date"]) ??
    readDetailField(detail, lowerDetail, PUBDATE_LABELS) ??
    publisherRaw;
  const publishedAt = parseDate(pubDateRaw);

  const titleRegion = regionAround(html, ['id="productTitle"', 'id="title"'], 200, 1200) ?? "";
  const title = firstMatch(titleRegion, [
    /id="productTitle"[^>]*>([\s\S]{1,500}?)<\/span>/i,
    /<h1[^>]*id="title"[^>]*>([\s\S]{1,500}?)<\/h1>/i,
  ]) ?? firstMatch(html.slice(0, 3000), [/<title>([^<]{3,300})<\/title>/i]);

  const bylineRegion = regionAround(html, ['id="bylineInfo"', 'class="author'], 200, 2500) ?? "";
  const author = firstMatch(bylineRegion, [
    /class="[^"]*contributorNameID[^"]*"[^>]*>([^<]{2,80})<\/a>/i,
    /class="author[^"]*"[\s\S]{0,400}?<a[^>]*>([^<]{2,80})<\/a>/i,
    /id="bylineInfo"[\s\S]{0,500}?<a[^>]*>([^<]{2,80})<\/a>/i,
  ]);

  const imageRegion = regionAround(html, ['id="landingImage"', 'id="imgBlkFront"', 'id="imgTagWrapperId"', '"hiRes"'], 400, 3000) ?? "";
  const image = firstMatch(imageRegion, [
    /data-old-hires="(https:\/\/[^"]+)"/i,
    /"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i,
    /"large":"(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i,
    /<img[^>]*\ssrc="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/i,
  ]);

  // Book pages put the price in the buy box, in the format swatches, or both.
  const priceRegion =
    regionAround(html, [
      'id="corePriceDisplay', 'id="corePrice_feature_div"', 'id="corePrice_desktop"',
      'id="price"', 'class="slot-price"', 'class="a-price"',
    ], 300, 3500) ?? "";
  const price = parsePrice(
    firstMatch(priceRegion, [
      /class="[^"]*a-price[^"]*"[^>]*>\s*<span[^>]*class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/i,
      /class="[^"]*a-offscreen[^"]*"[^>]*>([^<]+)<\/span>/i,
      /class="[^"]*slot-price[^"]*"[^>]*>\s*(?:<span[^>]*>\s*)?([^<]+)/i,
      /id="price"[^>]*>([^<]+)</i,
    ]),
  );

  const reviewRegion =
    regionAround(html, ['id="averageCustomerReviews"', 'id="acrPopover"', 'id="acrCustomerReviewText"'], 300, 6000) ?? "";
  const rating = parseRating(
    firstMatch(reviewRegion, [
      /id="acrPopover"[^>]*\stitle="([^"]+)"/i,
      /class="[^"]*a-icon-alt[^"]*"[^>]*>([^<]+)<\/span>/i,
    ]),
  );
  const reviews = parseInteger(
    firstMatch(reviewRegion, [
      /id="acrCustomerReviewText"[^>]*>\s*([\d.,\s]+)/i,
      /([\d.,]+)\s*(?:global ratings?|ratings?|calificaci[óo]n(?:es)?|valoraci[óo]n(?:es)?|rese[ñn]as?|Bewertung(?:en)?|[ée]valuations?|recension[ei]|avalia)/i,
    ]),
  );

  const isbnRaw =
    readRpiField(html, ["isbn13", "isbn10"]) ??
    readDetailField(detail, lowerDetail, ["ISBN-13"]) ??
    readDetailField(detail, lowerDetail, ["ISBN-10"]);
  const isbn = isbnRaw ? (isbnRaw.replace(/[^0-9Xx-]/g, "").slice(0, 20) || null) : null;

  const language =
    readRpiField(html, ["language"]) ?? readDetailField(detail, lowerDetail, LANGUAGE_LABELS);
  const dimensions =
    readRpiField(html, ["dimensions"]) ?? readDetailField(detail, lowerDetail, DIMENSION_LABELS);

  return {
    asin,
    title: title ? stripTags(title).replace(/\s*[:|-]\s*Amazon\..*$/i, "").slice(0, 400) : null,
    author: author ? decodeEntities(author).trim() : null,
    image,
    price,
    rating,
    reviews,
    bsr,
    categoryRanks: ranks,
    pages:
      parseInteger(readRpiField(html, ["print_length", "fiona_pages", "ebook_pages"])) ??
      extractPages(detail, lowerDetail),
    publisher,
    publishedAt,
    language: language ? language.split(/[,;]/)[0].trim().slice(0, 40) : null,
    isbn,
    dimensions: dimensions ? dimensions.slice(0, 80) : null,
    format,
    formatLabel: label,
    selfPublished: publisher ? SELF_PUBLISHED_RE.test(publisher) : null,
  };
}
