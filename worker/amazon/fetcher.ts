import type { Env } from "../env";
import type { AppSettings } from "../../shared/types";

export interface FetchOutcome {
  ok: boolean;
  status: number;
  body: string;
  blocked: boolean;
  provider: string;
  ms: number;
  url: string;
  error?: string;
  attempts: number;
}

/**
 * A small pool of current desktop user agents. Amazon fingerprints the whole
 * header set, not just the UA, so each entry ships with matching client hints.
 */
const AGENTS = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    chUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"Windows"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    chUa: '"Google Chrome";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
    platform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
    chUa: "",
    platform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    chUa: '"Chromium";v="129", "Not=A?Brand";v="8"',
    platform: '"Linux"',
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    chUa: "",
    platform: '"Windows"',
  },
];

/** Phrases Amazon serves on its bot-check / throttle pages. */
const BLOCK_MARKERS = [
  "captcha",
  "/errors/validatecaptcha",
  "enter the characters you see below",
  "type the characters you see in this image",
  "to discuss automated access to amazon data",
  "api-services-support@amazon.com",
  "robot check",
  "sorry, we just need to make sure you're not a robot",
  "automated access",
];

export function looksBlocked(status: number, body: string): boolean {
  if (status === 503 || status === 429 || status === 403) return true;
  if (!body) return false;
  // Only inspect the head of the document: the markers all live near the top,
  // and real product pages can legitimately mention "captcha" far below.
  const head = body.slice(0, 6000).toLowerCase();
  return BLOCK_MARKERS.some((m) => head.includes(m));
}

function buildHeaders(targetUrl: string, language: string, seed: number): HeadersInit {
  const agent = AGENTS[seed % AGENTS.length];
  const lang = language.replace("_", "-");
  const base = lang.split("-")[0];
  const headers: Record<string, string> = {
    "User-Agent": agent.ua,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": `${lang},${base};q=0.9,en;q=0.6`,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Device-Memory": "8",
    "Downlink": "10",
    "Ect": "4g",
    "Rtt": "50",
  };
  if (agent.chUa) {
    headers["Sec-Ch-Ua"] = agent.chUa;
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = agent.platform;
    headers["Sec-Ch-Ua-Platform-Version"] = '"15.0.0"';
  }
  try {
    const u = new URL(targetUrl);
    if (u.pathname.startsWith("/dp/") || u.pathname.startsWith("/gp/")) {
      headers["Referer"] = `${u.origin}/`;
      headers["Sec-Fetch-Site"] = "same-origin";
    }
  } catch { /* non-fatal: the referer is only a nicety */ }
  return headers;
}

/** Wrap the target URL in whichever scraping provider the user configured. */
/**
 * ISO country to route a proxied request through, from the storefront being
 * asked. Providers default to the United States, and Amazon.es answered from a
 * US address is not the Amazon.es a shopper in Spain sees — different
 * experience, sometimes a redirect, and results that do not match the store the
 * report claims to describe.
 */
const PROXY_COUNTRY: Record<string, string> = {
  "amazon.com": "us", "amazon.co.uk": "gb", "amazon.de": "de", "amazon.fr": "fr",
  "amazon.es": "es", "amazon.it": "it", "amazon.co.jp": "jp", "amazon.ca": "ca",
  "amazon.com.au": "au", "amazon.com.mx": "mx", "amazon.com.br": "br",
  "amazon.in": "in", "amazon.nl": "nl", "amazon.pl": "pl", "amazon.se": "se",
};

function countryFor(targetUrl: string): string | null {
  try {
    const host = new URL(targetUrl).hostname.replace(/^www\./, "");
    return PROXY_COUNTRY[host] ?? null;
  } catch {
    return null;
  }
}

