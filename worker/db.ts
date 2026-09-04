import type {
  AppSettings, BookRecord, FetchLogRow, KeywordRecord, KeywordRun,
  MarketplaceId, NicheListItem, NicheSummary, RankPoint, WatchItem,
} from "../shared/types";
import type { Env } from "./env";
import { DEFAULT_PRINTING_COSTS } from "../shared/analytics/royalty";

export const DEFAULT_SETTINGS: AppSettings = {
  captureToken: "",
  marketplace: "com",
  searchPages: 3,
  enrichCount: 20,
  cacheTtlHours: 12,
  provider: "direct",
  customProxyTemplate: "",
  requestDelayMs: 250,
  concurrency: 4,
  weakReviewThreshold: 100,
  strongBsrThreshold: 150_000,
  royaltyRate: 0.6,
  printing: DEFAULT_PRINTING_COSTS,
  salesCurveCalibration: 1,
  calibrationByMarket: {},
  calibrationSamples: [],
  theme: "dark",
  locale: "es",
};

const SETTINGS_KEY = "app_settings";

export async function loadSettings(env: Env): Promise<AppSettings> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(SETTINGS_KEY).first<{ value: string }>();
    if (!row?.value) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(row.value) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      printing: { ...DEFAULT_PRINTING_COSTS, ...(parsed.printing ?? {}) },
    };
  } catch {
    // A missing table (migrations not applied yet) must not break the app.
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(env: Env, patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings(env);
  const next: AppSettings = {
    ...current,
    ...patch,
    printing: { ...current.printing, ...(patch.printing ?? {}) },
  };
  // Clamp anything that could blow past the Workers subrequest budget.
  next.searchPages = clamp(next.searchPages, 1, 7);
  next.enrichCount = clamp(next.enrichCount, 0, 40);
  next.concurrency = clamp(next.concurrency, 1, 8);
  next.requestDelayMs = clamp(next.requestDelayMs, 0, 3000);
  next.cacheTtlHours = clamp(next.cacheTtlHours, 0, 24 * 14);
  next.salesCurveCalibration = clamp(next.salesCurveCalibration, 0.05, 20);
  next.weakReviewThreshold = clamp(next.weakReviewThreshold, 1, 100000);
  // A calibration comes from user-entered sales figures, so guard the range.
  next.calibrationByMarket = Object.fromEntries(
    Object.entries(next.calibrationByMarket ?? {})
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)
      .map(([market, value]) => [market, clamp(value as number, 0.05, 20)]),
  ) as AppSettings["calibrationByMarket"];
  next.calibrationSamples = (next.calibrationSamples ?? []).slice(0, 40);

  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).bind(SETTINGS_KEY, JSON.stringify(next), Date.now()).run();
  return next;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

// --- cache -------------------------------------------------------------------

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  try {
    const row = await env.DB.prepare("SELECT value, expires_at FROM cache WHERE key = ?")
      .bind(key).first<{ value: string; expires_at: number }>();
    if (!row) return null;
    if (row.expires_at < Date.now()) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(env: Env, key: string, value: unknown, ttlHours: number): Promise<void> {
  if (ttlHours <= 0) return;
  const now = Date.now();
  try {
    await env.DB.prepare(
      "INSERT INTO cache (key, value, created_at, expires_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at, expires_at = excluded.expires_at",
    ).bind(key, JSON.stringify(value), now, now + ttlHours * 3600_000).run();
  } catch {
    // Cache writes are best-effort.
  }
}

export async function cachePurge(env: Env, all = false): Promise<number> {
  const stmt = all
    ? env.DB.prepare("DELETE FROM cache")
    : env.DB.prepare("DELETE FROM cache WHERE expires_at < ?").bind(Date.now());
  const result = await stmt.run();
  return result.meta.changes ?? 0;
}

// --- fetch log ---------------------------------------------------------------

export async function logFetch(env: Env, row: Omit<FetchLogRow, "ts"> & { ts?: number }): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO fetch_log (ts, kind, target, provider, status, ok, blocked, ms, parsed, detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      row.ts ?? Date.now(), row.kind, row.target.slice(0, 300), row.provider,
      row.status, row.ok ? 1 : 0, row.blocked ? 1 : 0, Math.round(row.ms), row.parsed, row.detail.slice(0, 400),
    ).run();
  } catch {
    // Logging must never break a scan.
  }
}

