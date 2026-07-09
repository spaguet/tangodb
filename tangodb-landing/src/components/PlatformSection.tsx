import { ArrowRight, MessageCircle } from "lucide-react";
import type { Locale } from "../i18n";
import { getTelegramSetupUrl } from "../config";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";
import { CrmDesktopPreview } from "./CrmDesktopPreview";
import { CrmMobilePreview } from "./CrmMobilePreview";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

export function PlatformSection({ locale, t }: Props) {
  return (
    <section id="platform" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("platform.title")}</h2>
        <p className="mt-3 max-w-2xl text-slate-600 leading-relaxed">{t("platform.subtitle")}</p>

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-2 lg:gap-10">
          <div className="space-y-3">
            <CrmDesktopPreview locale={locale} alt={t("platform.desktopPreviewAlt")} />
            <div>
              <p className="text-sm font-semibold text-slate-800">{t("platform.desktop")}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{t("platform.desktopDesc")}</p>
            </div>
          </div>

          <div className="space-y-3">
            <CrmMobilePreview locale={locale} alt={t("platform.mobilePreviewAlt")} />
            <div>
              <p className="text-sm font-semibold text-slate-800">{t("platform.mobile")}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{t("platform.mobileDesc")}</p>
            </div>
          </div>
        </div>

        <div className="mt-10 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-indigo-50/60 p-6 sm:p-8">
          <div className="max-w-2xl">
            <p className="text-lg font-semibold text-slate-900">{t("platform.supportTitle")}</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("platform.supportDesc")}</p>
            <a
              href={getTelegramSetupUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-xl border border-indigo-200/80 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
              onClick={onLandingCtaClick(LANDING_EVENTS.CTA_TELEGRAM, locale)}
            >
              <MessageCircle className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              {t("cta.getInstructions")}
              <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </a>
            <p className="mt-3 text-xs text-indigo-700/70">{t("platform.supportHint")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
