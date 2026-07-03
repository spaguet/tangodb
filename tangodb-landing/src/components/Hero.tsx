import { ArrowRight, Sparkles } from "lucide-react";
import { CONTACTS, HERO_IMAGE } from "../config";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

export function Hero({ t }: Props) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-50 via-white to-slate-50" />
      <div className="absolute top-0 right-0 -z-10 h-72 w-72 rounded-full bg-indigo-100/40 blur-3xl" />
      <div className="absolute bottom-0 left-0 -z-10 h-64 w-64 rounded-full bg-indigo-200/20 blur-3xl" />

      <div className="mx-auto max-w-6xl px-4 pt-8 pb-8 sm:px-6 sm:pt-12 sm:pb-10 lg:pt-14 lg:pb-12">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto] lg:gap-12">
          <div className="max-w-2xl animate-slide-up">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <Sparkles className="w-3.5 h-3.5" />
              {t("hero.badge")}
            </span>

            <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
              {t("hero.titleLine1")}
              <br />
              {t("hero.titleLine2")}
              <br />
              {t("hero.titleLine3")}
              <br />
              {t("hero.titleLine4")}
            </h1>

            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">{t("hero.subtitle")}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#demo" className="btn-cta">
                {t("hero.cta")}
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={CONTACTS.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                {t("hero.ctaTelegram")}
              </a>
            </div>

            <a
              href="#demo"
              className="mt-3 inline-block max-w-xl rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-1.5 text-sm leading-snug text-indigo-700 transition-colors hover:bg-indigo-50 hover:text-indigo-800"
            >
              {t("hero.demoHint")}
            </a>

            <p className="mt-3 text-sm text-slate-500 max-w-xl">{t("hero.proof")}</p>
          </div>

          <div
            className="flex w-full max-w-[260px] animate-fade-in justify-center max-h-[min(55vh,480px)] sm:max-w-[300px] sm:max-h-none lg:max-w-[360px] lg:justify-end xl:max-w-[400px]"
            style={{ aspectRatio: `${HERO_IMAGE.width} / ${HERO_IMAGE.height}` }}
          >
            <picture className="block h-full w-full">
              <source type="image/avif" srcSet={HERO_IMAGE.srcSet.avif} sizes={HERO_IMAGE.sizes} />
              <source type="image/webp" srcSet={HERO_IMAGE.srcSet.webp} sizes={HERO_IMAGE.sizes} />
              <img
                src={HERO_IMAGE.fallbackSrc}
                alt={t("hero.imageAlt")}
                className="h-full w-full rounded-2xl object-contain shadow-lg shadow-indigo-100/80"
                width={HERO_IMAGE.width}
                height={HERO_IMAGE.height}
                loading="eager"
                fetchPriority="high"
                decoding="async"
              />
            </picture>
          </div>
        </div>
      </div>
    </section>
  );
}