export async function recentFetches(env: Env, limit = 40): Promise<FetchLogRow[]> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT ts, kind, target, provider, status, ok, blocked, ms, parsed, detail FROM fetch_log ORDER BY ts DESC LIMIT ?",
    ).bind(limit).all<Record<string, unknown>>();
    return (results ?? []).map((r) => ({
      ts: Number(r.ts), kind: String(r.kind), target: String(r.target), provider: String(r.provider),
      status: Number(r.status), ok: Number(r.ok) === 1, blocked: Number(r.blocked) === 1,
      ms: Number(r.ms), parsed: Number(r.parsed), detail: String(r.detail ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function trimFetchLog(env: Env, keep = 400): Promise<void> {
  try {
    await env.DB.prepare(
      "DELETE FROM fetch_log WHERE id NOT IN (SELECT id FROM fetch_log ORDER BY ts DESC LIMIT ?)",
    ).bind(keep).run();
  } catch { /* best effort */ }
}

// --- niches ------------------------------------------------------------------

export async function saveNiche(
  env: Env,
  summary: NicheSummary,
  items: BookRecord[],
  notes = "",
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO niches (id, keyword, marketplace, category, summary, items, notes, starred, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    id, summary.keyword, summary.marketplace, null,
    JSON.stringify(summary), JSON.stringify(items), notes, 0, now, now,
  ).run();
  return id;
}

export async function listNiches(env: Env, limit = 100): Promise<NicheListItem[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, keyword, marketplace, summary, notes, starred, created_at FROM niches ORDER BY starred DESC, created_at DESC LIMIT ?",
  ).bind(limit).all<Record<string, unknown>>();

  return (results ?? []).map((row) => {
    const summary = JSON.parse(String(row.summary)) as NicheSummary;
    return {
      id: String(row.id),
      keyword: String(row.keyword),
      marketplace: String(row.marketplace) as MarketplaceId,
      opportunityScore: summary.opportunityScore,
      competitionScore: summary.competitionScore,
      demandScore: summary.demandScore,
      verdict: summary.verdict.label,
      tone: summary.verdict.tone,
      analysed: summary.analysed,
      starred: Number(row.starred) === 1,
      notes: String(row.notes ?? ""),
      createdAt: Number(row.created_at),
    };
  });
}

export async function getNiche(env: Env, id: string): Promise<{ summary: NicheSummary; items: BookRecord[]; notes: string; starred: boolean } | null> {
  const row = await env.DB.prepare("SELECT summary, items, notes, starred FROM niches WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    summary: JSON.parse(String(row.summary)) as NicheSummary,
    items: JSON.parse(String(row.items)) as BookRecord[],
    notes: String(row.notes ?? ""),
    starred: Number(row.starred) === 1,
  };
}

export async function updateNiche(env: Env, id: string, patch: { notes?: string; starred?: boolean }): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.notes !== undefined) { sets.push("notes = ?"); values.push(patch.notes.slice(0, 4000)); }
  if (patch.starred !== undefined) { sets.push("starred = ?"); values.push(patch.starred ? 1 : 0); }
  if (!sets.length) return;
  sets.push("updated_at = ?"); values.push(Date.now());
  values.push(id);
  await env.DB.prepare(`UPDATE niches SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function deleteNiche(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM niches WHERE id = ?").bind(id).run();
}

// --- keyword runs ------------------------------------------------------------

export async function saveKeywordRun(env: Env, seed: string, marketplace: MarketplaceId, keywords: KeywordRecord[]): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO keyword_lists (id, seed, marketplace, keywords, created_at) VALUES (?,?,?,?,?)",
  ).bind(id, seed, marketplace, JSON.stringify(keywords), Date.now()).run();
  return id;
}

export async function listKeywordRuns(env: Env, limit = 50): Promise<Array<Omit<KeywordRun, "keywords"> & { count: number }>> {
  const { results } = await env.DB.prepare(
    "SELECT id, seed, marketplace, keywords, created_at FROM keyword_lists ORDER BY created_at DESC LIMIT ?",
  ).bind(limit).all<Record<string, unknown>>();
  return (results ?? []).map((row) => ({
    id: String(row.id),
    seed: String(row.seed),
    marketplace: String(row.marketplace) as MarketplaceId,
    createdAt: Number(row.created_at),
    count: (JSON.parse(String(row.keywords)) as unknown[]).length,
  }));
}

export async function getKeywordRun(env: Env, id: string): Promise<KeywordRun | null> {
  const row = await env.DB.prepare("SELECT id, seed, marketplace, keywords, created_at FROM keyword_lists WHERE id = ?")
    .bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    seed: String(row.seed),
    marketplace: String(row.marketplace) as MarketplaceId,
    createdAt: Number(row.created_at),
    keywords: JSON.parse(String(row.keywords)) as KeywordRecord[],
  };
}

export async function deleteKeywordRun(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM keyword_lists WHERE id = ?").bind(id).run();
}

// --- watchlist ---------------------------------------------------------------

export async function addWatch(env: Env, item: Omit<WatchItem, "addedAt" | "active" | "latest" | "history">): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO watchlist (asin, marketplace, title, author, format, image, notes, active, added_at) VALUES (?,?,?,?,?,?,?,1,?) " +
      "ON CONFLICT(asin, marketplace) DO UPDATE SET title = excluded.title, author = excluded.author, " +
      "format = excluded.format, image = excluded.image, active = 1",
  ).bind(item.asin, item.marketplace, item.title, item.author, item.format, item.image, item.notes ?? "", Date.now()).run();
}

export async function removeWatch(env: Env, asin: string, marketplace: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM watchlist WHERE asin = ? AND marketplace = ?").bind(asin, marketplace),
    env.DB.prepare("DELETE FROM rank_history WHERE asin = ? AND marketplace = ?").bind(asin, marketplace),
  ]);
}

export async function listWatch(env: Env, withHistory = true): Promise<WatchItem[]> {
  const { results } = await env.DB.prepare(
    "SELECT asin, marketplace, title, author, format, image, notes, active, added_at FROM watchlist ORDER BY added_at DESC",
  ).all<Record<string, unknown>>();

  const items: WatchItem[] = (results ?? []).map((row) => ({
    asin: String(row.asin),
    marketplace: String(row.marketplace) as MarketplaceId,
    title: String(row.title ?? ""),
    author: String(row.author ?? ""),
    format: String(row.format ?? ""),
    image: String(row.image ?? ""),
    notes: String(row.notes ?? ""),
    active: Number(row.active) === 1,
    addedAt: Number(row.added_at),
    history: [],
    latest: null,
  }));

  if (!withHistory || !items.length) return items;

  // One query for every tracked book, then group in memory: D1 charges per
  // round-trip, so a single scan beats N per-book queries.
  const { results: points } = await env.DB.prepare(
    "SELECT asin, marketplace, captured_at, bsr, price, rating, reviews, sales_est, revenue_est, category_ranks " +
      "FROM rank_history WHERE captured_at > ? ORDER BY captured_at ASC",
  ).bind(Date.now() - 1000 * 60 * 60 * 24 * 180).all<Record<string, unknown>>();

  const byKey = new Map<string, RankPoint[]>();
  for (const row of points ?? []) {
    const key = `${row.asin}|${row.marketplace}`;
    const list = byKey.get(key) ?? [];
    list.push({
      capturedAt: Number(row.captured_at),
      bsr: row.bsr === null ? null : Number(row.bsr),
      price: row.price === null ? null : Number(row.price),
      rating: row.rating === null ? null : Number(row.rating),
      reviews: row.reviews === null ? null : Number(row.reviews),
      salesEst: row.sales_est === null ? null : Number(row.sales_est),
      revenueEst: row.revenue_est === null ? null : Number(row.revenue_est),
      categoryRanks: row.category_ranks ? JSON.parse(String(row.category_ranks)) : [],
    });
    byKey.set(key, list);
  }

  for (const item of items) {
    const history = byKey.get(`${item.asin}|${item.marketplace}`) ?? [];
    item.history = history;
    item.latest = history.length ? history[history.length - 1] : null;
    item.change7d = rankChange(history, 7);
    item.change30d = rankChange(history, 30);
  }
  return items;
}

/** Percentage change in BSR over N days. Negative means the rank improved. */
function rankChange(history: RankPoint[], days: number): number | null {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  if (!latest.bsr) return null;
  const cutoff = Date.now() - days * 86_400_000;
  const past = [...history].reverse().find((p) => p.capturedAt <= cutoff && p.bsr);
  if (!past?.bsr) return null;
  return Math.round(((latest.bsr - past.bsr) / past.bsr) * 1000) / 10;
}

export async function recordRankPoint(
  env: Env,
  asin: string,
  marketplace: string,
  point: Omit<RankPoint, "capturedAt"> & { capturedAt?: number },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO rank_history (asin, marketplace, captured_at, bsr, price, rating, reviews, sales_est, revenue_est, category_ranks) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    asin, marketplace, point.capturedAt ?? Date.now(),
    point.bsr, point.price, point.rating, point.reviews,
    point.salesEst, point.revenueEst, JSON.stringify(point.categoryRanks ?? []),
  ).run();
}

export async function getHistory(env: Env, asin: string, marketplace: string): Promise<RankPoint[]> {
  const { results } = await env.DB.prepare(
    "SELECT captured_at, bsr, price, rating, reviews, sales_est, revenue_est, category_ranks FROM rank_history " +
      "WHERE asin = ? AND marketplace = ? ORDER BY captured_at ASC LIMIT 400",
  ).bind(asin, marketplace).all<Record<string, unknown>>();
  return (results ?? []).map((row) => ({
    capturedAt: Number(row.captured_at),
    bsr: row.bsr === null ? null : Number(row.bsr),
    price: row.price === null ? null : Number(row.price),
    rating: row.rating === null ? null : Number(row.rating),
    reviews: row.reviews === null ? null : Number(row.reviews),
    salesEst: row.sales_est === null ? null : Number(row.sales_est),
    revenueEst: row.revenue_est === null ? null : Number(row.revenue_est),
    categoryRanks: row.category_ranks ? JSON.parse(String(row.category_ranks)) : [],
  }));
}

export async function dbReady(env: Env): Promise<boolean> {
  try {
    await env.DB.prepare("SELECT 1 FROM settings LIMIT 1").all();
    return true;
  } catch {
    return false;
  }
}
