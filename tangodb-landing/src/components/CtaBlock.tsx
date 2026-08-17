import { ArrowRight } from "lucide-react";
import { CRM_REGISTER_URL, getTelegramSetupUrl } from "../config";
import type { Locale } from "../i18n";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
  variant?: "default" | "compact";
  showHint?: boolean;
  className?: string;
};

export function CtaBlock({
  locale,
  t,
  variant = "default",
  showHint = false,
  className = "",
}: Props) {
  const btnClass = variant === "compact" ? "btn-cta text-xs sm:text-sm" : "btn-cta";
  const ghostClass = variant === "compact" ? "btn-ghost text-xs sm:text-sm" : "btn-ghost";

  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <a href={CRM_REGISTER_URL} className={btnClass} onClick={onLandingCtaClick(LANDING_EVENTS.CTA_REGISTER, locale)}>
          {t("cta.startFree")}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
        <a
          href={getTelegramSetupUrl(locale)}
          target="_blank"
          rel="noopener noreferrer"
          className={ghostClass}
          onClick={onLandingCtaClick(LANDING_EVENTS.CTA_TELEGRAM, locale)}
        >
          {t("cta.getInstructions")}
        </a>
      </div>
      {showHint && <p className="mt-3 text-sm text-ink-500">{t("cta.startFreeHint")}</p>}
    </div>
  );
}
