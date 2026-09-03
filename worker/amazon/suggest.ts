import type { AppSettings, KeywordRecord, Marketplace } from "../../shared/types";
import type { Env } from "../env";
import { fetchPage, mapWithConcurrency } from "./fetcher";
import { suggestUrl } from "./marketplaces";

/**
 * Probe groups are deliberately small. Cloudflare caps a Worker invocation at
 * 50 subrequests on the free plan, so the alphabet sweep is split in two and
 * the UI walks the groups one request at a time.
 */
export type ProbeGroup =
  | "base" | "alphabetA" | "alphabetB" | "digits" | "questions" | "suffixes" | "prefixes";

export const PROBE_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB", "digits", "questions", "suffixes", "prefixes"];

export const QUICK_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");

/** Modifier words per storefront language, used to widen the seed. */
const MODIFIERS: Record<string, { questions: string[]; suffixes: string[]; prefixes: string[] }> = {
  en: {
    questions: ["how to", "what", "why", "when", "best", "easy", "simple"],
    suffixes: ["for kids", "for adults", "for beginners", "for women", "for men", "for seniors", "for teens", "workbook", "journal", "planner", "notebook", "guide", "activity book", "large print", "gift"],
    prefixes: ["best", "easy", "funny", "cute", "large print", "simple", "creative"],
  },
  es: {
    questions: ["como", "que", "por que", "cuando", "mejor", "facil"],
    suffixes: ["para niños", "para adultos", "para principiantes", "para mujeres", "para hombres", "cuaderno", "diario", "agenda", "libreta", "guia", "letra grande", "regalo"],
    prefixes: ["mejor", "facil", "divertido", "letra grande", "creativo"],
  },
  de: {
    questions: ["wie", "was", "warum", "beste", "einfach"],
    suffixes: ["für kinder", "für erwachsene", "für anfänger", "für frauen", "notizbuch", "tagebuch", "planer", "großdruck", "geschenk"],
    prefixes: ["beste", "einfach", "lustig", "großdruck"],
  },
  fr: {
    questions: ["comment", "pourquoi", "quel", "meilleur", "facile"],
    suffixes: ["pour enfants", "pour adultes", "pour débutants", "pour femmes", "carnet", "journal", "agenda", "grands caractères", "cadeau"],
    prefixes: ["meilleur", "facile", "drôle", "grands caractères"],
  },
  it: {
    questions: ["come", "perché", "quale", "migliore", "facile"],
    suffixes: ["per bambini", "per adulti", "per principianti", "per donne", "quaderno", "diario", "agenda", "caratteri grandi", "regalo"],
    prefixes: ["migliore", "facile", "divertente", "caratteri grandi"],
  },
  pt: {
    questions: ["como", "por que", "qual", "melhor", "fácil"],
    suffixes: ["para crianças", "para adultos", "para iniciantes", "caderno", "diário", "agenda", "letra grande", "presente"],
    prefixes: ["melhor", "fácil", "divertido", "letra grande"],
  },
};

function modifiersFor(marketplace: Marketplace) {
  const lang = marketplace.language.split("_")[0];
  return MODIFIERS[lang] ?? MODIFIERS.en;
}

/** The probe list for one group. Kept small so a request stays within the
 *  Workers subrequest budget; the UI runs the groups one after another. */
export function buildProbes(seed: string, group: ProbeGroup, marketplace: Marketplace): string[] {
  const s = seed.trim().toLowerCase();
  if (!s) return [];
  const mods = modifiersFor(marketplace);
  switch (group) {
    case "base":
      return [s, `${s} `];
    case "alphabetA":
      return ALPHABET.slice(0, 13).map((letter) => `${s} ${letter}`);
    case "alphabetB":
      return ALPHABET.slice(13).map((letter) => `${s} ${letter}`);
    case "digits":
      return DIGITS.map((digit) => `${s} ${digit}`);
    case "questions":
      return mods.questions.map((q) => `${q} ${s}`);
    case "suffixes":
      return mods.suffixes.map((suffix) => `${s} ${suffix}`);
    case "prefixes":
      return mods.prefixes.map((prefix) => `${prefix} ${s}`);
  }
}

interface SuggestionApiResponse {
  suggestions?: Array<{ value?: string; suggType?: string; ghost?: boolean }>;
}