function wrapWithProvider(
  targetUrl: string,
  settings: AppSettings,
  env: Env,
  /**
   * Requests that Amazon answers happily from a datacenter, and which are far
   * too numerous to pay for.
   *
   * The autocomplete endpoint has never been refused — a deep expansion fires
   * over a hundred probes and they come back — while search and detail pages are
   * exactly what gets blocked. Provider credits are scarce and not free (a trial,
   * then tens of dollars a month), so routing the probes through one would spend
   * an allowance meant for the pages that actually need help.
   */
  cheap = false,
): { url: string; provider: string; direct: boolean } {
  if (cheap) return { url: targetUrl, provider: "direct", direct: true };
  const encoded = encodeURIComponent(targetUrl);
  const country = countryFor(targetUrl);
  switch (settings.provider) {
    case "scraperapi": {
      const key = env.SCRAPER_API_KEY;
      if (!key) break;
      return {
        url: `https://api.scraperapi.com/?api_key=${encodeURIComponent(key)}&url=${encoded}&keep_headers=true`
          + (country ? `&country_code=${country}` : ""),
        provider: "scraperapi",
        direct: false,
      };
    }
    case "scrapingbee": {
      const key = env.SCRAPINGBEE_API_KEY;
      if (!key) break;
      return {
        url: `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(key)}&url=${encoded}&render_js=false&forward_headers=true`
          + (country ? `&country_code=${country}` : ""),
        provider: "scrapingbee",
        direct: false,
      };
    }
    case "custom": {
      const tpl = env.CUSTOM_PROXY_TEMPLATE || settings.customProxyTemplate;
      if (!tpl) break;
      const url = tpl.replace("{url_encoded}", encoded).replace("{url}", targetUrl);
      return { url, provider: "custom", direct: false };
    }
    default:
      break;
  }
  return { url: targetUrl, provider: "direct", direct: true };
}

export interface FetchOptions {
  /** Amazon locale string such as `en_US`; drives Accept-Language. */
  language?: string;
  attempts?: number;
  json?: boolean;
  timeoutMs?: number;
}

/**
 * Fetch a URL with browser-ish headers, retrying with a different fingerprint
 * whenever Amazon answers with a bot check.
 */
export async function fetchPage(
  env: Env,
  settings: AppSettings,
  targetUrl: string,
  opts: FetchOptions = {},
): Promise<FetchOutcome> {
  const started = Date.now();
  const maxAttempts = Math.max(1, Math.min(4, opts.attempts ?? 3));
  const language = opts.language ?? "en_US";
  const { url: requestUrl, provider } = wrapWithProvider(targetUrl, settings, env, opts.json === true);

  let lastStatus = 0;
  let lastBody = "";
  let lastError: string | undefined;
  let attempt = 0;

  for (attempt = 1; attempt <= maxAttempts; attempt++) {
    const seed = Math.floor(Math.random() * 1000) + attempt;
    const headers = opts.json
      ? {
          "User-Agent": AGENTS[seed % AGENTS.length].ua,
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": language.replace("_", "-"),
          "Referer": "https://www.amazon.com/",
        }
      : buildHeaders(targetUrl, language, seed);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
      let res: Response;
      try {
        res = await fetch(requestUrl, {
          headers,
          redirect: "follow",
          signal: controller.signal,
          cf: { cacheTtl: 0, cacheEverything: false },
        } as RequestInit);
      } finally {
        clearTimeout(timer);
      }

      lastStatus = res.status;
      lastBody = await res.text();
      const blocked = looksBlocked(res.status, lastBody);

      if (res.ok && !blocked) {
        return {
          ok: true, status: res.status, body: lastBody, blocked: false,
          provider, ms: Date.now() - started, url: targetUrl, attempts: attempt,
        };
      }
      if (attempt < maxAttempts) {
        // Back off a little before showing Amazon a different fingerprint.
        await sleep(400 * attempt + Math.floor(Math.random() * 350));
        continue;
      }
      return {
        ok: false, status: res.status, body: lastBody, blocked,
        provider, ms: Date.now() - started, url: targetUrl, attempts: attempt,
        error: blocked ? "Amazon respondió con una verificación anti-bot." : `HTTP ${res.status}`,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }

  return {
    ok: false, status: lastStatus, body: lastBody, blocked: looksBlocked(lastStatus, lastBody),
    provider, ms: Date.now() - started, url: targetUrl, attempts: attempt - 1,
    error: lastError ?? `HTTP ${lastStatus}`,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run tasks with a bounded number in flight and an optional pause between starts. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  delayMs: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(8, concurrency));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      if (delayMs > 0 && index >= limit) await sleep(delayMs);
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
