import { Hono } from "hono";
import type { Context } from "hono";
import type {
  AppSettings, BookRecord, HealthInfo, KeywordRecord, MarketplaceId, NicheSummary, RoyaltyInput,
} from "../shared/types";
import { computeRoyalty, estimateRoyaltyPerUnit } from "../shared/analytics/royalty";
import { calibrationFor, salesPerMonth } from "../shared/analytics/bsr";
import { APP_VERSION, type Env } from "./env";
import { authEnabled, checkPassword, clearSessionCookie, createSessionCookie, isAuthenticated } from "./auth";
import {
  DEFAULT_SETTINGS, addWatch, cacheGet, cachePurge, cacheSet, dbReady, deleteKeywordRun, deleteNiche,
  getHistory, getKeywordRun, getNiche, listKeywordRuns, listNiches, listWatch, loadSettings, logFetch,
  recentFetches, recordRankPoint, removeWatch, saveKeywordRun, saveNiche, saveSettings, trimFetchLog,
  updateNiche,
} from "./db";
import { fetchPage, mapWithConcurrency } from "./amazon/fetcher";
import { getMarketplace, marketplaceList, productUrl, searchUrl } from "./amazon/marketplaces";
import { parseSearchPage } from "./amazon/search";
import { parseProductPage, type ProductDetail } from "./amazon/product";
import { expandKeywords, type ProbeGroup } from "./amazon/suggest";
import { bestsellerUrl, parseBestsellerPage } from "./amazon/category";
import { schemaStatements } from "./schema";

type AppContext = { Bindings: Env; Variables: { settings: AppSettings } };

const app = new Hono<AppContext>();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use("/api/*", async (c, next) => {
  // These endpoints must answer before a session exists.
  const open = ["/api/auth/login", "/api/auth/status", "/api/health"];
  if (!open.includes(new URL(c.req.url).pathname)) {
    if (!(await isAuthenticated(c.req.raw, c.env))) {
      return c.json({ error: "No autorizado", hint: "Inicia sesión con tu contraseña." }, 401);
    }
  }
  await next();
});

/** Body parsing that tolerates an absent or malformed JSON payload. */
async function readJson<T>(c: Context<AppContext>): Promise<Partial<T>> {
  try {
    return (await c.req.json()) as Partial<T>;
  } catch {
    return {} as Partial<T>;
  }
}

