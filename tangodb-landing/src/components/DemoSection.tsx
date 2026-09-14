import type { Locale } from "../i18n";
import { CrmDemoApp } from "../crm/CrmDemoApp";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

export function DemoSection({ locale, t }: Props) {
  return (
    <section id="demo" className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("demo.title")}</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">{t("demo.subtitle")}</p>
        </div>

        <div className="mt-8">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <p className="text-sm font-medium text-indigo-700">{t("demo.actionHint")}</p>
            <p className="text-xs leading-snug text-slate-500 sm:max-w-sm sm:text-right">{t("demo.disclaimer")}</p>
          </div>
          <CrmDemoApp locale={locale} />
        </div>
      </div>
    </section>
  );
}
