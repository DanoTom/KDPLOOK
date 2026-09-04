import type { BookRecord, MarketplaceId } from "../../shared/types";
import type { ProductDetailDto } from "../api";

/**
 * A detail page as the analytics see it.
 *
 * Shared by every screen that builds records from ASINs rather than from a
 * search — the category browser and the idea miner both do — so the two cannot
 * drift apart on what a missing field means. The derived numbers stay null on
 * purpose: `deriveMetrics` fills them, and doing it here would compute them
 * twice with two different settings snapshots.
 */
export function bookFromDetail(detail: ProductDetailDto, marketplace: MarketplaceId, position: number): BookRecord {
  return {
    asin: detail.asin,
    title: detail.title ?? detail.asin,
    author: detail.author ?? "",
    url: `https://www.amazon.${marketplace}/dp/${detail.asin}`,
    image: detail.image ?? "",
    format: detail.format ?? "paperback",
    formatLabel: detail.formatLabel ?? "",
    price: detail.price,
    rating: detail.rating,
    reviews: detail.reviews,
    sponsored: false,
    kindleUnlimited: Boolean((detail as { kindleUnlimited?: boolean }).kindleUnlimited),
    position,
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
    salesPerMonth: null,
    revenuePerMonth: null,
    royaltyPerUnit: null,
    ageMonths: null,
    weakness: null,
  };
}
