import { ArrowRight, Check, Minus } from "lucide-react";
import { demoDeepLinkHref } from "../lib/demoDeepLink";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

type ModuleKey =
  | "modularity.modules.clients"
  | "modularity.modules.schedule"
  | "modularity.modules.passes"
  | "modularity.modules.finance"
  | "modularity.modules.private"
  | "modularity.modules.team";

type TierKey = "modularity.solo.title" | "modularity.studio.title" | "modularity.network.title";

const tiers: { titleKey: TierKey; modules: Record<ModuleKey, boolean> }[] = [
  {
    titleKey: "modularity.solo.title",
    modules: {
      "modularity.modules.clients": true,
      "modularity.modules.schedule": true,
      "modularity.modules.passes": false,
      "modularity.modules.finance": true,
      "modularity.modules.private": true,
      "modularity.modules.team": false,
    },
  },
  {
    titleKey: "modularity.studio.title",
    modules: {
      "modularity.modules.clients": true,
      "modularity.modules.schedule": true,
      "modularity.modules.passes": true,
      "modularity.modules.finance": true,
      "modularity.modules.private": true,
      "modularity.modules.team": true,
    },
  },
  {
    titleKey: "modularity.network.title",
    modules: {
      "modularity.modules.clients": true,
      "modularity.modules.schedule": true,
      "modularity.modules.passes": true,
      "modularity.modules.finance": true,
      "modularity.modules.private": false,
      "modularity.modules.team": true,
    },
  },
];

const moduleKeys = Object.keys(tiers[0].modules) as ModuleKey[];

export function ModularitySection({ t }: Props) {
  return (
    <section id="modularity" className="bg-ink-900 text-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("modularity.title")}</h2>
          <p className="mt-4 text-base leading-relaxed text-ink-300">{t("modularity.subtitle")}</p>
        </div>

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {tiers.map(({ titleKey, modules }) => (
            <article
              key={titleKey}
              className="rounded-xl border border-ink-700/70 bg-ink-800/70 p-5 sm:p-6"
            >
              <h3 className="text-lg font-semibold text-white">{t(titleKey)}</h3>
              <ul className="mt-5 space-y-2.5">
                {moduleKeys.map((moduleKey) => {
                  const enabled = modules[moduleKey];
                  return (
                    <li key={moduleKey} className="flex items-start gap-2.5 text-sm">
                      <span
                        className={[
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                          enabled ? "bg-gold-500/10 text-gold-300" : "bg-ink-700/70 text-ink-500",
                        ].join(" ")}
                        aria-hidden
                      >
                        {enabled ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Minus className="h-3 w-3" />}
                      </span>
                      <span className={enabled ? "text-ink-200" : "text-ink-500"}>{t(moduleKey)}</span>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={demoDeepLinkHref({ panel: "settings", settingsSection: "organization" })}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-100"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_DEMO)}
          >
            {t("modularity.cta.settings")}
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href={demoDeepLinkHref({ panel: "team" })}
            className="inline-flex items-center gap-2 rounded-xl border border-ink-600 px-5 py-2.5 text-sm font-semibold text-ink-200 transition-colors hover:border-ink-500 hover:bg-ink-800"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_DEMO)}
          >
            {t("modularity.cta.team")}
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
