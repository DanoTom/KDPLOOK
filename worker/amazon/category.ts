import type { Marketplace } from "../../shared/types";
import { decodeEntities, stripTags } from "./html";

export interface CategoryChild {
  name: string;
  node: string;
}

export interface CategoryListing {
  node: string;
  name: string | null;
  /** ASINs in bestseller order: index 0 is the category's #1. */
  asins: string[];
  children: CategoryChild[];
  breadcrumb: string[];
}

/** Bestseller list for a browse node. `node` empty means the department root. */
export function bestsellerUrl(m: Marketplace, node: string, department: "print" | "kindle", page = 1): string {
  const dept = department === "kindle" ? "digital-text" : "books";
  const path = node ? `/gp/bestsellers/${dept}/${encodeURIComponent(node)}/` : `/gp/bestsellers/${dept}/`;
  return `https://${m.host}${path}${page > 1 ? `?pg=${page}` : ""}`;
}

/**
 * Parse a bestseller page.
 *
 * The grid markup on these pages is built from hashed CSS class names that
 * change without notice, so nothing here depends on them. What is stable is
 * the order of `/dp/<ASIN>` links inside the results grid — that ordering *is*
 * the category ranking. Everything else about each book (price, reviews, BSR,
 * publisher) then comes from the product parser, which is already tested.
 */
export function parseBestsellerPage(html: string): CategoryListing {
  const grid = trimToGrid(html);

  // Rank order = document order of the product links, first sighting wins.
  const asins: string[] = [];
  const seen = new Set<string>();
  const linkRe = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(grid)) !== null) {
    const asin = m[1];
    if (!seen.has(asin)) {
      seen.add(asin);
      asins.push(asin);
    }
    if (asins.length >= 60) break;
  }

  return {
    node: "",
    name: extractCategoryName(html),
    asins,
    children: extractChildren(html),
    breadcrumb: extractBreadcrumb(html),
  };
}

function trimToGrid(html: string): string {
  // Skip the navigation column so its links cannot be mistaken for results.
  for (const marker of ['id="gridItemRoot"', 'class="p13n-desktop-grid"', 'id="zg-ordered-list"', 'id="zg-right-col"']) {
    const idx = html.indexOf(marker);
    if (idx > 0) return html.slice(idx);
  }
  return html;
}

function extractCategoryName(html: string): string | null {
  const raw =
    /<title>([^<]{3,200})<\/title>/i.exec(html)?.[1] ??
    /class="[^"]*category[^"]*"[^>]*>\s*([^<]{3,80})</i.exec(html)?.[1] ??
    null;
  if (!raw) return null;
  // "Amazon Best Sellers: Best Coloring Books for Grown-Ups"
  const cleaned = decodeEntities(raw)
    .replace(/^Amazon[^:]*:\s*/i, "")
    .replace(/^Best Sellers[^:]*:\s*/i, "")
    .replace(/^Los más vendidos[^:]*:\s*/i, "")
    .replace(/^Best\s+/i, "")
    .replace(/^Los más vendidos en\s+/i, "")
    .trim();
  return cleaned.slice(0, 90) || null;
}

/** Browse-node links, in document order, as Amazon lists them in the side nav. */
function extractChildren(html: string): CategoryChild[] {
  const nav = navRegion(html);
  const out: CategoryChild[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="[^"]*?\/(?:gp\/bestsellers|zgbs)\/[a-z0-9-]+\/(\d+)[^"]*"[^>]*>([\s\S]{1,120}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav)) !== null) {
    const node = m[1];
    const name = stripTags(m[2]).replace(/\s+/g, " ").trim();
    if (!name || name.length < 2 || name.length > 70 || seen.has(node)) continue;
    seen.add(node);
    out.push({ name, node });
    if (out.length >= 80) break;
  }
  return out;
}

function navRegion(html: string): string {
  for (const marker of ['id="zg-left-col"', 'role="group"', 'id="zg_browseRoot"', 'class="zg_browseRoot"']) {
    const idx = html.indexOf(marker);
    if (idx >= 0) return html.slice(idx, idx + 40000);
  }
  return html.slice(0, 60000);
}

function extractBreadcrumb(html: string): string[] {
  const nav = navRegion(html);
  const crumbs: string[] = [];
  // Amazon marks the ancestors of the open category with `zg_selected`.
  const re = /class="[^"]*zg_selected[^"]*"[^>]*>([\s\S]{1,160}?)<\/(?:span|a|div)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(nav)) !== null) {
    const name = stripTags(m[1]).replace(/\s+/g, " ").trim();
    if (name && name.length < 70 && !crumbs.includes(name)) crumbs.push(name);
    if (crumbs.length >= 8) break;
  }
  return crumbs;
}
