import { t, type Locale } from "../i18n/strings";

type BotBannerProps = {
  locale: Locale;
  botStarted: boolean;
};

export default function BotBanner({ locale, botStarted }: BotBannerProps) {
  if (botStarted) return null;

  return (
    <div
      className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200"
      role="status"
    >
      {t(locale, "botBanner")}
    </div>
  );
}
