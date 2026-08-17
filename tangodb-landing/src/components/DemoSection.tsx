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
          <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">{t("demo.title")}</h2>
          <p className="mt-3 text-ink-600 leading-relaxed">{t("demo.subtitle")}</p>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-sm font-medium text-gold-700">{t("demo.actionHint")}</p>
          <CrmDemoApp locale={locale} />
        </div>
      </div>
    </section>
  );
}
