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
  | "base" | "alphabetA" | "alphabetB" | "digits" | "questions" | "suffixes" | "prefixes" | "related";

export const PROBE_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB", "digits", "questions", "suffixes", "prefixes", "related"];

export const QUICK_GROUPS: ProbeGroup[] = ["base", "alphabetA", "alphabetB"];

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "0123456789".split("");

/**
 * The free plan allows 50 subrequests per invocation, and the route also spends
 * a few on D1 (settings, the fetch log). Rather than trusting a comment to stay
 * true, both halves of the product are enforced: no probe may cost more than
 * MAX_CALLS_PER_PROBE upstream calls, and no group may hold more probes than
 * the remaining budget divides into.
 */
const SUBREQUEST_BUDGET = 44;
const MAX_CALLS_PER_PROBE = 3;
export const MAX_PROBES_PER_GROUP = Math.floor(SUBREQUEST_BUDGET / MAX_CALLS_PER_PROBE);

/** Modifier words per storefront language, used to widen the seed. */
const MODIFIERS: Record<string, { questions: string[]; suffixes: string[]; prefixes: string[]; connectors: string[] }> = {
  en: {
    questions: ["how to", "what", "why", "when", "best", "easy", "simple"],
    suffixes: ["for kids", "for adults", "for beginners", "for women", "for men", "for seniors", "for teens", "workbook", "journal", "planner", "notebook", "guide", "activity book", "large print", "gift"],
    prefixes: ["best", "easy", "funny", "cute", "large print", "simple", "creative"],
    connectors: ["for", "of", "with"],
  },
  es: {
    questions: ["como", "que", "por que", "cuando", "mejor", "facil"],
    suffixes: ["para niños", "para adultos", "para principiantes", "para mujeres", "para hombres", "cuaderno", "diario", "agenda", "libreta", "guia", "letra grande", "regalo"],
    prefixes: ["mejor", "facil", "divertido", "letra grande", "creativo"],
    connectors: ["para", "de", "con"],
  },
  de: {
    questions: ["wie", "was", "warum", "beste", "einfach"],
    suffixes: ["für kinder", "für erwachsene", "für anfänger", "für frauen", "notizbuch", "tagebuch", "planer", "großdruck", "geschenk"],
    prefixes: ["beste", "einfach", "lustig", "großdruck"],
    connectors: ["für", "mit"],
  },
  fr: {
    questions: ["comment", "pourquoi", "quel", "meilleur", "facile"],
    suffixes: ["pour enfants", "pour adultes", "pour débutants", "pour femmes", "carnet", "journal", "agenda", "grands caractères", "cadeau"],
    prefixes: ["meilleur", "facile", "drôle", "grands caractères"],
    connectors: ["pour", "de", "avec"],
  },
  it: {
    questions: ["come", "perché", "quale", "migliore", "facile"],
    suffixes: ["per bambini", "per adulti", "per principianti", "per donne", "quaderno", "diario", "agenda", "caratteri grandi", "regalo"],
    prefixes: ["migliore", "facile", "divertente", "caratteri grandi"],
    connectors: ["per", "di", "con"],
  },
  pt: {
    questions: ["como", "por que", "qual", "melhor", "fácil"],
    suffixes: ["para crianças", "para adultos", "para iniciantes", "caderno", "diário", "agenda", "letra grande", "presente"],
    prefixes: ["melhor", "fácil", "divertido", "letra grande"],
    connectors: ["para", "de", "com"],
  },
};

function modifiersFor(marketplace: Marketplace) {
  const lang = marketplace.language.split("_")[0];
  return MODIFIERS[lang] ?? MODIFIERS.en;
}

/**
 * Naive plural, only where a naive rule is actually right. Elsewhere the word
 * comes back unchanged and dedupes away — a wrong plural would probe a phrase
 * nobody types and waste a request saying nothing.
 */
