import type { Locale } from "../i18n";
import { CrmDemoApp } from "../crm/CrmDemoApp";
import { CrmCapabilities } from "./CrmCapabilities";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

export function DemoSection({ locale, t }: Props) {
  return (
    <section id="demo" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("demo.title")}</h2>
        <p className="mt-3 text-slate-600">{t("demo.subtitle")}</p>
      </div>

      <div className="mt-8">
        <CrmDemoApp locale={locale} />
      </div>

      <CrmCapabilities t={t} />
    </section>
  );
}