/** Load the persisted settings once per request and merge any per-call overrides. */
async function withSettings(c: Context<AppContext>, overrides?: Partial<AppSettings>): Promise<AppSettings> {
  const base = await loadSettings(c.env);
  return overrides ? { ...base, ...overrides, printing: { ...base.printing, ...(overrides.printing ?? {}) } } : base;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

app.get("/api/auth/status", async (c) => {
  return c.json({
    authEnabled: authEnabled(c.env),
    authenticated: await isAuthenticated(c.req.raw, c.env),
  });
});

app.post("/api/auth/login", async (c) => {
  const body = await readJson<{ password?: string }>(c);
  if (!authEnabled(c.env)) return c.json({ ok: true, authEnabled: false });

  const ok = await checkPassword(c.env, body.password ?? "");
  if (!ok) {
    // Slow down brute force a little without holding the isolate hostage.
    await new Promise((r) => setTimeout(r, 700));
    return c.json({ error: "Contraseña incorrecta" }, 401);
  }
  c.header("Set-Cookie", await createSessionCookie(c.env));
  return c.json({ ok: true, authEnabled: true });
});

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

app.get("/api/health", async (c) => {
  const settings = await loadSettings(c.env);
  const fetches = await recentFetches(c.env, 40);
  const blocked = fetches.filter((f) => f.blocked).length;
  const info: HealthInfo = {
    authEnabled: authEnabled(c.env),
    dbReady: await dbReady(c.env),
    provider: {
      provider: settings.provider,
      configured: settings.provider === "direct" ? true : providerKeyPresent(c.env, settings),
      keyPresent: providerKeyPresent(c.env, settings),
    },
    recentFetches: fetches.slice(0, 25),
    blockRate: fetches.length ? Math.round((blocked / fetches.length) * 100) : 0,
    version: APP_VERSION,
  };
  return c.json(info);
});

function providerKeyPresent(env: Env, settings: AppSettings): boolean {
  switch (settings.provider) {
    case "scraperapi": return Boolean(env.SCRAPER_API_KEY);
    case "scrapingbee": return Boolean(env.SCRAPINGBEE_API_KEY);
    case "custom": return Boolean(env.CUSTOM_PROXY_TEMPLATE || settings.customProxyTemplate);
    default: return true;
  }
}

app.get("/api/marketplaces", (c) => c.json(marketplaceList()));

app.get("/api/settings", async (c) => c.json(await loadSettings(c.env)));

app.put("/api/settings", async (c) => {
  const patch = await readJson<Partial<AppSettings>>(c);
  return c.json(await saveSettings(c.env, patch));
});

app.post("/api/settings/reset", async (c) => c.json(await saveSettings(c.env, DEFAULT_SETTINGS)));

// ---------------------------------------------------------------------------
// Scanning: one upstream page per request.
//
// Splitting the work this way keeps every invocation inside the Workers free
// plan budgets (50 subrequests, 10 ms CPU) and lets the UI stream progress.
// ---------------------------------------------------------------------------

app.post("/api/scan/search", async (c) => {
  const body = await readJson<{
    keyword?: string; marketplace?: string; page?: number;
    department?: "print" | "kindle" | "all"; noCache?: boolean;
  }>(c);

  const keyword = (body.keyword ?? "").trim();
  if (!keyword) return c.json({ error: "Falta la palabra clave" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);
  const page = Math.max(1, Math.min(10, body.page ?? 1));
  const department = body.department ?? "print";
  const url = searchUrl(marketplace, keyword, page, department);
  const cacheKey = `search:${marketplace.id}:${department}:${keyword.toLowerCase()}:${page}`;

  if (!body.noCache) {
    const cached = await cacheGet<SearchResponse>(c.env, cacheKey);
    if (cached) return c.json({ ...cached, fromCache: true });
  }

  const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 3 });
  if (!outcome.ok) {
    await logFetch(c.env, {
      kind: "search", target: url, provider: outcome.provider, status: outcome.status,
      ok: false, blocked: outcome.blocked, ms: outcome.ms, parsed: 0, detail: outcome.error ?? "",
    });
    return c.json({
      error: outcome.blocked ? "Amazon bloqueó la petición" : "No se pudo leer la página de resultados",
      detail: outcome.error,
      blocked: outcome.blocked,
      hint: outcome.blocked
        ? "Espera unos minutos, reduce las páginas por escaneo o configura un proveedor de scraping en Ajustes."
        : undefined,
    }, 502);
  }

  const parsed = parseSearchPage(outcome.body, marketplace, (page - 1) * 48);
  await logFetch(c.env, {
    kind: "search", target: url, provider: outcome.provider, status: outcome.status,
    ok: true, blocked: false, ms: outcome.ms, parsed: parsed.items.length,
    detail: parsed.items.length ? "" : "0 elementos: revisa los selectores",
  });

  const response: SearchResponse = {
    items: parsed.items,
    totalResults: parsed.totalResults,
    resultsCountText: parsed.resultsCountText,
    page,
    provider: outcome.provider,
    elapsedMs: outcome.ms,
    fromCache: false,
    warning: parsed.items.length === 0
      ? "La página se descargó pero no se reconoció ningún resultado. Puede que Amazon haya cambiado el marcado — mira Diagnóstico."
      : undefined,
  };

  await cacheSet(c.env, cacheKey, response, settings.cacheTtlHours);
  return c.json(response);
});

interface SearchResponse {
  items: BookRecord[];
  totalResults: number | null;
  resultsCountText: string | null;
  page: number;
  provider: string;
  elapsedMs: number;
  fromCache: boolean;
  warning?: string;
}

