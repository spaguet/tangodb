type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const tiers = [
  { titleKey: "modularity.solo.title" as const, descKey: "audience.solo.desc" as const },
  { titleKey: "modularity.studio.title" as const, descKey: "audience.studio.desc" as const },
  { titleKey: "modularity.network.title" as const, descKey: "audience.network.desc" as const },
];

export function AudienceSection({ t }: Props) {
  return (
    <section id="audience" className="border-y border-ink-100 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <h2 className="text-xl font-bold text-ink-900 sm:text-2xl">{t("audience.title")}</h2>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {tiers.map(({ titleKey, descKey }) => (
            <article key={titleKey} className="rounded-xl border border-ink-200 bg-ink-50/10 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-ink-900">{t(titleKey)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{t(descKey)}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
