import { Accordion } from "./Accordion";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const itemKeys = [
  { id: "app", q: "faq.q1" as const, a: "faq.a1" as const },
  { id: "data", q: "faq.q2" as const, a: "faq.a2" as const },
  { id: "solo", q: "faq.q3" as const, a: "faq.a3" as const },
  { id: "trial", q: "faq.q4" as const, a: "faq.a4" as const },
  { id: "support", q: "faq.q5" as const, a: "faq.a5" as const },
] as const;

export function FaqSection({ t }: Props) {
  const items = itemKeys.map(({ id, q, a }) => ({
    id,
    question: t(q),
    answer: t(a),
  }));

  return (
    <section id="faq" className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("faq.title")}</h2>
        </div>

        <div className="mt-8 max-w-3xl">
          <Accordion items={items} />
        </div>
      </div>
    </section>
  );
}