/** Query Amazon's own search-box autocomplete for one prefix. */
export async function fetchSuggestions(
  env: Env,
  settings: AppSettings,
  marketplace: Marketplace,
  prefix: string,
  department: "print" | "kindle" | "all",
): Promise<string[]> {
  // Try the shared host first; only if it yields nothing, try the storefront's
  // own. One host being wrong should degrade the result, never empty it.
  for (const variant of ["shared", "regional"] as const) {
    const outcome = await fetchPage(env, settings, suggestUrl(marketplace, prefix, department, variant), {
      language: marketplace.language,
      json: true,
      attempts: variant === "shared" ? 2 : 1,
      timeoutMs: 9000,
    });
    if (!outcome.ok) continue;
    const values = readSuggestions(outcome.body);
    if (values.length) return values;
  }
  return [];
}

function readSuggestions(body: string): string[] {
  try {
    const data = JSON.parse(body) as SuggestionApiResponse;
    return (data.suggestions ?? [])
      .filter((s) => s && typeof s.value === "string" && !s.ghost)
      .map((s) => (s.value as string).trim().toLowerCase())
      .filter((v) => v.length > 1 && v.length < 90);
  } catch {
    return [];
  }
}

export interface ExpandResult {
  keywords: KeywordRecord[];
  probes: number;
  answered: number;
}

/**
 * Run every probe in a group and fold the answers into scored keyword records.
 * A phrase that several different probes surface — and surfaces high in the
 * list — is one Amazon considers a strong query, which is the closest proxy
 * for search volume that is available without a paid data source.
 */
export async function expandKeywords(
  env: Env,
  settings: AppSettings,
  marketplace: Marketplace,
  seed: string,
  group: ProbeGroup,
  department: "print" | "kindle" | "all",
): Promise<ExpandResult> {
  const probes = buildProbes(seed, group, marketplace);
  if (!probes.length) return { keywords: [], probes: 0, answered: 0 };

  const source: KeywordRecord["source"] =
    group === "base" ? "seed"
    : group === "alphabetA" || group === "alphabetB" || group === "digits" ? "alphabet"
    : group === "questions" ? "question"
    : group === "prefixes" ? "prefix"
    : "suffix";

  const lists = await mapWithConcurrency(probes, settings.concurrency, settings.requestDelayMs, (probe) =>
    fetchSuggestions(env, settings, marketplace, probe, department),
  );

  const map = new Map<string, KeywordRecord>();
  let answered = 0;

  lists.forEach((suggestions) => {
    if (suggestions.length) answered += 1;
    suggestions.forEach((phrase, rank) => {
      const existing = map.get(phrase);
      if (existing) {
        existing.hits += 1;
        existing.bestRank = Math.min(existing.bestRank, rank + 1);
      } else {
        map.set(phrase, {
          keyword: phrase,
          hits: 1,
          bestRank: rank + 1,
          demandProxy: 0,
          depth: phrase.split(/\s+/).length,
          source,
        });
      }
    });
  });

  const keywords = Array.from(map.values()).map((record) => ({
    ...record,
    demandProxy: demandProxy(record, probes.length),
  }));

  keywords.sort((a, b) => b.demandProxy - a.demandProxy);
  return { keywords, probes: probes.length, answered };
}

/**
 * 0-100 proxy for how much traffic a phrase likely carries.
 *  - appearing under many different probes = broadly relevant
 *  - appearing near the top of a list = Amazon ranks it highly
 *  - very long tails get a small penalty, they are usually thin
 */
function demandProxy(record: KeywordRecord, probeCount: number): number {
  const coverage = Math.min(1, record.hits / Math.max(3, probeCount * 0.35));
  const rankScore = Math.max(0, 1 - (record.bestRank - 1) / 11);
  const depthPenalty = record.depth >= 7 ? 0.82 : record.depth >= 5 ? 0.93 : 1;
  const raw = (coverage * 0.55 + rankScore * 0.45) * depthPenalty;
  return Math.round(Math.max(0, Math.min(1, raw)) * 100);
}

/** Merge keyword records coming from several probe groups. */
export function mergeKeywords(groups: KeywordRecord[][]): KeywordRecord[] {
  const map = new Map<string, KeywordRecord>();
  for (const list of groups) {
    for (const record of list) {
      const existing = map.get(record.keyword);
      if (!existing) {
        map.set(record.keyword, { ...record });
        continue;
      }
      existing.hits += record.hits;
      existing.bestRank = Math.min(existing.bestRank, record.bestRank);
      existing.demandProxy = Math.max(existing.demandProxy, record.demandProxy);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.demandProxy - a.demandProxy);
}
