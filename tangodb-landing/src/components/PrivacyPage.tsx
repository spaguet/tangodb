import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { CONTACTS } from "../config";
import type { Locale } from "../i18n";
import { Footer } from "./Footer";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { TdbLogo } from "./TdbLogo";

type Props = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: (key: import("../i18n").I18nKey) => string;
};

const ANALYTICS_EVENT_KEYS = [
  "privacy.analytics.eventPageview",
  "privacy.analytics.eventRegister",
  "privacy.analytics.eventDemo",
  "privacy.analytics.eventTelegram",
  "privacy.analytics.eventLogin",
  "privacy.analytics.eventScrollPricing",
  "privacy.analytics.eventScrollFaq",
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">{children}</div>
    </section>
  );
}

export function PrivacyPage({ locale, onLocaleChange, t }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="border-b border-ink-200 bg-white backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold text-ink-900">
            <TdbLogo />
            <span>TangoDB</span>
          </a>
          <LocaleSwitcher locale={locale} onChange={onLocaleChange} />
        </div>
      </header>

      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gold-700 transition-colors hover:text-gold-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("privacy.backLink")}
          </a>

          <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
            {t("privacy.title")}
          </h1>
          <p className="mt-2 text-sm text-ink-500">{t("privacy.updated")}</p>

          <Section title={t("privacy.intro.title")}>
            <p>{t("privacy.intro.text")}</p>
          </Section>

          <Section title={t("privacy.landingData.title")}>
            <p>{t("privacy.landingData.text")}</p>
          </Section>

          <Section title={t("privacy.analytics.title")}>
            <p>{t("privacy.analytics.text")}</p>
            <ul className="list-disc space-y-1 pl-5">
              {ANALYTICS_EVENT_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
            <p>{t("privacy.analytics.noPii")}</p>
          </Section>

          <Section title={t("privacy.storage.title")}>
            <p>{t("privacy.storage.text")}</p>
          </Section>

          <Section title={t("privacy.crm.title")}>
            <p>{t("privacy.crm.text")}</p>
          </Section>

          <Section title={t("privacy.contact.title")}>
            <p>
              {t("privacy.contact.text")}{" "}
              <a
                href={`mailto:${CONTACTS.email}`}
                className="font-medium text-gold-700 hover:text-gold-700"
              >
                {CONTACTS.email}
              </a>
              .
            </p>
          </Section>
        </article>
      </main>

      <Footer locale={locale} t={t} />
    </div>
  );
}
