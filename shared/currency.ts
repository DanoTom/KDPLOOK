import type { MarketplaceId } from "./types";

/**
 * Currency symbol per storefront. Lives in `shared/` because both the Worker's
 * marketplace table and the client-side scoring engine need it.
 */
export const CURRENCY_SYMBOLS: Record<MarketplaceId, string> = {
  "com": "$", "co.uk": "£", "de": "€", "fr": "€", "es": "€", "it": "€",
  "co.jp": "¥", "ca": "CA$", "com.au": "A$", "com.mx": "MX$", "com.br": "R$",
  "in": "₹", "nl": "€", "pl": "zł", "se": "kr",
};

export function currencySymbolFor(marketplace: MarketplaceId): string {
  return CURRENCY_SYMBOLS[marketplace] ?? "$";
}
