/** Types shared by the Cloudflare Worker (API) and the React front-end. */

export type MarketplaceId =
  | "com" | "co.uk" | "de" | "fr" | "es" | "it" | "co.jp"
  | "ca" | "com.au" | "com.mx" | "com.br" | "in" | "nl" | "pl" | "se";

export interface Marketplace {
  id: MarketplaceId;
  host: string;
  label: string;
  flag: string;
  currency: string;
  currencySymbol: string;
  language: string;
  /** Amazon's internal merchant id, needed by the autocomplete endpoint. */
  mid: string;
  /** Search alias for the printed-books department. */
  booksAlias: string;
  /** Search alias for the Kindle store. */
  kindleAlias: string;
}

export type BookFormat =
  | "paperback" | "hardcover" | "kindle" | "audible" | "spiral" | "board" | "other";

/** One book as scraped from a search results page, optionally enriched with detail-page data. */
export interface BookRecord {
  asin: string;
  title: string;
  subtitle?: string;
  author: string;
  url: string;
  image: string;
  format: BookFormat;
  formatLabel: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  sponsored: boolean;
  kindleUnlimited: boolean;
  /** 1-based position across the scraped result pages, sponsored rows excluded. */
  position: number;

  // --- detail-page enrichment (null until the book is enriched) ---
  bsr: number | null;
  categoryRanks: CategoryRank[];
  pages: number | null;
  publisher: string | null;
  publishedAt: string | null;   // ISO date
  language: string | null;
  isbn: string | null;
  dimensions: string | null;
  selfPublished: boolean | null;
  enriched: boolean;

  // --- derived metrics ---
  salesPerMonth: number | null;
  revenuePerMonth: number | null;
  royaltyPerUnit: number | null;
  ageMonths: number | null;
  /** 0-100. How weak this specific competitor looks. Higher = easier to beat. */
  weakness: number | null;
}

export interface CategoryRank {
  name: string;
  rank: number;
}

export interface NicheSummary {
  keyword: string;
  marketplace: MarketplaceId;
  scannedAt: number;
  resultsCountText: string | null;
  totalResults: number | null;
  analysed: number;
  enriched: number;

  demandScore: number;        // 0-100
  competitionScore: number;   // 0-100 (higher = tougher)
  opportunityScore: number;   // 0-100 (headline number)
  confidence: "low" | "medium" | "high";

  avgPrice: number | null;
  medianPrice: number | null;
  avgRating: number | null;
  avgReviews: number | null;
  medianReviews: number | null;
  medianBsr: number | null;
  avgSalesPerMonth: number | null;
  avgRevenuePerMonth: number | null;
  totalRevenuePerMonth: number | null;
  selfPublishedShare: number | null;   // 0-1
  lowReviewShare: number | null;       // 0-1, books under the "weak" review threshold
  freshShare: number | null;           // 0-1, books published in the last 18 months
  avgPages: number | null;
  medianAgeMonths: number | null;

  verdict: Verdict;
  signals: Signal[];
}

export interface Verdict {
  label: "Excelente" | "Bueno" | "Ajustado" | "Difícil" | "Sin datos";
  tone: "great" | "good" | "mixed" | "bad" | "unknown";
  headline: string;
  reasoning: string[];
}

export interface Signal {
  id: string;
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
  hint: string;
}

export interface NicheResult {
  summary: NicheSummary;
  items: BookRecord[];
  diagnostics: ScanDiagnostics;
}

export interface ScanDiagnostics {
  pagesFetched: number;
  fromCache: boolean;
  blocked: number;
  failures: string[];
  provider: string;
  elapsedMs: number;
  warnings: string[];
}

export interface KeywordRecord {
  keyword: string;
  /** How many distinct autocomplete probes surfaced this phrase (proxy for demand). */
  hits: number;
  /** Best (lowest) position the phrase reached in a suggestion list. */
  bestRank: number;
  /** 0-100 demand proxy derived from hits + rank + depth. */
  demandProxy: number;
  depth: number;
  source: "seed" | "suffix" | "prefix" | "question" | "alphabet";
  /** Filled in only when the keyword is scored against live search results. */
  scored?: KeywordScore;
}

