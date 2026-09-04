import { RESULTS_GREEN, RESULTS_LIMIT, REVIEWS_BEATABLE, REVIEWS_UNREACHABLE } from "./checklist";

/**
 * One number per keyword, so a list of four hundred can be ranked instead of
 * read.
 *
 * The expansion alone answers "do people type this". That is half a decision:
 * a phrase everyone searches and everyone already publishes for is worse than
 * a quieter one nobody has taken. This folds the demand proxy together with
 * what the search page actually shows — how many books compete, and how much
 * review history they carry.
 *
 * On the results count it uses the same limits as the entry criteria. On
 * reviews it cannot: what makes a rival reachable depends on whether the niche
 * is notebooks or non-fiction (300 / 200 / 100), and a keyword row carries no
 * page counts to tell them apart. So it scores against the middle bar and says
 * which bar it used, and the niche report — which does read page counts — is
 * the screen that applies the right one. Callers that know the content type
 * can pass `beatableReviews` and the two then agree exactly.
 *
 * It stays null until the keyword has been scored: guessing the competition
 * half would make every unscored row look equally promising, which is the
 * error this is meant to prevent.
 */
export interface KeywordOpportunityInput {
  demandProxy: number;
  totalResults: number | null;
  medianReviews: number | null;
  lowReviewShare: number | null;
  /** The niche's own reachable-rival bar, when the caller knows it. */
  beatableReviews?: number;
}

export interface KeywordOpportunity {
  score: number;
  label: "Entrar" | "Mirar" | "Difícil";
  tone: "good" | "warn" | "bad";
  reason: string;
}

/** Piecewise-linear mapping through [input, output] anchors. */
function curve(value: number, anchors: Array<[number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    if (value <= anchors[i][0]) {
      const [x0, y0] = anchors[i - 1];
      const [x1, y1] = anchors[i];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/** Fewer competing titles is worth more, anchored on the guide's own limits. */
const RESULTS_ANCHORS: Array<[number, number]> = [
  [0, 100], [RESULTS_GREEN, 92], [RESULTS_LIMIT, 66], [5_000, 40],
  [15_000, 22], [40_000, 10], [100_000, 3],
];

/** Review history is the moat; the guide calls 200 beatable and 1000 not. */
const reviewAnchors = (beatable: number): Array<[number, number]> => [
  [0, 100], [10, 92], [Math.min(50, beatable / 2), 78], [beatable, 50], [500, 24],
  [REVIEWS_UNREACHABLE, 8], [3_000, 2],
];

export function keywordOpportunity(input: KeywordOpportunityInput): KeywordOpportunity | null {
  const { totalResults, medianReviews, lowReviewShare } = input;
  // Nothing measured about the competition yet: say so rather than score half
  // a picture and let it read as a verdict.
  if (totalResults === null && medianReviews === null) return null;

  const demand = Math.max(0, Math.min(100, input.demandProxy));
  const results = totalResults !== null ? curve(totalResults, RESULTS_ANCHORS) : 50;
  const beatable = input.beatableReviews ?? REVIEWS_BEATABLE;
  const reviews = medianReviews !== null ? curve(medianReviews, reviewAnchors(beatable)) : 50;

  let score = demand * 0.42 + results * 0.3 + reviews * 0.28;
  if (lowReviewShare !== null) score += (lowReviewShare - 0.4) * 14;
  score = Math.round(Math.max(0, Math.min(100, score)));

  const reason = buildReason(demand, totalResults, medianReviews, beatable);
  if (score >= 62) return { score, label: "Entrar", tone: "good", reason };
  if (score >= 42) return { score, label: "Mirar", tone: "warn", reason };
  return { score, label: "Difícil", tone: "bad", reason };
}

function buildReason(demand: number, totalResults: number | null, medianReviews: number | null, beatable: number): string {
  const parts: string[] = [];
  parts.push(demand >= 60 ? "Amazon la sugiere mucho" : demand >= 35 ? "Amazon la sugiere a veces" : "Amazon apenas la sugiere");
  if (totalResults !== null) {
    parts.push(
      totalResults <= RESULTS_GREEN ? `sólo ${totalResults.toLocaleString("es")} libros compiten`
      : totalResults <= RESULTS_LIMIT ? `${totalResults.toLocaleString("es")} competidores, dentro del límite`
      : `${totalResults.toLocaleString("es")} competidores, por encima del límite`,
    );
  }
  if (medianReviews !== null) {
    parts.push(
      medianReviews < beatable ? `mediana de ${Math.round(medianReviews)} reseñas: alcanzable (listón ${beatable})`
      : medianReviews < REVIEWS_UNREACHABLE ? `mediana de ${Math.round(medianReviews)} reseñas: caro de alcanzar (listón ${beatable})`
      : `mediana de ${Math.round(medianReviews)} reseñas: fuera de alcance`,
    );
  }
  return `${parts.join(" · ")}.`;
}
