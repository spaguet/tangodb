import type { QueryClient, QueryFilters } from "@tanstack/react-query";

/**
 * TanStack Query partial keys match left-to-right. `withOrgId([base, …filters])` appends
 * org id as the **last** segment, so `withOrgId(base)` does not match filtered queries.
 * Use this filter for cancel / getQueriesData / setQueriesData / invalidate within one org.
 */
export function orgScopedQueryFilter(
  baseKey: readonly unknown[],
  organizationId: string | null | undefined
): QueryFilters {
  return {
    queryKey: baseKey,
    predicate: (query) =>
      organizationId != null &&
      query.queryKey.length > baseKey.length &&
      baseKey.every((segment, index) => query.queryKey[index] === segment) &&
      query.queryKey[query.queryKey.length - 1] === organizationId,
  };
}

export function invalidateOrgScopedQueries(
  queryClient: QueryClient,
  baseKey: readonly unknown[],
  organizationId: string | null | undefined,
  options?: Omit<QueryFilters, "queryKey" | "predicate">
) {
  void queryClient.invalidateQueries({ ...orgScopedQueryFilter(baseKey, organizationId), ...options });
}
