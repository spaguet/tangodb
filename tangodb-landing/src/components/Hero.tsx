import { ArrowRight, Sparkles } from "lucide-react";
import { CRM_LOGIN_URL } from "../config";

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
              {t("hero.title")}
            </h1>

            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">{t("hero.subtitle")}</p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={CRM_LOGIN_URL} className="btn-primary">
                {t("hero.cta")}
                <ArrowRight className="w-4 h-4" />
              </a>
              <a href="#demo" className="btn-ghost">
                {t("hero.ctaDemo")}
              </a>
            </div>
          </div>

          <div className="flex justify-center lg:justify-end animate-fade-in">
            <img
              src="/vert_girl.png"
              alt={t("hero.imageAlt")}
              className="w-full max-w-[280px] sm:max-w-xs lg:max-w-[320px] xl:max-w-sm rounded-2xl"
              width={400}
              height={600}
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