/** Detail-page enrichment for a small batch of ASINs. */
app.post("/api/scan/enrich", async (c) => {
  const body = await readJson<{ asins?: string[]; marketplace?: string; noCache?: boolean }>(c);
  const asins = (body.asins ?? []).filter((a) => /^[A-Z0-9]{10}$/i.test(a)).slice(0, 10);
  if (!asins.length) return c.json({ error: "Sin ASIN válidos" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);

  const details = await mapWithConcurrency(asins, settings.concurrency, settings.requestDelayMs, async (asin) => {
    const cacheKey = `product:${marketplace.id}:${asin}`;
    if (!body.noCache) {
      const cached = await cacheGet<ProductDetail>(c.env, cacheKey);
      if (cached) return { asin, detail: cached, cached: true, blocked: false };
    }
    const url = productUrl(marketplace, asin);
    const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 2 });
    if (!outcome.ok) {
      await logFetch(c.env, {
        kind: "product", target: url, provider: outcome.provider, status: outcome.status,
        ok: false, blocked: outcome.blocked, ms: outcome.ms, parsed: 0, detail: outcome.error ?? "",
      });
      return { asin, detail: null, cached: false, blocked: outcome.blocked };
    }
    const detail = parseProductPage(outcome.body, asin);
    await logFetch(c.env, {
      kind: "product", target: url, provider: outcome.provider, status: outcome.status,
      ok: true, blocked: false, ms: outcome.ms, parsed: detail.bsr ? 1 : 0,
      detail: detail.bsr ? "" : "sin BSR reconocido",
    });
    await cacheSet(c.env, cacheKey, detail, settings.cacheTtlHours);
    return { asin, detail, cached: false, blocked: false };
  });

  return c.json({
    details: details.filter((d) => d.detail).map((d) => d.detail),
    failed: details.filter((d) => !d.detail).map((d) => d.asin),
    blocked: details.some((d) => d.blocked),
    fromCache: details.filter((d) => d.cached).length,
  });
});

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

app.post("/api/keywords/expand", async (c) => {
  const body = await readJson<{
    seed?: string; marketplace?: string; group?: ProbeGroup; department?: "print" | "kindle" | "all";
  }>(c);

  const seed = (body.seed ?? "").trim();
  if (!seed) return c.json({ error: "Falta la semilla" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);
  const group = (body.group ?? "base") as ProbeGroup;

  const result = await expandKeywords(c.env, settings, marketplace, seed, group, body.department ?? "print");
  await logFetch(c.env, {
    kind: "suggest", target: `${group}:${seed}`, provider: settings.provider,
    status: result.answered ? 200 : 0, ok: result.answered > 0, blocked: result.answered === 0 && result.probes > 0,
    ms: 0, parsed: result.keywords.length, detail: `${result.answered}/${result.probes} sondas`,
  });
  return c.json(result);
});

/** Score a handful of keywords against live search results (1 page each). */
app.post("/api/keywords/score", async (c) => {
  const body = await readJson<{ keywords?: string[]; marketplace?: string; department?: "print" | "kindle" | "all" }>(c);
  const keywords = (body.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 8);
  if (!keywords.length) return c.json({ error: "Sin palabras clave" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);
  const department = body.department ?? "print";

  const scored = await mapWithConcurrency(keywords, Math.min(3, settings.concurrency), settings.requestDelayMs, async (keyword) => {
    const cacheKey = `kwscore:${marketplace.id}:${department}:${keyword.toLowerCase()}`;
    const cached = await cacheGet<Record<string, unknown>>(c.env, cacheKey);
    if (cached) return { keyword, ...cached };

    const url = searchUrl(marketplace, keyword, 1, department);
    const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 2 });
    if (!outcome.ok) return { keyword, error: outcome.blocked ? "blocked" : "failed" };

    const parsed = parseSearchPage(outcome.body, marketplace, 0, 24);
    const organic = parsed.items.filter((i) => !i.sponsored).slice(0, 16);
    const reviews = organic.map((i) => i.reviews).filter((r): r is number => r !== null);
    const payload = {
      totalResults: parsed.totalResults,
      avgReviews: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : null,
      medianReviews: reviews.length ? medianOf(reviews) : null,
      sampled: organic.length,
      avgPrice: avgOf(organic.map((i) => i.price)),
      lowReviewShare: organic.length
        ? Math.round((organic.filter((i) => (i.reviews ?? 0) < settings.weakReviewThreshold).length / organic.length) * 100) / 100
        : null,
      scannedAt: Date.now(),
    };
    await cacheSet(c.env, cacheKey, payload, settings.cacheTtlHours);
    return { keyword, ...payload };
  });

  return c.json({ scored });
});

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function avgOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Indexation check
//
// A published book that does not sell has two very different causes: nobody
// searches for what it is about, or people search and it never shows up. The
// fixes are opposite — change the book, or change the metadata — so guessing
// between them is expensive. This looks the book up in each search and reports
// where it actually lands.
// ---------------------------------------------------------------------------

