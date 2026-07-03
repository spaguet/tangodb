import { CONTACTS } from "../config";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const items = [
  { titleKey: "trust.teacher.title" as const, textKey: "trust.teacher.text" as const },
  {
    titleKey: "trust.demo.title" as const,
    textKey: "trust.demo.text" as const,
    href: "#demo",
  },
  {
    titleKey: "trust.support.title" as const,
    textKey: "trust.support.text" as const,
    href: CONTACTS.telegramUrl,
    external: true,
  },
];

export function TrustSection({ t }: Props) {
  return (
    <section className="border-y border-slate-100 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="grid gap-8 md:grid-cols-3 md:gap-0">
          {items.map(({ titleKey, textKey, href, external }, index) => {
            const title = t(titleKey);
            const titleEl = href ? (
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="text-sm font-semibold text-slate-900 transition-colors hover:text-indigo-600"
              >
                {title}
              </a>
            ) : (
              <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            );

            return (
              <div
                key={titleKey}
                className={[
                  index > 0 ? "border-t border-slate-100 pt-8 md:border-t-0 md:border-l md:pt-0" : "",
                  index > 0 ? "md:pl-8" : "",
                  index < items.length - 1 ? "md:pr-8" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {titleEl}
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t(textKey)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
