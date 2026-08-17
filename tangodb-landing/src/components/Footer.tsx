import { ArrowRight, Mail, Send } from "lucide-react";
import { CONTACTS, CRM_REGISTER_URL, PRIVACY_PATH, getTelegramSetupUrl } from "../config";
import type { Locale } from "../i18n";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

const NAV_LINKS = [
  { key: "footer.nav.features" as const, href: "#features" },
  { key: "footer.nav.audience" as const, href: "#audience" },
  { key: "footer.nav.pricing" as const, href: "#pricing" },
  { key: "footer.nav.demo" as const, href: "#demo" },
  { key: "footer.nav.crmSections" as const, href: "#crm-sections" },
  { key: "footer.nav.faq" as const, href: "#faq" },
];

export function Footer({ locale, t }: Props) {
  return (
    <footer className="border-t border-ink-800 bg-ink-900 text-ink-300">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold text-white">TangoDB</p>
            <p className="mt-2 max-w-xs text-sm text-ink-500">{t("footer.tagline")}</p>
            <p className="mt-3 max-w-xs text-sm text-ink-500">{t("footer.byTeacher")}</p>
            <a
              href={CRM_REGISTER_URL}
              className="btn-cta mt-5 text-sm"
              onClick={onLandingCtaClick(LANDING_EVENTS.CTA_REGISTER, locale)}
            >
              {t("cta.startFree")}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {t("footer.navigation")}
            </p>
            <ul className="mt-3 space-y-2">
              {NAV_LINKS.map(({ key, href }) => (
                <li key={key}>
                  <a
                    href={href}
                    className="text-sm text-ink-500 transition-colors hover:text-gold-400"
                    {...(href === "#demo"
                      ? { onClick: onLandingCtaClick(LANDING_EVENTS.CTA_DEMO, locale) }
                      : {})}
                  >
                    {t(key)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {t("footer.support")}
            </p>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-400">
              {t("footer.supportHint")}
            </p>
            <a
              href={getTelegramSetupUrl(locale)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm font-semibold text-gold-400 transition-colors hover:text-gold-300"
              onClick={onLandingCtaClick(LANDING_EVENTS.CTA_TELEGRAM, locale)}
            >
              {t("cta.getInstructions")} →
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">
              {t("footer.contact")}
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href={`mailto:${CONTACTS.email}`}
                  className="inline-flex items-center gap-2 text-sm text-ink-500 transition-colors hover:text-gold-400"
                >
                  <Mail className="h-4 w-4 text-gold-400" />
                  {CONTACTS.email}
                </a>
              </li>
              <li>
                <a
                  href={CONTACTS.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-ink-500 transition-colors hover:text-gold-400"
                  onClick={onLandingCtaClick(LANDING_EVENTS.CTA_TELEGRAM, locale)}
                >
                  <Send className="h-4 w-4 text-gold-400" />
                  {CONTACTS.telegramHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-ink-800 pt-6 text-xs text-ink-500">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>© 2026 TangoDB</span>
            <span aria-hidden="true">·</span>
            {/* Privacy policy page */}
            <a href={PRIVACY_PATH} className="transition-colors hover:text-gold-400">
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
