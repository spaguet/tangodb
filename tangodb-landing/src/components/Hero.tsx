import { BadgePercent } from "lucide-react";
import type { Locale } from "../i18n";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";
import { CtaBlock } from "./CtaBlock";
import { CrmDesktopPreview } from "./CrmDesktopPreview";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

export function Hero({ locale, t }: Props) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-white to-slate-50" />
      <div className="absolute top-0 right-0 -z-10 h-72 w-72 rounded-full bg-indigo-100/40 blur-3xl" />
      <div className="absolute bottom-0 left-0 -z-10 h-64 w-64 rounded-full bg-indigo-200/20 blur-3xl" />

      <div className="mx-auto max-w-6xl px-4 pt-8 pb-10 sm:px-6 sm:pt-12 sm:pb-12 lg:pt-14 lg:pb-14">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_32rem]">
          <div className="max-w-2xl animate-slide-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <BadgePercent className="w-3.5 h-3.5" aria-hidden="true" />
              {t("hero.badge")}
            </span>

            <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
              {t("hero.title")}
            </h1>

            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">{t("hero.subtitle")}</p>

            <CtaBlock locale={locale} t={t} className="mt-8" />

            <a
              href="#demo"
              className="mt-4 inline-block text-sm font-medium text-indigo-700 underline-offset-4 transition-colors hover:text-indigo-800 hover:underline"
              onClick={onLandingCtaClick(LANDING_EVENTS.CTA_DEMO, locale)}
            >
              {t("hero.demoHint")}
            </a>
          </div>

          <div className="w-full max-w-xl animate-fade-in mx-auto lg:mx-0 lg:max-w-none">
            <CrmDesktopPreview locale={locale} alt={t("hero.imageAlt")} />
          </div>
        </div>
      </div>
    </section>
  );
}
