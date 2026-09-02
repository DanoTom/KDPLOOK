import type { Marketplace, MarketplaceId } from "../../shared/types";

const LOCALE = "es-ES";

export function fmtInt(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.round(value).toLocaleString(LOCALE);
}

export function fmtNum(value: number | null | undefined, digits = 1, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return value.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtMoney(value: number | null | undefined, symbol = "$", fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return `${symbol}${value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPct(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return `${Math.round(value * 100)}%`;
}

/** Big numbers in tight table cells: 12.4k, 1.2M. */
export function fmtCompact(value: number | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(".0", "")}k`;
  return String(Math.round(value));
}

export function fmtDate(value: number | string | null | undefined, fallback = "—"): string {
  if (value === null || value === undefined) return fallback;
  const date = typeof value === "number" ? new Date(value) : new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(LOCALE, { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(value: number | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString(LOCALE, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function fmtAge(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "—";
  if (months < 1) return "nuevo";
  if (months < 24) return `${Math.round(months)} m`;
  return `${(months / 12).toFixed(1)} a`;
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return fmtDate(ts);
}

export function currencyOf(marketplaces: Marketplace[], id: MarketplaceId): string {
  return marketplaces.find((m) => m.id === id)?.currencySymbol ?? "$";
}

export function toneForScore(score: number): "good" | "warn" | "bad" {
  if (score >= 65) return "good";
  if (score >= 45) return "warn";
  return "bad";
}

/** Competition reads the other way round: a high number is bad news. */
export function toneForCompetition(score: number): "good" | "warn" | "bad" {
  if (score <= 40) return "good";
  if (score <= 65) return "warn";
  return "bad";
}

export function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