app.post("/api/scan/rank", async (c) => {
  const body = await readJson<{
    asin?: string; keywords?: string[]; marketplace?: string;
    department?: "print" | "kindle" | "all"; pages?: number;
  }>(c);

  const asin = (body.asin ?? "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return c.json({ error: "ASIN inválido" }, 400);

  const keywords = (body.keywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 6);
  if (!keywords.length) return c.json({ error: "Indica al menos una búsqueda" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);
  const department = body.department ?? "print";
  const depth = Math.max(1, Math.min(3, body.pages ?? 2));

  const results = await mapWithConcurrency(keywords, Math.min(3, settings.concurrency), settings.requestDelayMs, async (keyword) => {
    let scanned = 0;
    let totalResults: number | null = null;

    for (let page = 1; page <= depth; page++) {
      const url = searchUrl(marketplace, keyword, page, department);
      const cacheKey = `rank:${marketplace.id}:${department}:${keyword.toLowerCase()}:${page}`;
      let parsed = await cacheGet<{ asins: string[]; total: number | null; count: number }>(c.env, cacheKey);

      if (!parsed) {
        const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 2 });
        if (!outcome.ok) {
          return { keyword, found: false, position: null, page: null, scanned, totalResults, error: outcome.blocked ? "bloqueado" : "fallo" };
        }
        const search = parseSearchPage(outcome.body, marketplace, 0, 60);
        // Only the organic ranking matters: an ad placement is bought, not earned.
        const organic = search.items.filter((item) => !item.sponsored);
        parsed = { asins: organic.map((item) => item.asin), total: search.totalResults, count: organic.length };
        await cacheSet(c.env, cacheKey, parsed, settings.cacheTtlHours);
      }

      if (page === 1) totalResults = parsed.total;
      const index = parsed.asins.indexOf(asin);
      if (index >= 0) {
        return { keyword, found: true, position: scanned + index + 1, page, scanned: scanned + parsed.count, totalResults };
      }
      scanned += parsed.count;
      if (parsed.count === 0) break;
    }

    return { keyword, found: false, position: null, page: null, scanned, totalResults };
  });

  await logFetch(c.env, {
    kind: "search", target: `rank:${asin}`, provider: settings.provider, status: 200,
    ok: true, blocked: false, ms: 0, parsed: results.filter((r) => r.found).length,
    detail: `${keywords.length} búsquedas comprobadas`,
  });

  return c.json({ asin, marketplace: marketplace.id, depth, results });
});

// ---------------------------------------------------------------------------
// Categories
//
// The bestseller page supplies only the ranked list of ASINs; every figure
// shown comes from the product parser, which is already covered by tests. The
// client then enriches the top of the list through /api/scan/enrich, exactly
// like a niche scan, so the same budgets and progress reporting apply.
// ---------------------------------------------------------------------------