function pluralise(word: string, lang: string): string {
  if (word.length < 3) return word;
  if (lang === "es" || lang === "pt") {
    if (/s$/.test(word)) return word;
    return /[aeiouáéíóúãõ]$/i.test(word) ? `${word}s` : `${word}es`;
  }
  if (lang === "en") {
    if (/s$/.test(word)) return word;
    return /(x|z|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
  }
  return word;
}

/**
 * The neighbourhood around a phrase.
 *
 * Amazon's autocomplete matches a *prefix*, so it answers only about the exact
 * words in the exact order given. "agenda psicologo" returns nothing not
 * because nobody wants one but because shoppers type "agenda para psicólogos".
 * These variants — each word alone, the words rotated, the connectors the
 * language actually uses, the plural — ask the same question along the routes
 * a real shopper would take, and they are where the indirect ideas come from.
 */
export function relatedSeeds(seed: string, marketplace: Marketplace): string[] {
  const base = seed.trim().toLowerCase().replace(/\s+/g, " ");
  const words = base.split(" ").filter(Boolean);
  if (!words.length) return [];

  const lang = marketplace.language.split("_")[0];
  const mods = modifiersFor(marketplace);
  const joiners = new Set(mods.connectors);
  // The words carrying the meaning. "agenda para psicologos" is a two-idea
  // phrase: probing "para" on its own would return everything else that starts
  // with it, and those completions have nothing to do with the seed.
  const content = words.filter((word) => !joiners.has(word) && word.length > 2);
  const out = new Set<string>();

  const add = (phrase: string) => {
    const clean = phrase.trim().replace(/\s+/g, " ");
    if (clean.length < 3 || joiners.has(clean)) return;
    out.add(clean);
  };

  if (content.length <= 1) {
    const word = content[0] ?? words[0];
    add(pluralise(word, lang));
    for (const suffix of mods.suffixes.slice(0, 6)) add(`${word} ${suffix}`);
  } else {
    const tail = words[words.length - 1];
    const head = words.slice(0, -1).join(" ");
    // A seed that already carries its connector must not be given another:
    // "agenda para" + "para" is a phrase nobody has ever typed.
    const headAlreadyJoined = joiners.has(words[words.length - 2] ?? "");

    // The plural goes first. On a phrase that came back empty it is the single
    // likeliest real answer, so the cap below must never be what drops it.
    add(`${head} ${pluralise(tail, lang)}`);
    for (const word of content) add(word);
    add([content[content.length - 1], ...content.slice(0, -1)].join(" "));
    add(head);
    add(words.slice(1).join(" "));

    if (!headAlreadyJoined) {
      // "<head> <conn>" is the most productive probe of the set: it returns
      // every ending shoppers attach to the phrase, not just the one typed.
      for (const conn of mods.connectors) add(`${head} ${conn}`);
      for (const conn of mods.connectors) add(`${head} ${conn} ${tail}`);
    }
  }

  out.delete(base);
  return Array.from(out).slice(0, MAX_PROBES_PER_GROUP);
}

/** The probe list for one group. Kept small so a request stays within the
 *  Workers subrequest budget; the UI runs the groups one after another. */
export function buildProbes(seed: string, group: ProbeGroup, marketplace: Marketplace): string[] {
  const s = seed.trim().toLowerCase();
  if (!s) return [];
  const mods = modifiersFor(marketplace);
  // Every branch is capped: the English suffix list alone is long enough to
  // push an invocation past the subrequest budget.
  return probesFor(s, group, marketplace, mods).slice(0, MAX_PROBES_PER_GROUP);
}

function probesFor(
  s: string,
  group: ProbeGroup,
  marketplace: Marketplace,
  mods: ReturnType<typeof modifiersFor>,
): string[] {
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
    case "related":
      return relatedSeeds(s, marketplace);
  }
}

interface SuggestionApiResponse {
  suggestions?: Array<{ value?: string; suggType?: string; ghost?: boolean }>;
}

