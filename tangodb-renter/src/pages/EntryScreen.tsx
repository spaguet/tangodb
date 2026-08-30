import type { BootstrapData } from "../lib/auth";
import { t, type Locale, type MessageKey } from "../i18n/strings";

type EntryScreenProps = {
  locale: Locale;
  phase: "loading" | "signingIn" | "ready" | "error";
  bootstrap: BootstrapData | null;
  errorKey: MessageKey | null;
};

export default function EntryScreen({
  locale,
  phase,
  bootstrap,
  errorKey,
}: EntryScreenProps) {
  if (phase === "ready" && bootstrap) {
    return (
      <main className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-10 bg-[var(--tg-theme-bg-color,#0f172a)] text-[var(--tg-theme-text-color,#f8fafc)]">
        <div className="w-full max-w-sm text-center space-y-3">
          <p className="text-sm uppercase tracking-wide opacity-70">{t(locale, "studioSubtitle")}</p>
          <h1 className="text-2xl font-semibold leading-tight">{bootstrap.studioName}</h1>
          <p className="text-sm opacity-80">{t(locale, "studioWelcome")}</p>
        </div>
      </main>
    );
  }

  const message = errorKey
    ? t(locale, errorKey)
    : phase === "signingIn"
      ? t(locale, "signingIn")
      : t(locale, "loading");

  return (
    <main className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-10 bg-[var(--tg-theme-bg-color,#0f172a)] text-[var(--tg-theme-text-color,#f8fafc)]">
      <div className="w-full max-w-sm text-center space-y-4">
        {phase === "loading" || phase === "signingIn" ? (
          <div
            className="mx-auto h-9 w-9 rounded-full border-2 border-[var(--tg-theme-button-color,#38bdf8)] border-t-transparent animate-spin"
            aria-hidden
          />
        ) : null}
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
    </main>
  );
}