app.post("/api/category/list", async (c) => {
  const body = await readJson<{
    node?: string; marketplace?: string; department?: "print" | "kindle"; page?: number; noCache?: boolean;
  }>(c);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(body.marketplace ?? settings.marketplace);
  const department = body.department === "kindle" ? "kindle" : "print";
  const node = (body.node ?? "").replace(/[^0-9]/g, "").slice(0, 20);
  const page = Math.max(1, Math.min(2, body.page ?? 1));
  const url = bestsellerUrl(marketplace, node, department, page);
  const cacheKey = `category:${marketplace.id}:${department}:${node || "root"}:${page}`;

  if (!body.noCache) {
    const cached = await cacheGet<Record<string, unknown>>(c.env, cacheKey);
    if (cached) return c.json({ ...cached, fromCache: true });
  }

  const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 3 });
  if (!outcome.ok) {
    await logFetch(c.env, {
      kind: "category", target: url, provider: outcome.provider, status: outcome.status,
      ok: false, blocked: outcome.blocked, ms: outcome.ms, parsed: 0, detail: outcome.error ?? "",
    });
    return c.json({
      error: outcome.blocked ? "Amazon bloqueó la petición" : "No se pudo leer la lista de más vendidos",
      blocked: outcome.blocked, detail: outcome.error,
      hint: outcome.blocked ? "Espera unos minutos o sube el tiempo de caché en Ajustes." : undefined,
    }, 502);
  }

  const parsed = parseBestsellerPage(outcome.body);
  await logFetch(c.env, {
    kind: "category", target: url, provider: outcome.provider, status: outcome.status,
    ok: true, blocked: false, ms: outcome.ms, parsed: parsed.asins.length,
    detail: parsed.asins.length ? "" : "0 libros: revisa los selectores",
  });

  const payload = {
    node,
    name: parsed.name,
    department,
    marketplace: marketplace.id,
    asins: parsed.asins,
    children: parsed.children,
    breadcrumb: parsed.breadcrumb,
    fromCache: false,
    warning: parsed.asins.length === 0
      ? "La página se descargó pero no se reconoció ningún libro. Mira Diagnóstico."
      : undefined,
  };
  await cacheSet(c.env, cacheKey, payload, settings.cacheTtlHours);
  return c.json(payload);
});

// ---------------------------------------------------------------------------
// Single book
// ---------------------------------------------------------------------------

app.get("/api/book/:asin", async (c) => {
  const asin = c.req.param("asin").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return c.json({ error: "ASIN inválido" }, 400);

  const settings = await withSettings(c);
  const marketplace = getMarketplace(c.req.query("marketplace") ?? settings.marketplace);
  const noCache = c.req.query("refresh") === "1";
  const cacheKey = `product:${marketplace.id}:${asin}`;

  let detail = noCache ? null : await cacheGet<ProductDetail>(c.env, cacheKey);
  let provider = settings.provider;

  if (!detail) {
    const url = productUrl(marketplace, asin);
    const outcome = await fetchPage(c.env, settings, url, { language: marketplace.language, attempts: 3 });
    provider = outcome.provider as AppSettings["provider"];
    await logFetch(c.env, {
      kind: "product", target: url, provider: outcome.provider, status: outcome.status,
      ok: outcome.ok, blocked: outcome.blocked, ms: outcome.ms, parsed: 0, detail: outcome.error ?? "",
    });
    if (!outcome.ok) {
      return c.json({
        error: outcome.blocked ? "Amazon bloqueó la petición" : "No se pudo leer la ficha",
        blocked: outcome.blocked, detail: outcome.error,
      }, 502);
    }
    detail = parseProductPage(outcome.body, asin);
    await cacheSet(c.env, cacheKey, detail, settings.cacheTtlHours);
  }

  const history = await getHistory(c.env, asin, marketplace.id);
  const format = detail.format ?? "paperback";
  const sales = salesPerMonth(detail.bsr, format, marketplace.id, calibrationFor(settings, marketplace.id));
  const royalty = estimateRoyaltyPerUnit(detail.price, detail.pages, format, settings.printing);

  return c.json({
    detail,
    marketplace: marketplace.id,
    provider,
    history,
    estimates: {
      salesPerMonth: sales,
      royaltyPerUnit: royalty,
      revenuePerMonth: sales !== null && royalty !== null ? Math.round(sales * royalty * 100) / 100 : null,
    },
  });
});

app.post("/api/royalty", async (c) => {
  const body = await c.req.json<RoyaltyInput>().catch(() => null);
  if (!body) return c.json({ error: "Petición inválida" }, 400);
  const settings = await withSettings(c);
  return c.json(computeRoyalty(body, settings.printing));
});

// ---------------------------------------------------------------------------
// Saved niches
// ---------------------------------------------------------------------------

app.get("/api/niches", async (c) => c.json(await listNiches(c.env)));

app.post("/api/niches", async (c) => {
  const body = await readJson<{ summary?: NicheSummary; items?: BookRecord[]; notes?: string }>(c);
  if (!body.summary || !body.items) return c.json({ error: "Faltan datos del análisis" }, 400);
  const id = await saveNiche(c.env, body.summary, body.items, body.notes ?? "");
  return c.json({ id });
});

