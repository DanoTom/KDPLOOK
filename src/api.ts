import type {
  AppSettings, BookRecord, CategoryListing, HealthInfo, KeywordRecord, KeywordRun, Marketplace,
  MarketplaceId, NicheListItem, NicheSummary, RankPoint, RoyaltyInput, RoyaltyOutput, WatchItem,
} from "../shared/types";
import type { ProbeGroup } from "./lib/groups";

export class ApiError extends Error {
  status: number;
  blocked: boolean;
  hint?: string;

  constructor(message: string, status: number, blocked = false, hint?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.blocked = blocked;
    this.hint = hint;
  }
}

/** Fired on any 401 so the shell can swap to the login screen. */
export const UNAUTHORIZED_EVENT = "kdplook:unauthorized";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: text.slice(0, 300) }; }
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; detail?: string; blocked?: boolean; hint?: string };
    if (response.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    throw new ApiError(
      body.error ?? `Error ${response.status}`,
      response.status,
      Boolean(body.blocked),
      body.hint ?? body.detail,
    );
  }
  return payload as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export interface SearchPageResponse {
  items: BookRecord[];
  totalResults: number | null;
  resultsCountText: string | null;
  page: number;
  provider: string;
  elapsedMs: number;
  fromCache: boolean;
  /** Amazon's own "no results" page, as opposed to markup we failed to read. */
  noResults?: boolean;
  /** Amazon ran out of matches here and filled the page from elsewhere. */
  crossDepartment?: boolean;
  /** The opening text of the results area, when nothing could be parsed. */
  pageHint?: string | null;
  warning?: string;
}

export interface ProductDetailDto {
  asin: string;
  title: string | null;
  author: string | null;
  image: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  bsr: number | null;
  categoryRanks: Array<{ name: string; rank: number }>;
  pages: number | null;
  publisher: string | null;
  publishedAt: string | null;
  language: string | null;
  isbn: string | null;
  dimensions: string | null;
  format: BookRecord["format"] | null;
  formatLabel: string | null;
  selfPublished: boolean | null;
}

export interface KeywordScoreDto {
  keyword: string;
  totalResults?: number | null;
  avgReviews?: number | null;
  medianReviews?: number | null;
  avgPrice?: number | null;
  lowReviewShare?: number | null;
  sampled?: number;
  /** Of those sampled, how many had a review count that could be read. */
  withReviews?: number;
  scannedAt?: number;
  error?: string;
}

export interface ProbeResponse {
  ok: boolean;
  /** "pegado" when the markup was handed over instead of fetched. */
  source?: string;
  kind?: string;
  status?: number;
  blocked: boolean;
  provider?: string;
  ms?: number;
  attempts?: number;
  bodyLength: number;
  title: string | null;
  snippet: string;
  excerpt: string;
  anchor: string | null;
  checks: Array<{ name: string; found: boolean }>;
  excerpts: Array<{ label: string; text: string }>;
  parsed: unknown;
}

