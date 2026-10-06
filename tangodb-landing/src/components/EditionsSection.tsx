import { ArrowRight, Check } from "lucide-react";
import { CRM_REGISTER_URL } from "../config";
import type { Locale } from "../i18n";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

type EditionId = "lite" | "studio" | "pro";

const editions: {
  id: EditionId;
  nameKey: `editions.${EditionId}.name`;
  taglineKey: `editions.${EditionId}.tagline`;
  priceKey: `editions.${EditionId}.price`;
  featureKeys: import("../i18n").I18nKey[];
  ctaKey: `editions.${EditionId}.cta`;
  ctaHref: string;
  highlight?: boolean;
}[] = [
  {
    id: "lite",
    nameKey: "editions.lite.name",
    taglineKey: "editions.lite.tagline",
    priceKey: "editions.lite.price",
    featureKeys: [
      "editions.lite.feature.1",
      "editions.lite.feature.2",
      "editions.lite.feature.3",
      "editions.lite.feature.4",
      "editions.lite.feature.5",
      "editions.lite.feature.6",
    ],
    ctaKey: "editions.lite.cta",
    ctaHref: CRM_REGISTER_URL,
  },
  {
    id: "studio",
    nameKey: "editions.studio.name",
    taglineKey: "editions.studio.tagline",
    priceKey: "editions.studio.price",
    featureKeys: [
      "editions.studio.feature.1",
      "editions.studio.feature.2",
      "editions.studio.feature.3",
      "editions.studio.feature.4",
      "editions.studio.feature.5",
      "editions.studio.feature.6",
    ],
    ctaKey: "editions.studio.cta",
    ctaHref: "#pricing",
    highlight: true,
  },
  {
    id: "pro",
    nameKey: "editions.pro.name",
    taglineKey: "editions.pro.tagline",
    priceKey: "editions.pro.price",
    featureKeys: [
      "editions.pro.feature.1",
      "editions.pro.feature.2",
      "editions.pro.feature.3",
      "editions.pro.feature.4",
      "editions.pro.feature.5",
      "editions.pro.feature.6",
    ],
    ctaKey: "editions.pro.cta",
    ctaHref: "#pricing",
  },
];

export function EditionsSection({ locale, t }: Props) {
  return (
    <section id="editions" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("editions.title")}</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">{t("editions.subtitle")}</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {editions.map((edition) => {
            const isRegister = edition.ctaHref === CRM_REGISTER_URL;
            return (
              <article
                key={edition.id}
                className={[
                  "flex flex-col rounded-xl border p-5 sm:p-6",
                  edition.highlight
                    ? "border-indigo-300 bg-gradient-to-b from-indigo-50/80 to-white shadow-sm"
                    : "border-slate-200/90 bg-slate-50/50",
                ].join(" ")}
              >
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{t(edition.nameKey)}</h3>
                  <p className="mt-1 text-sm text-slate-600">{t(edition.taglineKey)}</p>
                  <p className="mt-3 text-sm font-semibold text-indigo-700">{t(edition.priceKey)}</p>
                </div>

                <ul className="mt-5 flex-1 space-y-2.5">
                  {edition.featureKeys.map((featureKey) => (
                    <li key={featureKey} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
                      <span>{t(featureKey)}</span>
                    </li>
                  ))}
                </ul>

                <a
                  href={edition.ctaHref}
                  className={isRegister ? "btn-cta mt-6 w-full justify-center" : "btn-ghost mt-6 w-full justify-center"}
                  onClick={
                    isRegister
                      ? onLandingCtaClick(LANDING_EVENTS.CTA_REGISTER, locale)
                      : undefined
                  }
                >
                  {t(edition.ctaKey)}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </article>
            );
          })}
        </div>

        <p className="mt-8 max-w-3xl text-sm text-slate-500 leading-relaxed">{t("editions.footnote")}</p>
      </div>
    </section>
  );
}
