import { useCallback, useMemo, useRef, useState } from "react";
import type { AppSettings, BookRecord, MarketplaceId, NicheResult, NicheSummary } from "../../shared/types";
import { deriveMetrics, summariseNiche } from "../../shared/analytics/score";
import { ApiError, api, type ProductDetailDto } from "../api";

export type Department = "print" | "kindle" | "all";

export interface ScanParams {
  keyword: string;
  marketplace: MarketplaceId;
  department: Department;
  pages: number;
  enrich: number;
  noCache?: boolean;
}

export interface ScanProgress {
  phase: "idle" | "search" | "enrich" | "done" | "error";
  label: string;
  done: number;
  total: number;
}

interface RawScan {
  keyword: string;
  marketplace: MarketplaceId;
  items: BookRecord[];
  totalResults: number | null;
  resultsCountText: string | null;
  warnings: string[];
  blocked: boolean;
  provider: string;
  elapsedMs: number;
  fromCache: boolean;
  scannedAt: number;
}

const EMPTY_PROGRESS: ScanProgress = { phase: "idle", label: "", done: 0, total: 0 };

/**
 * Drives a niche scan across several small API calls.
 *
 * Each Worker invocation fetches exactly one upstream page, which keeps every
 * request inside Cloudflare's per-invocation subrequest and CPU budgets and
 * lets the UI show real progress instead of a long opaque spinner.
 */