/**
 * Query Amazon's own search-box autocomplete for one prefix.
 *
 * Three sources are tried in order, and the call counter is the point: the
 * total is hard-capped at MAX_CALLS_PER_PROBE, because `attempts` is a number
 * of tries rather than one call, and a retry on the first source used to be
 * able to push the whole invocation past the free plan's subrequest limit.
 */
export async function fetchSuggestions(
  env: Env,
  settings: AppSettings,
  marketplace: Marketplace,
  prefix: string,
  department: "print" | "kindle" | "all",
): Promise<ProbeOutcome> {
  let calls = 0;
  let reached = false;

  const ask = async (url: string, attempts: number): Promise<string[] | null> => {
    const budget = Math.min(attempts, MAX_CALLS_PER_PROBE - calls);
    if (budget <= 0) return null;
    const before = calls;
    const outcome = await fetchPage(env, settings, url, {
      language: marketplace.language,
      json: true,
      attempts: budget,
      timeoutMs: 9000,
    });
    // fetchPage retries internally, so charge the whole budget it was given:
    // assuming one call is how the cap was breached in the first place.
    calls = before + budget;
    if (!outcome.ok) return null;
    reached = true;
    return readSuggestions(outcome.body);
  };

  // Which alias to ask with first.
  //
  // On Amazon.es the books alias answers in English — "agenda 3 hole",
  // "august 2026-july2027 school agenda" — while the unnarrowed alias answers
  // in Spanish for the same seed. `mid` and `lop` evidently localise the
  // generic index but not the department one, which then falls back to the US
  // set. A suggestion in the wrong language is worth less than an unnarrowed
  // one in the right language: nobody on Amazon.es types those queries, so the
  // department narrowing is dropped where it costs the localisation.
  const localised = marketplace.language.split("_")[0] !== "en";
  const first: "print" | "kindle" | "all" = localised ? "all" : department;

  // The shared host first; only if it yields nothing, the storefront's own.
  // One host being wrong should degrade the result, never empty it.
  const shared = await ask(suggestUrl(marketplace, prefix, first, "shared"), 2);
  if (shared?.length) return { reached: true, values: shared };

  const regional = await ask(suggestUrl(marketplace, prefix, first, "regional"), 1);
  if (regional?.length) return { reached: true, values: regional };

  // Nothing under the preferred alias: try the other one rather than report
  // silence. Only when Amazon answered and had nothing — a refusal has already
  // spent the budget above.
  const second: "print" | "kindle" | "all" = first === department ? "all" : department;
  if (reached && second !== first) {
    const other = await ask(suggestUrl(marketplace, prefix, second, "shared"), 1);
    if (other?.length) return { reached: true, values: other };
  }

  // `reached` is the difference between "Amazon is turning us away" and "Amazon
  // answered and has nothing to suggest for this phrase". The second is a
  // finding about the market; reporting it as the first hides that.
  return { reached, values: [] };
}

export interface ProbeOutcome {
  /** Amazon answered at all, whatever it said. */
  reached: boolean;
  values: string[];
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
  /** Probes that came back with at least one suggestion. */
  answered: number;
  /** Probes Amazon responded to at all. */
  reachable: number;
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
  if (!probes.length) return { keywords: [], probes: 0, answered: 0, reachable: 0 };

  const source: KeywordRecord["source"] =
    group === "base" ? "seed"
    : group === "alphabetA" || group === "alphabetB" || group === "digits" ? "alphabet"
    : group === "questions" ? "question"
    : group === "prefixes" ? "prefix"
    : group === "related" ? "related"
    : "suffix";

  const lists = await mapWithConcurrency(probes, settings.concurrency, settings.requestDelayMs, (probe) =>
    fetchSuggestions(env, settings, marketplace, probe, department),
  );

  const map = new Map<string, KeywordRecord>();
  let answered = 0;
  let reachable = 0;

  lists.forEach(({ reached, values: suggestions }) => {
    if (reached) reachable += 1;
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
  return { keywords, probes: probes.length, answered, reachable };
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