export interface KeywordScore {
  totalResults: number | null;
  avgReviews: number | null;
  medianReviews: number | null;
  avgBsr: number | null;
  selfPublishedShare: number | null;
  opportunityScore: number;
  competitionScore: number;
  scannedAt: number;
}

export interface KeywordRun {
  id: string;
  seed: string;
  marketplace: MarketplaceId;
  createdAt: number;
  keywords: KeywordRecord[];
}

export interface WatchItem {
  asin: string;
  marketplace: MarketplaceId;
  title: string;
  author: string;
  format: string;
  image: string;
  notes: string;
  active: boolean;
  addedAt: number;
  latest?: RankPoint | null;
  history?: RankPoint[];
  change7d?: number | null;
  change30d?: number | null;
}

export interface RankPoint {
  capturedAt: number;
  bsr: number | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  salesEst: number | null;
  revenueEst: number | null;
  categoryRanks: CategoryRank[];
}

export interface NicheListItem {
  id: string;
  keyword: string;
  marketplace: MarketplaceId;
  opportunityScore: number;
  competitionScore: number;
  demandScore: number;
  verdict: Verdict["label"];
  tone: Verdict["tone"];
  analysed: number;
  starred: boolean;
  notes: string;
  createdAt: number;
}

/** Printing-cost parameters, editable because Amazon revises them periodically. */
export interface PrintingCosts {
  bwRegularFixed: number;
  bwRegularPerPage: number;
  bwRegularFixedMaxPages: number;
  bwLargeFixed: number;
  bwLargePerPage: number;
  colorRegularFixed: number;
  colorRegularPerPage: number;
  premiumColorFixed: number;
  premiumColorPerPage: number;
  hardcoverFixed: number;
  hardcoverPerPage: number;
}

export interface AppSettings {
  marketplace: MarketplaceId;
  /** How many search result pages to pull per niche scan (1-7). */
  searchPages: number;
  /** How many of the top results get a (slow) detail-page fetch. */
  enrichCount: number;
  cacheTtlHours: number;
  provider: "direct" | "scraperapi" | "scrapingbee" | "custom";
  customProxyTemplate: string;
  requestDelayMs: number;
  concurrency: number;
  /** Reviews below this count mark a competitor as beatable. */
  weakReviewThreshold: number;
  /** Median BSR under this counts as real demand. */
  strongBsrThreshold: number;
  royaltyRate: number;
  printing: PrintingCosts;
  /** Multiplier applied to the BSR→sales curve, for personal calibration. */
  salesCurveCalibration: number;
  theme: "dark" | "light";
  locale: "es" | "en";
}

export interface ProviderStatus {
  provider: AppSettings["provider"];
  configured: boolean;
  keyPresent: boolean;
}

export interface HealthInfo {
  authEnabled: boolean;
  dbReady: boolean;
  provider: ProviderStatus;
  recentFetches: FetchLogRow[];
  blockRate: number;
  version: string;
}

export interface FetchLogRow {
  ts: number;
  kind: string;
  target: string;
  provider: string;
  status: number;
  ok: boolean;
  blocked: boolean;
  ms: number;
  parsed: number;
  detail: string;
}

export interface RoyaltyInput {
  price: number;
  pages: number;
  format: "paperback" | "hardcover" | "kindle";
  ink: "bw" | "color" | "premium";
  trim: "regular" | "large";
  marketplace: MarketplaceId;
  fileSizeMb?: number;
}

export interface RoyaltyOutput {
  royaltyRate: number;
  printingCost: number;
  deliveryCost: number;
  royaltyPerUnit: number;
  marginPct: number;
  breakEvenPrice: number | null;
  notes: string[];
}

export interface ApiError {
  error: string;
  detail?: string;
  blocked?: boolean;
  hint?: string;
}