app.get("/api/niches/:id", async (c) => {
  const niche = await getNiche(c.env, c.req.param("id"));
  if (!niche) return c.json({ error: "No encontrado" }, 404);
  return c.json(niche);
});

app.patch("/api/niches/:id", async (c) => {
  const body = await readJson<{ notes?: string; starred?: boolean }>(c);
  await updateNiche(c.env, c.req.param("id"), body);
  return c.json({ ok: true });
});

app.delete("/api/niches/:id", async (c) => {
  await deleteNiche(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Saved keyword runs
// ---------------------------------------------------------------------------

app.get("/api/keyword-runs", async (c) => c.json(await listKeywordRuns(c.env)));

app.post("/api/keyword-runs", async (c) => {
  const body = await readJson<{ seed?: string; marketplace?: MarketplaceId; keywords?: KeywordRecord[] }>(c);
  if (!body.seed || !body.keywords) return c.json({ error: "Faltan datos" }, 400);
  const settings = await loadSettings(c.env);
  const id = await saveKeywordRun(c.env, body.seed, body.marketplace ?? settings.marketplace, body.keywords);
  return c.json({ id });
});

app.get("/api/keyword-runs/:id", async (c) => {
  const run = await getKeywordRun(c.env, c.req.param("id"));
  if (!run) return c.json({ error: "No encontrado" }, 404);
  return c.json(run);
});

app.delete("/api/keyword-runs/:id", async (c) => {
  await deleteKeywordRun(c.env, c.req.param("id"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

app.get("/api/watch", async (c) => c.json(await listWatch(c.env)));

app.post("/api/watch", async (c) => {
  const body = await readJson<{
    asin?: string; marketplace?: MarketplaceId; title?: string; author?: string;
    format?: string; image?: string; notes?: string;
  }>(c);
  const asin = (body.asin ?? "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return c.json({ error: "ASIN inválido" }, 400);
  const settings = await loadSettings(c.env);

  await addWatch(c.env, {
    asin,
    marketplace: body.marketplace ?? settings.marketplace,
    title: body.title ?? "", author: body.author ?? "",
    format: body.format ?? "", image: body.image ?? "", notes: body.notes ?? "",
  });
  return c.json({ ok: true });
});

app.delete("/api/watch/:asin", async (c) => {
  const settings = await loadSettings(c.env);
  await removeWatch(c.env, c.req.param("asin").toUpperCase(), c.req.query("marketplace") ?? settings.marketplace);
  return c.json({ ok: true });
});

/** Manual snapshot of a batch of tracked books (the cron does the same nightly). */
app.post("/api/watch/refresh", async (c) => {
  const body = await readJson<{ asins?: string[] }>(c);
  const settings = await withSettings(c);
  const all = await listWatch(c.env, false);
  const targets = (body.asins?.length ? all.filter((w) => body.asins!.includes(w.asin)) : all.filter((w) => w.active)).slice(0, 8);
  if (!targets.length) return c.json({ ok: true, updated: 0 });

  const updated = await snapshotWatchlist(c.env, settings, targets);
  return c.json({ ok: true, updated });
});

async function snapshotWatchlist(
  env: Env,
  settings: AppSettings,
  targets: Array<{ asin: string; marketplace: MarketplaceId; format: string }>,
): Promise<number> {
  let updated = 0;
  await mapWithConcurrency(targets, Math.min(3, settings.concurrency), Math.max(300, settings.requestDelayMs), async (item) => {
    const marketplace = getMarketplace(item.marketplace);
    const url = productUrl(marketplace, item.asin);
    const outcome = await fetchPage(env, settings, url, { language: marketplace.language, attempts: 2 });
    await logFetch(env, {
      kind: "product", target: url, provider: outcome.provider, status: outcome.status,
      ok: outcome.ok, blocked: outcome.blocked, ms: outcome.ms, parsed: 0, detail: "watchlist",
    });
    if (!outcome.ok) return;

    const detail = parseProductPage(outcome.body, item.asin);
    const format = detail.format ?? "paperback";
    const sales = salesPerMonth(detail.bsr, format, marketplace.id, calibrationFor(settings, marketplace.id));
    const royalty = estimateRoyaltyPerUnit(detail.price, detail.pages, format, settings.printing);

    await recordRankPoint(env, item.asin, marketplace.id, {
      bsr: detail.bsr, price: detail.price, rating: detail.rating, reviews: detail.reviews,
      salesEst: sales, revenueEst: sales !== null && royalty !== null ? Math.round(sales * royalty * 100) / 100 : null,
      categoryRanks: detail.categoryRanks,
    });
    await cacheSet(env, `product:${marketplace.id}:${item.asin}`, detail, settings.cacheTtlHours);
    updated += 1;
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Maintenance & diagnostics
// ---------------------------------------------------------------------------

app.post("/api/cache/purge", async (c) => {
  const all = c.req.query("all") === "1";
  const removed = await cachePurge(c.env, all);
  return c.json({ ok: true, removed });
});

/**
 * Diagnostics: fetch one Amazon URL and report what the parser saw. This is the
 * fastest way to tell "Amazon blocked us" apart from "our selectors went stale"
 * when a scan comes back empty.
 */
app.post("/api/debug/probe", async (c) => {
  const body = await readJson<{ url?: string; kind?: "search" | "product" | "category" }>(c);
  const target = body.url ?? "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target);
  } catch {
    return c.json({ error: "URL inválida" }, 400);
  }
  // Only ever fetch Amazon: this endpoint must not become an open proxy.
  if (!/(^|\.)amazon\.[a-z.]+$/i.test(parsedUrl.hostname)) {
    return c.json({ error: "Solo se permiten URLs de Amazon" }, 400);
  }

  const settings = await withSettings(c);
  const outcome = await fetchPage(c.env, settings, target, { attempts: 1 });
  const kind = body.kind ?? detectProbeKind(parsedUrl.pathname);

  let parsedSummary: unknown = null;
  if (outcome.ok) {
    if (kind === "category") {
      const listing = parseBestsellerPage(outcome.body);
      parsedSummary = {
        name: listing.name,
        breadcrumb: listing.breadcrumb,
        asinCount: listing.asins.length,
        firstAsins: listing.asins.slice(0, 10),
        children: listing.children.slice(0, 12),
      };
    } else if (kind === "product") {
      const asin = /\/dp\/([A-Z0-9]{10})/i.exec(parsedUrl.pathname)?.[1] ?? "0000000000";
      parsedSummary = parseProductPage(outcome.body, asin.toUpperCase());
    } else {
      const marketplace = getMarketplace(parsedUrl.hostname.replace(/^www\.amazon\./, ""));
      const parsed = parseSearchPage(outcome.body, marketplace, 0, 8);
      parsedSummary = {
        totalResults: parsed.totalResults,
        resultsCountText: parsed.resultsCountText,
        rawItemCount: parsed.rawItemCount,
        firstItems: parsed.items.slice(0, 5),
      };
    }
  }

  return c.json({
    ok: outcome.ok,
    status: outcome.status,
    blocked: outcome.blocked,
    provider: outcome.provider,
    ms: outcome.ms,
    attempts: outcome.attempts,
    bodyLength: outcome.body.length,
    title: /<title>([^<]{0,200})<\/title>/i.exec(outcome.body)?.[1] ?? null,
    snippet: outcome.body.slice(0, 900),
    ...probeDiagnostics(outcome.body, kind),
    parsed: parsedSummary,
  });
});

function detectProbeKind(pathname: string): "search" | "product" | "category" {
  if (/\/(?:gp\/bestsellers|zgbs|bestsellers)\b/i.test(pathname)) return "category";
  if (/\/(?:dp|gp\/product)\//i.test(pathname)) return "product";
  return "search";
}

/**
 * Per-field diagnosis of a fetched page.
 *
 * A single excerpt tells you whether the page looks right, but not which
 * extractor missed. Listing the anchor each field depends on — and returning
 * the markup around the ones that matter — turns one probe into the whole
 * answer: a field is null either because its anchor is absent (Amazon moved
 * it) or because it is present and the pattern under it no longer matches.
 */
function probeDiagnostics(
  html: string,
  kind: "search" | "product" | "category",
): { anchor: string | null; excerpt: string; checks: Array<{ name: string; found: boolean }>; excerpts: Array<{ label: string; text: string }> } {
  const groups: Record<typeof kind, Array<{ label: string; anchors: string[] }>> = {
    product: [
      { label: "Título", anchors: ['id="productTitle"', 'id="title"'] },
      { label: "Autor", anchors: ['id="bylineInfo"', "contributorNameID", 'class="author'] },
      { label: "Valoración y reseñas", anchors: ['id="acrCustomerReviewText"', 'id="acrPopover"', 'id="averageCustomerReviews"'] },
      { label: "Precio", anchors: ['id="corePriceDisplay', 'id="corePrice_feature_div"', 'id="corePrice_desktop"', 'class="slot-price"', 'class="a-price"'] },
      { label: "Ficha técnica", anchors: ["data-rpi-attribute-name", 'id="detailBullets_feature_div"', 'id="productDetails'] },
      { label: "Clasificación", anchors: ["Best Sellers Rank", "Clasificación en los más vendidos", "Amazon Bestseller-Rang"] },
    ],
    search: [
      { label: "Tarjetas de resultado", anchors: ['data-component-type="s-search-result"', "s-main-slot", 'data-asin="'] },
      { label: "Recuento de resultados", anchors: ['data-component-type="s-result-info-bar"', "<h1"] },
    ],
    category: [
      { label: "Parrilla de más vendidos", anchors: ['id="gridItemRoot"', "p13n-desktop-grid", 'id="zg-ordered-list"'] },
      { label: "Navegación de categorías", anchors: ['id="zg-left-col"', 'role="group"', "zg_browseRoot"] },
    ],
  };

  const checks: Array<{ name: string; found: boolean }> = [];
  const excerpts: Array<{ label: string; text: string }> = [];
  let firstAnchor: string | null = null;
  let firstExcerpt = "";

  for (const group of groups[kind]) {
    const hit = group.anchors.find((anchor) => html.includes(anchor)) ?? null;
    checks.push({ name: group.label, found: hit !== null });
    if (!hit) continue;
    const idx = html.indexOf(hit);
    const text = html.slice(Math.max(0, idx - 300), idx + 1600);
    if (!firstAnchor) {
      firstAnchor = hit;
      firstExcerpt = text;
    }
    // Keep the response small: the fields that keep coming back empty first.
    if (excerpts.length < 3 && /Precio|reseñas|Clasificación|resultado|parrilla/i.test(group.label)) {
      excerpts.push({ label: `${group.label} — «${hit}»`, text });
    }
  }

  return { anchor: firstAnchor, excerpt: firstExcerpt, checks, excerpts };
}


app.get("/api/debug/log", async (c) => c.json(await recentFetches(c.env, 100)));

/**
 * Create the schema from inside the app.
 *
 * The CLI route (`wrangler d1 migrations apply`) stays the normal one; this
 * exists so the whole setup can be done from a browser, phone included, without
 * pasting SQL into a console. Every statement is CREATE ... IF NOT EXISTS, so
 * running it twice is a no-op and it can never drop data. It sits behind the
 * password like every other route.
 */
app.post("/api/setup/migrate", async (c) => {
  const statements = schemaStatements();
  if (!statements.length) return c.json({ error: "No se encontró el esquema" }, 500);

  try {
    await c.env.DB.batch(statements.map((statement) => c.env.DB.prepare(statement)));
  } catch (error) {
    return c.json({
      error: "No se pudieron crear las tablas",
      detail: error instanceof Error ? error.message : String(error),
      hint: "Comprueba que el database_id de wrangler.jsonc apunta a tu base D1.",
    }, 500);
  }

  return c.json({ ok: true, statements: statements.length, dbReady: await dbReady(c.env) });
});

app.all("/api/*", (c) => c.json({ error: "Ruta no encontrada" }, 404));

// Anything that is not an API route is served by the static asset binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// ---------------------------------------------------------------------------
// Cron: nightly watchlist snapshot
// ---------------------------------------------------------------------------

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const settings = await loadSettings(env);
      const watch = (await listWatch(env, false)).filter((w) => w.active);
      // Stay well inside the subrequest budget; the rest are picked up tomorrow.
      const batch = watch.slice(0, 20);
      if (batch.length) await snapshotWatchlist(env, settings, batch);
      await cachePurge(env, false);
      await trimFetchLog(env, 400);
    })());
  },
} satisfies ExportedHandler<Env>;
