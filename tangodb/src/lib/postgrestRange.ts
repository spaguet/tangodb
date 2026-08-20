import type { PostgrestError } from "@supabase/supabase-js";

/** Matches PostgREST `[api] max_rows` in `supabase/config.toml`. */
export const POSTGREST_PAGE_SIZE = 1000;

type PostgrestPageResult<T> = {
  data: T[] | null;
  error: PostgrestError | null;
};

/**
 * Fetch all rows from a PostgREST list query that may exceed `max_rows`.
 * Pages with `.range(from, to)` until the last chunk is shorter than the page size.
 */
export async function fetchAllPostgrestRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PostgrestPageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + POSTGREST_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < POSTGREST_PAGE_SIZE) break;
    from += POSTGREST_PAGE_SIZE;
  }

  return rows;
}
