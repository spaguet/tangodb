import { ArrowRight } from "lucide-react";
import { CONTACTS } from "../config";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const tiers = [
  { titleKey: "modularity.solo.title" as const, descKey: "pricing.solo.desc" as const },
  { titleKey: "modularity.studio.title" as const, descKey: "pricing.studio.desc" as const },
  { titleKey: "modularity.network.title" as const, descKey: "pricing.network.desc" as const },
];

export function PricingSection({ t }: Props) {
  return (
    <section id="pricing" className="bg-gradient-to-b from-white via-indigo-50/30 to-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("pricing.title")}</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">{t("pricing.subtitle")}</p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map(({ titleKey, descKey }) => (
            <article key={titleKey} className="demo-card p-5 sm:p-6">
              <h3 className="text-base font-semibold text-slate-900">{t(titleKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{t(descKey)}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start gap-3">
          <a
            href={CONTACTS.telegramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-cta"
          >
            {t("pricing.cta")}
            <ArrowRight className="h-4 w-4" />
          </a>
          <p className="text-sm text-slate-500">{t("pricing.note")}</p>
        </div>
      </div>
    </section>
  );
}
