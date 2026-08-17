import type { Locale } from "../i18n";
import { Accordion } from "./Accordion";
import { CtaBlock } from "./CtaBlock";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

const itemKeys = [
  { id: "demo-vs-trial", q: "faq.q4" as const, a: "faq.a4" as const },
  { id: "trial", q: "faq.q5" as const, a: "faq.a5" as const },
  { id: "after-trial", q: "faq.q6" as const, a: "faq.a6" as const },
  { id: "card", q: "faq.qCard" as const, a: "faq.aCard" as const },
  { id: "lifetime", q: "faq.q7" as const, a: "faq.a7" as const },
  { id: "early-birds", q: "faq.q8" as const, a: "faq.a8" as const },
  { id: "demo", q: "faq.q9" as const, a: "faq.a9" as const },
  { id: "app", q: "faq.q1" as const, a: "faq.a1" as const },
  { id: "data", q: "faq.q2" as const, a: "faq.a2" as const },
  { id: "solo", q: "faq.q3" as const, a: "faq.a3" as const },
  { id: "support", q: "faq.q10" as const, a: "faq.a10" as const },
] as const;

export function FaqSection({ locale, t }: Props) {
  const items = itemKeys.map(({ id, q, a }) => ({
    id,
    question: t(q),
    answer: t(a),
  }));

  return (
    <section id="faq" className="bg-ink-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">{t("faq.title")}</h2>
        </div>

        <div className="mt-8 max-w-3xl">
          <Accordion items={items} />
        </div>

        <CtaBlock locale={locale} t={t} className="mt-10 max-w-3xl" />
      </div>
    </section>
  );
}