export function useNicheScan(settings: AppSettings) {
  const [raw, setRaw] = useState<RawScan | null>(null);
  const [progress, setProgress] = useState<ScanProgress>(EMPTY_PROGRESS);
  const [error, setError] = useState<{ message: string; hint?: string; blocked: boolean } | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async (params: ScanParams) => {
    cancelled.current = false;
    setError(null);
    setRaw(null);

    const pages = Math.max(1, Math.min(7, params.pages));
    const warnings: string[] = [];
    const collected = new Map<string, BookRecord>();
    let totalResults: number | null = null;
    let resultsCountText: string | null = null;
    let provider = "direct";
    let fromCache = true;
    const started = Date.now();

    setProgress({ phase: "search", label: "Leyendo resultados de búsqueda…", done: 0, total: pages });

    for (let page = 1; page <= pages; page++) {
      if (cancelled.current) return;
      try {
        const response = await api.searchPage({
          keyword: params.keyword,
          marketplace: params.marketplace,
          page,
          department: params.department,
          noCache: params.noCache,
        });
        provider = response.provider;
        if (!response.fromCache) fromCache = false;
        if (page === 1) {
          totalResults = response.totalResults;
          resultsCountText = response.resultsCountText;
        }
        if (response.warning) warnings.push(`Página ${page}: ${response.warning}`);
        for (const item of response.items) {
          // Later pages repeat sponsored placements; keep the first sighting.
          if (!collected.has(item.asin)) collected.set(item.asin, item);
        }
        // A short page means Amazon ran out of results for this query.
        if (response.items.length === 0) break;
      } catch (err) {
        const apiError = err instanceof ApiError ? err : null;
        if (page === 1) {
          setProgress(EMPTY_PROGRESS);
          setError({
            message: apiError?.message ?? "No se pudo completar la búsqueda",
            hint: apiError?.hint,
            blocked: Boolean(apiError?.blocked),
          });
          return;
        }
        warnings.push(`Página ${page}: ${apiError?.message ?? "fallo de red"}`);
        break;
      }
      setProgress({ phase: "search", label: `Página ${page} de ${pages}`, done: page, total: pages });
    }

    const items = Array.from(collected.values());
    if (!items.length) {
      setProgress(EMPTY_PROGRESS);
      setError({
        message: "Amazon respondió, pero no se reconoció ningún libro.",
        hint: "Prueba otra palabra clave o revisa la pestaña Diagnóstico para comprobar los selectores.",
        blocked: false,
      });
      return;
    }

    // --- enrichment ---------------------------------------------------------
    const organic = items.filter((item) => !item.sponsored);
    const targets = organic.slice(0, Math.max(0, Math.min(40, params.enrich)));
    const batches: string[][] = [];
    for (let i = 0; i < targets.length; i += 8) batches.push(targets.slice(i, i + 8).map((item) => item.asin));

    let enrichedCount = 0;
    let blocked = false;

    for (let index = 0; index < batches.length; index++) {
      if (cancelled.current) return;
      setProgress({
        phase: "enrich",
        label: `Obteniendo BSR y datos de ficha (${enrichedCount}/${targets.length})`,
        done: enrichedCount,
        total: targets.length,
      });
      try {
        const response = await api.enrich({
          asins: batches[index],
          marketplace: params.marketplace,
          noCache: params.noCache,
        });
        if (response.blocked) blocked = true;
        for (const detail of response.details) {
          const book = collected.get(detail.asin);
          if (book) collected.set(detail.asin, mergeDetail(book, detail));
        }
        enrichedCount += response.details.length;
        if (response.failed.length) {
          warnings.push(`${response.failed.length} fichas no se pudieron leer (${response.failed.slice(0, 3).join(", ")}…)`);
        }
      } catch (err) {
        const apiError = err instanceof ApiError ? err : null;
        if (apiError?.blocked) blocked = true;
        warnings.push(`Enriquecimiento interrumpido: ${apiError?.message ?? "fallo de red"}`);
        break;
      }
    }

    if (blocked) {
      warnings.push("Amazon bloqueó parte de las peticiones de ficha; los datos de BSR están incompletos.");
    }

    setRaw({
      keyword: params.keyword,
      marketplace: params.marketplace,
      items: Array.from(collected.values()),
      totalResults,
      resultsCountText,
      warnings,
      blocked,
      provider,
      elapsedMs: Date.now() - started,
      fromCache,
      scannedAt: Date.now(),
    });
    setProgress({ phase: "done", label: "Análisis completo", done: targets.length, total: targets.length });
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    setProgress(EMPTY_PROGRESS);
  }, []);

  const reset = useCallback(() => {
    cancelled.current = true;
    setRaw(null);
    setError(null);
    setProgress(EMPTY_PROGRESS);
  }, []);

  /**
   * Metrics and scoring live in `shared/`, so changing a setting (the sales
   * calibration, the "weak competitor" threshold) re-scores instantly without
   * touching Amazon again.
   */
  const result = useMemo<NicheResult | null>(() => {
    if (!raw) return null;
    const derived = raw.items.map((item) => deriveMetrics(item, raw.marketplace, settings));
    const summary: NicheSummary = summariseNiche(derived, {
      keyword: raw.keyword,
      marketplace: raw.marketplace,
      settings,
      totalResults: raw.totalResults,
      resultsCountText: raw.resultsCountText,
    });
    summary.scannedAt = raw.scannedAt;
    return {
      summary,
      items: derived,
      diagnostics: {
        pagesFetched: 0,
        fromCache: raw.fromCache,
        blocked: raw.blocked ? 1 : 0,
        failures: [],
        provider: raw.provider,
        elapsedMs: raw.elapsedMs,
        warnings: raw.warnings,
      },
    };
  }, [raw, settings]);

  /** Rehydrate a saved analysis so it renders through the same code path. */
  const loadSaved = useCallback((summary: NicheSummary, items: BookRecord[]) => {
    setRaw({
      keyword: summary.keyword,
      marketplace: summary.marketplace,
      items,
      totalResults: summary.totalResults,
      resultsCountText: summary.resultsCountText,
      warnings: [],
      blocked: false,
      provider: "guardado",
      elapsedMs: 0,
      fromCache: true,
      scannedAt: summary.scannedAt,
    });
    setProgress({ phase: "done", label: "Análisis guardado", done: 1, total: 1 });
  }, []);

  return { result, progress, error, run, cancel, reset, loadSaved, busy: progress.phase === "search" || progress.phase === "enrich" };
}

function mergeDetail(book: BookRecord, detail: ProductDetailDto): BookRecord {
  return {
    ...book,
    // Search cards truncate; detail pages carry the full title and price.
    title: detail.title && detail.title.length > book.title.length ? detail.title : book.title,
    author: book.author || detail.author || "",
    image: book.image || detail.image || "",
    price: book.price ?? detail.price,
    rating: detail.rating ?? book.rating,
    reviews: detail.reviews ?? book.reviews,
    format: detail.format ?? book.format,
    formatLabel: detail.formatLabel ?? book.formatLabel,
    bsr: detail.bsr,
    categoryRanks: detail.categoryRanks ?? [],
    pages: detail.pages,
    publisher: detail.publisher,
    publishedAt: detail.publishedAt,
    language: detail.language,
    isbn: detail.isbn,
    dimensions: detail.dimensions,
    selfPublished: detail.selfPublished,
    enriched: true,
  };
}
