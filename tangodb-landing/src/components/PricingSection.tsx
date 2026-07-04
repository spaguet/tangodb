import { BadgePercent } from "lucide-react";
import type { Locale } from "../i18n";
import { CtaBlock } from "./CtaBlock";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

const steps = [
  "pricing.step.register" as const,
  "pricing.step.email" as const,
  "pricing.step.trial" as const,
  "pricing.step.decide" as const,
];

export function PricingSection({ locale, t }: Props) {
  return (
    <section id="pricing" className="bg-gradient-to-b from-white via-indigo-50/30 to-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("pricing.title")}</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">{t("pricing.subtitle")}</p>
        </div>

        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((key, index) => (
            <li key={key} className="demo-card flex gap-3 p-4 sm:p-5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-slate-700">{t(key)}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <article className="demo-card p-5 sm:p-6">
            <h3 className="text-base font-semibold text-slate-900">{t("pricing.earlyBird.title")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("pricing.earlyBird.text")}</p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
              <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
              {t("hero.badge")}
            </p>
          </article>

          <article className="demo-card p-5 sm:p-6">
            <h3 className="text-base font-semibold text-slate-900">{t("pricing.afterTrial.title")}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("pricing.afterTrial.text")}</p>
          </article>
        </div>

        <div className="mt-10 flex flex-col items-start gap-3">
          <CtaBlock locale={locale} t={t} />
        </div>
      </div>
    </section>
  );
}