export const api = {
  authStatus: () => request<{ authEnabled: boolean; authenticated: boolean }>("/api/auth/status"),
  login: (password: string) => post<{ ok: boolean }>("/api/auth/login", { password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),

  health: () => request<HealthInfo>("/api/health"),
  marketplaces: () => request<Marketplace[]>("/api/marketplaces"),

  getSettings: () => request<AppSettings>("/api/settings"),
  saveSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
  resetSettings: () => post<AppSettings>("/api/settings/reset"),

  searchPage: (body: {
    keyword: string; marketplace: MarketplaceId; page: number;
    department: "print" | "kindle" | "all"; noCache?: boolean;
  }) => post<SearchPageResponse>("/api/scan/search", body),

  categoryList: (body: {
    node: string; marketplace: MarketplaceId; department: "print" | "kindle"; page?: number; noCache?: boolean;
  }) => post<CategoryListing & { warning?: string }>("/api/category/list", body),

  enrich: (body: { asins: string[]; marketplace: MarketplaceId; noCache?: boolean }) =>
    post<{ details: ProductDetailDto[]; failed: string[]; blocked: boolean; fromCache: number }>("/api/scan/enrich", body),

  expand: (body: { seed: string; marketplace: MarketplaceId; group: ProbeGroup; department: "print" | "kindle" | "all" }) =>
    post<{ keywords: KeywordRecord[]; probes: number; answered: number; reachable: number }>("/api/keywords/expand", body),

  scoreKeywords: (body: { keywords: string[]; marketplace: MarketplaceId; department: "print" | "kindle" | "all" }) =>
    post<{ scored: KeywordScoreDto[] }>("/api/keywords/score", body),

  rankCheck: (body: {
    asin: string; keywords: string[]; marketplace: MarketplaceId;
    department: "print" | "kindle" | "all"; pages?: number; titleProbe?: string;
  }) => post<{
    asin: string; marketplace: MarketplaceId; depth: number;
    results: Array<{
      keyword: string; found: boolean; position: number | null; page: number | null;
      scanned: number; totalResults: number | null; error?: string;
      /** true = Amazon asocia el libro al término; false = no; null = sin concluir. */
      indexed?: boolean | null;
    }>;
  }>("/api/scan/rank", body),

  book: (asin: string, marketplace: MarketplaceId, refresh = false) =>
    request<{
      detail: ProductDetailDto;
      marketplace: MarketplaceId;
      provider: string;
      history: RankPoint[];
      estimates: { salesPerMonth: number | null; royaltyPerUnit: number | null; revenuePerMonth: number | null };
    }>(`/api/book/${asin}?marketplace=${encodeURIComponent(marketplace)}${refresh ? "&refresh=1" : ""}`),

  royalty: (input: RoyaltyInput) => post<RoyaltyOutput>("/api/royalty", input),

  listNiches: () => request<NicheListItem[]>("/api/niches"),
  saveNiche: (body: { summary: NicheSummary; items: BookRecord[]; notes?: string }) =>
    post<{ id: string }>("/api/niches", body),
  getNiche: (id: string) =>
    request<{ summary: NicheSummary; items: BookRecord[]; notes: string; starred: boolean }>(`/api/niches/${id}`),
  updateNiche: (id: string, patch: { notes?: string; starred?: boolean }) =>
    request<{ ok: boolean }>(`/api/niches/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteNiche: (id: string) => request<{ ok: boolean }>(`/api/niches/${id}`, { method: "DELETE" }),

  listKeywordRuns: () => request<Array<{ id: string; seed: string; marketplace: MarketplaceId; createdAt: number; count: number }>>("/api/keyword-runs"),
  saveKeywordRun: (body: { seed: string; marketplace: MarketplaceId; keywords: KeywordRecord[] }) =>
    post<{ id: string }>("/api/keyword-runs", body),
  getKeywordRun: (id: string) => request<KeywordRun>(`/api/keyword-runs/${id}`),
  deleteKeywordRun: (id: string) => request<{ ok: boolean }>(`/api/keyword-runs/${id}`, { method: "DELETE" }),

  listWatch: () => request<WatchItem[]>("/api/watch"),
  addWatch: (body: {
    asin: string; marketplace: MarketplaceId; title?: string; author?: string;
    format?: string; image?: string; notes?: string;
  }) => post<{ ok: boolean }>("/api/watch", body),
  removeWatch: (asin: string, marketplace: MarketplaceId) =>
    request<{ ok: boolean }>(`/api/watch/${asin}?marketplace=${encodeURIComponent(marketplace)}`, { method: "DELETE" }),
  refreshWatch: (asins?: string[]) => post<{ ok: boolean; updated: number }>("/api/watch/refresh", { asins }),

  migrate: () => post<{ ok: boolean; statements: number; dbReady: boolean }>("/api/setup/migrate"),

  purgeCache: (all = false) => post<{ ok: boolean; removed: number }>(`/api/cache/purge${all ? "?all=1" : ""}`),
  probe: (url: string, kind?: "search" | "product" | "category") => post<ProbeResponse>("/api/debug/probe", { url, kind }),

  /** Diagnose a page copied out of a browser rather than one this app fetched. */
  parsePasted: (body: { html: string; marketplace?: string; kind?: "search" | "product" | "category" }) =>
    post<ProbeResponse>("/api/debug/parse", body),
  fetchLog: () => request<HealthInfo["recentFetches"]>("/api/debug/log"),

  /** The bookmarklet, built with this install's origin and capture token. */
  bookmarklet: () => request<{ source: string }>("/api/capture/bookmarklet"),

  /** A capture the bookmarklet could not post itself. */
  importCapture: (payload: Record<string, unknown>) =>
    post<{ id: string; analysed: number; enriched: number }>("/api/capture", payload),
};
