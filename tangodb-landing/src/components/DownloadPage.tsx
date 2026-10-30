import { ArrowLeft, Download, ShieldCheck, Smartphone } from "lucide-react";
import type { Locale } from "../i18n";
import { CONTACTS, CRM_APK_DOWNLOAD, PRIVACY_PATH, SITE_URL } from "../config";
import { Footer } from "./Footer";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { TdbLogo } from "./TdbLogo";

type Props = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: (key: import("../i18n").I18nKey) => string;
};

function formatBytes(bytes: number | null, locale: Locale): string {
  if (bytes == null || bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return locale === "ru" ? `${mb.toFixed(1)} МБ` : `${mb.toFixed(1)} MB`;
}

export function DownloadPage({ locale, onLocaleChange, t }: Props) {
  const sha = CRM_APK_DOWNLOAD.sha256 || "—";

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 font-semibold text-slate-900">
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
            className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("download.backLink")}
          </a>

          <div className="mt-6 flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
              <Smartphone className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t("download.title")}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{t("download.subtitle")}</p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {t("download.meta.label")}
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">{t("download.meta.version")}</dt>
                <dd className="font-semibold text-slate-900">{CRM_APK_DOWNLOAD.version}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("download.meta.date")}</dt>
                <dd className="font-semibold text-slate-900">{CRM_APK_DOWNLOAD.date}</dd>
              </div>
              <div>
                <dt className="text-slate-500">{t("download.meta.size")}</dt>
                <dd className="font-semibold text-slate-900">{formatBytes(CRM_APK_DOWNLOAD.sizeBytes, locale)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">{t("download.meta.sha256")}</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-800">{sha}</dd>
              </div>
            </dl>

            <a
              href={CRM_APK_DOWNLOAD.url}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-indigo-700 sm:w-auto"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("download.cta")}
            </a>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{t("download.ctaHint")}</p>
          </div>

          <section className="mt-10 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">{t("download.requirements.title")}</h2>
            <p className="text-sm leading-relaxed text-slate-600">{t("download.requirements.body")}</p>
          </section>

          <section className="mt-8 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">{t("download.steps.title")}</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-600">
              <li>{t("download.steps.1")}</li>
              <li>{t("download.steps.2")}</li>
              <li>{t("download.steps.3")}</li>
              <li>{t("download.steps.4")}</li>
            </ol>
          </section>

          <section className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            <div className="flex gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
              <p className="leading-relaxed">{t("download.sharedPhone")}</p>
            </div>
          </section>

          <section className="mt-8 space-y-2 text-sm text-slate-600">
            <p>{t("download.updates")}</p>
            <p>
              <a href={PRIVACY_PATH} className="font-medium text-indigo-600 hover:text-indigo-700">
                {t("download.privacyLink")}
              </a>
            </p>
            <p>
              {t("download.support")}{" "}
              <a href={`mailto:${CONTACTS.email}`} className="font-medium text-indigo-600 hover:text-indigo-700">
                {CONTACTS.email}
              </a>
            </p>
            <p className="text-xs text-slate-400">{SITE_URL}</p>
          </section>
        </article>
      </main>

      <Footer locale={locale} t={t} />
    </div>
  );
}
