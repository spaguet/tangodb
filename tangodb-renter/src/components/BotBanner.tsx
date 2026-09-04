import { t, type Locale } from "../i18n/strings";

type BotBannerProps = {
  locale: Locale;
  botStarted: boolean;
  allowsWrite: boolean;
  botUrl: string | null;
};

export default function BotBanner({
  locale,
  botStarted,
  allowsWrite,
  botUrl,
}: BotBannerProps) {
  if (botStarted && allowsWrite) return null;

  const blocked = botStarted && !allowsWrite;

  return (
    <div
      className={
        blocked
          ? "mx-4 mt-3 shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900"
          : "mx-4 mt-3 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900"
      }
      role="status"
    >
      <p>{t(locale, blocked ? "botBlockedBanner" : "botBanner")}</p>
      {!blocked && botUrl ? (
        <a
          href={botUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          {t(locale, "botOpenCta")}
        </a>
      ) : null}
      {blocked && botUrl ? (
        <a
          href={botUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
        >
          {t(locale, "botUnblockCta")}
        </a>
      ) : null}
    </div>
  );
}
