import type { AppSettings, BookFormat, MarketplaceId } from "../types";

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
 * Amazon.es, fitted to two real anchors rather than scaled from the US curve.
 *
 *   BSR  10,000 → ~1 sale/day   — the "sells well" line for .es, per the
 *                                 operator guide: past 10-12k a title stops
 *                                 making a sale a day.
 *   BSR 334,200 → 1.75/month    — measured on a title whose owner knows its
 *                                 real yearly figure.
 *
 * A power law through those two lands at a log-log slope of -0.814, and the
 * table below follows it from BSR 100 down the tail. Above BSR 100 the fit
 * overshoots — head ranks always flatten — so those four entries are tapered
 * and are the least certain part of the curve.
 */
const ES_ANCHORS: Anchor[] = [
  [1, 450], [5, 220], [10, 150], [50, 60],
  [100, 42.4], [500, 11.4], [1_000, 6.52], [5_000, 1.76],
  [10_000, 1.0], [25_000, 0.47], [50_000, 0.27], [100_000, 0.154],
  [200_000, 0.087], [334_200, 0.0575], [500_000, 0.0414],
  [1_000_000, 0.0236], [2_000_000, 0.0134], [4_000_000, 0.0076],
];

/** Storefronts with a curve of their own, in that store's own units. */
const MARKET_ANCHORS: Partial<Record<MarketplaceId, Anchor[]>> = {
  es: ES_ANCHORS,
};

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

  // A storefront with its own fitted curve is already in local units, so the
  // market-size factor must not be applied on top of it.
  const own = format === "kindle" ? undefined : MARKET_ANCHORS[marketplace];
  if (own) {
    return Math.max(0, Math.round(interpolate(own, bsr) * (calibration || 1) * 1000) / 1000);
  }

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

/**
 * The calibration multiplier in force for a storefront.
 *
 * Falls back to the global one so an uncalibrated store still behaves as
 * before, and a store calibrated from real sales stops borrowing another
 * market's correction.
 */
export function calibrationFor(settings: AppSettings, marketplace: MarketplaceId): number {
  const perMarket = settings.calibrationByMarket?.[marketplace];
  if (typeof perMarket === "number" && Number.isFinite(perMarket) && perMarket > 0) return perMarket;
  return settings.salesCurveCalibration || 1;
}

/**
 * Multiplier that would make the curve match a known figure: divide the sales
 * the owner actually makes by what the uncalibrated curve predicts.
 */
export function suggestCalibration(
  samples: Array<{
    actualSalesPerMonth: number;
    rawEstimate: number;
    bsr?: number;
    format?: BookFormat;
    marketplace?: MarketplaceId;
  }>,
): number | null {
  const ratios = samples
    .map((s) => {
      // Prefer what the curve says today: a stored estimate goes stale the
      // moment the curve is refitted, and would silently keep correcting for
      // an error that no longer exists.
      const live = s.bsr && s.format && s.marketplace
        ? salesPerMonth(s.bsr, s.format, s.marketplace, 1)
        : null;
      return { ...s, rawEstimate: live ?? s.rawEstimate };
    })
    .filter((s) => s.rawEstimate > 0 && s.actualSalesPerMonth > 0)
    .map((s) => s.actualSalesPerMonth / s.rawEstimate)
    .sort((a, b) => a - b);
  if (!ratios.length) return null;
  // Median, so one unusual title cannot drag the whole store's calibration.
  const mid = Math.floor(ratios.length / 2);
  const value = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.round(Math.max(0.05, Math.min(20, value)) * 100) / 100;
}
