const MAX_SEARCH_LEN = 100;

/** Strip PostgREST ilike metacharacters and `.or()` filter-syntax breakers from user input. */
export function sanitizePostgrestSearchTerm(raw: string): string {
  return raw
    .trim()
    .slice(0, MAX_SEARCH_LEN)
    .replace(/[%_\\,().]/g, "");
}

/** Build a PostgREST `.or()` ilike filter; returns null when nothing searchable remains. */
export function buildIlikeOrFilter(columns: string[], term: string): string | null {
  const safe = sanitizePostgrestSearchTerm(term);
  if (!safe) return null;
  return columns.map((col) => `${col}.ilike.%${safe}%`).join(",");
}
