import { Mail, Send } from "lucide-react";
import { CONTACTS } from "../config";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const NAV_LINKS = [
  { key: "footer.nav.features" as const, href: "#features" },
  { key: "footer.nav.demo" as const, href: "#demo" },
  { key: "footer.nav.crmSections" as const, href: "#crm-sections" },
  { key: "footer.nav.pricing" as const, href: "#pricing" },
  { key: "footer.nav.faq" as const, href: "#faq" },
];

export function Footer({ t }: Props) {
  return (
    <footer className="border-t border-slate-800 bg-slate-900 text-slate-300">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold text-white">TangoDB</p>
            <p className="mt-2 max-w-xs text-sm text-slate-400">{t("footer.tagline")}</p>
            <p className="mt-3 max-w-xs text-sm text-slate-400">{t("footer.byTeacher")}</p>
            <a
              href="#demo"
              className="mt-4 inline-block text-sm font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
            >
              {t("footer.ctaDemo")} →
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("footer.navigation")}
            </p>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    className="text-sm text-slate-400 transition-colors hover:text-indigo-400"
                  >
                    {t(key)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("footer.support")}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
              {t("footer.supportHint")}
            </p>
            <a
              href={CONTACTS.telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
            >
              {t("hero.ctaTelegram")} →
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {t("footer.contact")}
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href={`mailto:${CONTACTS.email}`}
                  className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-indigo-400"
                >
                  <Mail className="h-4 w-4 text-indigo-400" />
                  {CONTACTS.email}
                </a>
              </li>
              <li>
                <a
                  href={CONTACTS.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-indigo-400"
                >
                  <Send className="h-4 w-4 text-indigo-400" />
                  {CONTACTS.telegramHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-800 pt-6 text-xs text-slate-500">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>© 2026 TangoDB</span>
            <span aria-hidden="true">·</span>
            {/* TODO: replace href with real privacy policy page when available */}
            <a href="#" className="transition-colors hover:text-indigo-400">
              {t("footer.privacy")}
            </a>
            <span aria-hidden="true">·</span>
            <span>{t("footer.dataOwnership")}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
