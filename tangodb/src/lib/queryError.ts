/** Normalize React Query / Supabase errors for UI (PostgrestError is a plain object, not Error). */
export function toQueryError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  if (typeof error === "string" && error.trim()) return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
}

export function queryErrorFromState(query: {
  error: unknown | null;
  isError: boolean;
}): Error | null {
  if (!query.isError || query.error == null) return null;
  return toQueryError(query.error);
}
