export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  APP_NAME?: string;

  /** Optional gate. When unset the app is open — the UI warns about it. */
  AUTH_PASSWORD?: string;
  /** Signing key for the session cookie. Falls back to AUTH_PASSWORD. */
  AUTH_SECRET?: string;

  /** Optional scraping-proxy credentials (free tiers are enough for personal use). */
  SCRAPER_API_KEY?: string;
  SCRAPINGBEE_API_KEY?: string;
  /** Template with {url} / {url_encoded} placeholders, for any other provider. */
  CUSTOM_PROXY_TEMPLATE?: string;
}

export const APP_VERSION = "1.0.0";
