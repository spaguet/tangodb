export interface ErrorContext {
  area: string;
  action?: string;
  meta?: Record<string, unknown>;
}

export function reportClientError(error: unknown, context: ErrorContext): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (import.meta.env.DEV) {
    console.error("[TangoDB]", context.area, context.action, normalized, context.meta);
  }
  // v2: Sentry.captureException(normalized, { extra: context });
}
