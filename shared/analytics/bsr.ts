import type { BookFormat, MarketplaceId } from "../types";

/**
 * BSR → sales estimation.
 *
 * Amazon never publishes the mapping, so every tool on the market (KDSpy,
 * Publisher Rocket, Book Bolt…) works from an empirically fitted curve. These
 * anchor tables follow the widely reproduced community fits for the US store;
 * between anchors we interpolate in log-log space, which is where the
 * relationship is close to linear. Treat the output as an order of magnitude,
 * not an accounting figure — that is why `calibration` exists.
 */

type Anchor = [bsr: number, salesPerDay: number];

/** Print books (Amazon.com "Books" store). */
const PRINT_ANCHORS: Anchor[] = [
  [1, 7000], [5, 3000], [10, 2000], [50, 800], [100, 500],
  [500, 200], [1_000, 120], [3_000, 55], [5_000, 35], [10_000, 20],
  [25_000, 9], [50_000, 5], [100_000, 2.5], [200_000, 1.1],
  [350_000, 0.6], [500_000, 0.4], [750_000, 0.22], [1_000_000, 0.12],
  [2_000_000, 0.04], [4_000_000, 0.012], [8_000_000, 0.004],
];

/** Kindle store: more units at the head, a steeper drop in the tail. */
const KINDLE_ANCHORS: Anchor[] = [
  [1, 5000], [5, 2400], [10, 1600], [50, 700], [100, 480],
  [500, 180], [1_000, 110], [3_000, 45], [5_000, 28], [10_000, 13],
  [25_000, 6], [50_000, 3], [100_000, 1.2], [200_000, 0.55],
  [350_000, 0.28], [500_000, 0.16], [750_000, 0.08], [1_000_000, 0.05],
  [2_000_000, 0.018], [4_000_000, 0.005], [8_000_000, 0.0015],
];

/**
 * Relative size of each storefront versus Amazon.com. A rank of 10,000 in a
 * small store represents far fewer units than the same rank in the US.
 */
const MARKET_FACTOR: Record<MarketplaceId, number> = {
  "com": 1, "co.uk": 0.22, "de": 0.2, "co.jp": 0.15, "ca": 0.08,
  "fr": 0.1, "it": 0.07, "es": 0.06, "com.au": 0.05, "in": 0.04,
  "nl": 0.04, "com.mx": 0.03, "com.br": 0.03, "pl": 0.02, "se": 0.02,
};

function interpolate(anchors: Anchor[], bsr: number): number {
  if (bsr <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (bsr >= last[0]) {
    // Extend the final slope rather than flat-lining at the last anchor.
    const [prevBsr, prevSales] = anchors[anchors.length - 2];
    const slope = (Math.log(last[1]) - Math.log(prevSales)) / (Math.log(last[0]) - Math.log(prevBsr));
    return Math.exp(Math.log(last[1]) + slope * (Math.log(bsr) - Math.log(last[0])));
  }
  for (let i = 1; i < anchors.length; i++) {
    const [hiBsr, hiSales] = anchors[i];
    if (bsr <= hiBsr) {
      const [loBsr, loSales] = anchors[i - 1];
      const t = (Math.log(bsr) - Math.log(loBsr)) / (Math.log(hiBsr) - Math.log(loBsr));
      return Math.exp(Math.log(loSales) + t * (Math.log(hiSales) - Math.log(loSales)));
    }
  }
  return last[1];
}

export function salesPerDay(
  bsr: number | null,
  format: BookFormat,
  marketplace: MarketplaceId,
  calibration = 1,
): number | null {
  if (!bsr || bsr <= 0 || !Number.isFinite(bsr)) return null;
  const anchors = format === "kindle" ? KINDLE_ANCHORS : PRINT_ANCHORS;
  const base = interpolate(anchors, bsr);
  const scaled = base * (MARKET_FACTOR[marketplace] ?? 0.05) * (calibration || 1);
  return Math.max(0, Math.round(scaled * 1000) / 1000);
}

export function salesPerMonth(
  bsr: number | null,
  format: BookFormat,
  marketplace: MarketplaceId,
  calibration = 1,
): number | null {
  const perDay = salesPerDay(bsr, format, marketplace, calibration);
  if (perDay === null) return null;
  return Math.round(perDay * 30.44 * 10) / 10;
}

/** Inverse lookup: what rank would a given monthly run-rate imply? */
export function bsrForSalesPerMonth(
  target: number,
  format: BookFormat,
  marketplace: MarketplaceId,
  calibration = 1,
): number | null {
  if (!target || target <= 0) return null;
  let lo = 1;
  let hi = 8_000_000;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi);
    const value = salesPerMonth(mid, format, marketplace, calibration) ?? 0;
    if (value > target) lo = mid; else hi = mid;
  }
  return Math.round(Math.sqrt(lo * hi));
}

export const MARKET_FACTORS = MARKET_FACTOR;
