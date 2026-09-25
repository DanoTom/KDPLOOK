/**
 * What is worth remembering.
 *
 * Every Amazon read used to be cached for the full TTL whatever it contained,
 * so a single refused request became a twelve-hour outage for that query: the
 * next press of "Analizar" returned the cached failure instantly, without
 * asking Amazon again. On the visibility check it was worse — an empty read
 * cached as "not found" told the publisher their book was invisible for half
 * a day. A read that carries nothing is not an answer, and it is also not
 * trusted when found in the cache, which clears entries poisoned before this.
 */

export function usableSearch(r: { items?: unknown[]; noResults?: boolean } | null | undefined): boolean {
  // Amazon's own "no results" is a real answer and worth remembering.
  return Boolean(r && ((r.items?.length ?? 0) > 0 || r.noResults));
}

export function usableDetail(d: { title?: string | null; bsr?: number | null } | null | undefined): boolean {
  // A product page read properly always yields a title; one without is a
  // shell, whatever it happened to contain.
  return Boolean(d && (d.title || d.bsr));
}

export function usableCategory(r: Record<string, unknown> | null | undefined): boolean {
  // A bestseller page read properly lists books, children to descend into, or
  // both; one with neither was a shell.
  const asins = (r?.asins as unknown[] | undefined)?.length ?? 0;
  const children = (r?.children as unknown[] | undefined)?.length ?? 0;
  return asins > 0 || children > 0;
}

export function usableList(r: { asins?: string[]; count?: number } | null | undefined): boolean {
  return Boolean(r && (r.asins?.length ?? r.count ?? 0) > 0);
}
