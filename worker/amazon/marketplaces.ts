import type { Marketplace, MarketplaceId } from "../../shared/types";
import { CURRENCY_SYMBOLS } from "../../shared/currency";

/**
 * `mid` is Amazon's marketplace id. The autocomplete endpoint refuses to answer
 * without the one matching the storefront you are querying.
 */
export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  "com": { id: "com", host: "www.amazon.com", label: "Estados Unidos", flag: "🇺🇸", currency: "USD", currencySymbol: "", language: "en_US", mid: "ATVPDKIKX0DER", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "co.uk": { id: "co.uk", host: "www.amazon.co.uk", label: "Reino Unido", flag: "🇬🇧", currency: "GBP", currencySymbol: "", language: "en_GB", mid: "A1F83G8C2ARO7P", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "de": { id: "de", host: "www.amazon.de", label: "Alemania", flag: "🇩🇪", currency: "EUR", currencySymbol: "", language: "de_DE", mid: "A1PA6795UKMFR9", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "es": { id: "es", host: "www.amazon.es", label: "España", flag: "🇪🇸", currency: "EUR", currencySymbol: "", language: "es_ES", mid: "A1RKKUPIHCS9HS", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "fr": { id: "fr", host: "www.amazon.fr", label: "Francia", flag: "🇫🇷", currency: "EUR", currencySymbol: "", language: "fr_FR", mid: "A13V1IB3VIYZZH", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "it": { id: "it", host: "www.amazon.it", label: "Italia", flag: "🇮🇹", currency: "EUR", currencySymbol: "", language: "it_IT", mid: "APJ6JRA9NG5V4", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "co.jp": { id: "co.jp", host: "www.amazon.co.jp", label: "Japón", flag: "🇯🇵", currency: "JPY", currencySymbol: "", language: "ja_JP", mid: "A1VC38T7YXB528", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "ca": { id: "ca", host: "www.amazon.ca", label: "Canadá", flag: "🇨🇦", currency: "CAD", currencySymbol: "", language: "en_CA", mid: "A2EUQ1WTGCTBG2", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "com.au": { id: "com.au", host: "www.amazon.com.au", label: "Australia", flag: "🇦🇺", currency: "AUD", currencySymbol: "", language: "en_AU", mid: "A39IBJ37TRP1C6", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "com.mx": { id: "com.mx", host: "www.amazon.com.mx", label: "México", flag: "🇲🇽", currency: "MXN", currencySymbol: "", language: "es_MX", mid: "A1AM78C64UM0Y8", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "com.br": { id: "com.br", host: "www.amazon.com.br", label: "Brasil", flag: "🇧🇷", currency: "BRL", currencySymbol: "", language: "pt_BR", mid: "A2Q3Y263D00KWC", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "in": { id: "in", host: "www.amazon.in", label: "India", flag: "🇮🇳", currency: "INR", currencySymbol: "", language: "en_IN", mid: "A21TJRUUN4KGV", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "nl": { id: "nl", host: "www.amazon.nl", label: "Países Bajos", flag: "🇳🇱", currency: "EUR", currencySymbol: "", language: "nl_NL", mid: "A1805IZSGTT6HS", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "pl": { id: "pl", host: "www.amazon.pl", label: "Polonia", flag: "🇵🇱", currency: "PLN", currencySymbol: "", language: "pl_PL", mid: "A1C3SOZRARQ6R3", booksAlias: "stripbooks", kindleAlias: "digital-text" },
  "se": { id: "se", host: "www.amazon.se", label: "Suecia", flag: "🇸🇪", currency: "SEK", currencySymbol: "", language: "sv_SE", mid: "A2NODRKZP88ZB9", booksAlias: "stripbooks", kindleAlias: "digital-text" },
};

// Fill the symbols from the shared table so the client and the Worker agree.
for (const marketplace of Object.values(MARKETPLACES)) {
  marketplace.currencySymbol = CURRENCY_SYMBOLS[marketplace.id];
}

export const DEFAULT_MARKETPLACE: MarketplaceId = "com";

export function getMarketplace(id: string | undefined | null): Marketplace {
  if (id && id in MARKETPLACES) return MARKETPLACES[id as MarketplaceId];
  return MARKETPLACES[DEFAULT_MARKETPLACE];
}

export function marketplaceList(): Marketplace[] {
  return Object.values(MARKETPLACES);
}

/** Build a books search URL. `department` picks print books vs the Kindle store. */
export function searchUrl(
  m: Marketplace,
  keyword: string,
  page = 1,
  department: "print" | "kindle" | "all" = "print",
): string {
  const params = new URLSearchParams();
  params.set("k", keyword);
  if (department === "print") params.set("i", m.booksAlias);
  else if (department === "kindle") params.set("i", m.kindleAlias);
  if (page > 1) params.set("page", String(page));
  params.set("ref", "sr_pg_" + page);
  // Without this Amazon may serve a storefront in English to datacenter IPs.
  params.set("language", m.language);
  return `https://${m.host}/s?${params.toString()}`;
}

export function productUrl(m: Marketplace, asin: string): string {
  return `https://${m.host}/dp/${asin}?language=${m.language}`;
}

/** Public endpoint that powers the search box's dropdown. */
export function suggestUrl(m: Marketplace, prefix: string, department: "print" | "kindle" | "all" = "print"): string {
  const alias = department === "kindle" ? m.kindleAlias : department === "print" ? m.booksAlias : "aps";
  const params = new URLSearchParams({
    "limit": "11",
    "prefix": prefix,
    "suggestion-type": "KEYWORD",
    "page-type": "Search",
    "alias": alias,
    "site-variant": "desktop",
    "version": "3",
    "event": "onKeyPress",
    "wc": "",
    "lop": m.language,
    "avg-ks-time": "0",
    "fb": "1",
    "session-id": randomSessionId(),
    "request-id": randomRequestId(),
    "mid": m.mid,
    "plain-mid": "1",
    "client-info": "amazon-search-ui",
  });
  return `https://completion.amazon.com/api/2017/suggestions?${params.toString()}`;
}

function randomSessionId(): string {
  const part = () => Math.floor(Math.random() * 9000000 + 1000000).toString();
  return `${part()}-${part()}-${part()}`;
}

function randomRequestId(): string {
  const chars = "ABCDEFGHJKMNPQRSTVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 20; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
