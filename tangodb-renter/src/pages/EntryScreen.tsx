import { t, type Locale, type MessageKey } from "../i18n/strings";

type EntryScreenProps = {
  locale: Locale;
  phase: "loading" | "signingIn" | "error";
  errorKey: MessageKey | null;
};

export default function EntryScreen({ locale, phase, errorKey }: EntryScreenProps) {
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
            className="mx-auto h-9 w-9 rounded-full border-2 border-[var(--tg-theme-button-color,#5663d6)] border-t-transparent animate-spin"
            aria-hidden
          />
        ) : null}
        <p className="text-sm leading-relaxed">{message}</p>
      </div>
    </main>
  );
}
