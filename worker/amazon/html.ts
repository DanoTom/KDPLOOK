/**
 * Small HTML/text helpers used by the Amazon parsers.
 *
 * The parsers deliberately combine several patterns per field: Amazon ships
 * different markup per storefront, per A/B bucket and per week, so a single
 * "correct" selector does not exist in practice. Every extractor therefore
 * tries a list of strategies and takes the first that yields something sane.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", agrave: "à",
  ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß",
  ntilde: "ñ", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú",
  reg: "®", copy: "©", trade: "™", deg: "°", euro: "€", pound: "£", yen: "¥",
};

export function decodeEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try { return String.fromCodePoint(code); } catch { return ""; }
}

export function stripTags(input: string): string {
  if (!input) return "";
  return decodeEntities(
    input
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function firstMatch(html: string, patterns: RegExp[], group = 1): string | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const m = pattern.exec(html);
    if (m && m[group]) {
      const value = decodeEntities(m[group]).replace(/\s+/g, " ").trim();
      if (value) return value;
    }
  }
  return null;
}

export function allMatches(html: string, pattern: RegExp, group = 1): string[] {
  const out: string[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[group]) out.push(decodeEntities(m[group]).trim());
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** Integers such as review counts or BSR: every locale separator is noise. */
export function parseInteger(input: string | null | undefined): number | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return null;
  const value = parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/**
 * Prices arrive as "$12.99", "12,99 €", "1.234,56 €" or "¥1,200".
 * When both separators appear the right-most one is the decimal point.
 */
export function parsePrice(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised: string;

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalAt = Math.max(lastDot, lastComma);
    normalised = cleaned.slice(0, decimalAt).replace(/[.,]/g, "") + "." + cleaned.slice(decimalAt + 1);
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    normalised = decimals === 1 || decimals === 2
      ? cleaned.replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const decimals = cleaned.length - lastDot - 1;
    normalised = decimals === 1 || decimals === 2 ? cleaned : cleaned.replace(/\./g, "");
  } else {
    normalised = cleaned;
  }

  const value = parseFloat(normalised);
  if (!Number.isFinite(value) || value <= 0 || value > 100000) return null;
  return Math.round(value * 100) / 100;
}

export function parseRating(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(input);
  if (!m) return null;
  const value = parseFloat(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value < 0 || value > 5) return null;
  return Math.round(value * 10) / 10;
}

/** Grab a window of HTML around a label, so field regexes stay local. */
export function sliceAround(html: string, labels: string[], before = 200, after = 1400): string | null {
  const lower = html.toLowerCase();
  for (const label of labels) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx >= 0) {
      return html.slice(Math.max(0, idx - before), Math.min(html.length, idx + after));
    }
  }
  return null;
}

export function sliceById(html: string, ids: string[], length = 20000): string | null {
  for (const id of ids) {
    const idx = html.indexOf(`id="${id}"`);
    if (idx >= 0) return html.slice(idx, idx + length);
  }
  return null;
}

/**
 * Amazon writes dates in many shapes: "May 1, 2023", "1 mayo 2023",
 * "2023-05-01", "1. Mai 2023". Return an ISO date when we can recognise one.
 */
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, enero: 1, ene: 1, januar: 1, janvier: 1, gennaio: 1, janeiro: 1,
  february: 2, feb: 2, febrero: 2, februar: 2, février: 2, fevrier: 2, febbraio: 2, fevereiro: 2,
  march: 3, mar: 3, marzo: 3, märz: 3, marz: 3, mars: 3, março: 3, marco: 3,
  april: 4, apr: 4, abril: 4, avril: 4, aprile: 4,
  may: 5, mayo: 5, mai: 5, maggio: 5, maio: 5,
  june: 6, jun: 6, junio: 6, juni: 6, juin: 6, giugno: 6, junho: 6,
  july: 7, jul: 7, julio: 7, juli: 7, juillet: 7, luglio: 7, julho: 7,
  august: 8, aug: 8, agosto: 8, août: 8, aout: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, septembre: 9, settembre: 9, setembro: 9,
  october: 10, oct: 10, octubre: 10, oktober: 10, octobre: 10, ottobre: 10, outubro: 10,
  november: 11, nov: 11, noviembre: 11, novembre: 11, novembro: 11,
  december: 12, dec: 12, diciembre: 12, dic: 12, dezember: 12, décembre: 12, decembre: 12, dicembre: 12, dezembro: 12,
};

export function parseDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = decodeEntities(input).replace(/\s+/g, " ").trim();

  const iso = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) return toIso(+iso[1], +iso[2], +iso[3]);

  // "1 mayo 2023" / "1. Mai 2023" / "1 de mayo de 2023"
  const dayFirst = /(\d{1,2})\.?\s+(?:de\s+)?([A-Za-zÀ-ÿ]{3,12})\.?\s+(?:de\s+)?(\d{4})/.exec(text);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (month) return toIso(+dayFirst[3], month, +dayFirst[1]);
  }

  // "May 1, 2023" / "May 2023"
  const monthFirst = /([A-Za-zÀ-ÿ]{3,12})\.?\s+(\d{1,2})?,?\s*(\d{4})/.exec(text);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (month) return toIso(+monthFirst[3], month, monthFirst[2] ? +monthFirst[2] : 1);
  }

  // "01/05/2023" — ambiguous, assume day-first outside the US which is the
  // common case for the storefronts that use this format.
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (numeric) return toIso(+numeric[3], +numeric[2], +numeric[1]);

  const yearOnly = /\b(19|20)(\d{2})\b/.exec(text);
  if (yearOnly) return toIso(+`${yearOnly[1]}${yearOnly[2]}`, 1, 1);

  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthsSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = Date.parse(isoDate + "T00:00:00Z");
  if (!Number.isFinite(then)) return null;
  const months = (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
  return months < 0 ? 0 : Math.round(months * 10) / 10;
}
