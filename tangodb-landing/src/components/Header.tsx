import { Menu, X } from "lucide-react";
import { useState } from "react";
import { CRM_LOGIN_URL, CRM_REGISTER_URL } from "../config";
import type { Locale } from "../i18n";
import { LANDING_EVENTS, onLandingCtaClick } from "../lib/landingAnalytics";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { TdbLogo } from "./TdbLogo";

type Props = {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  t: (key: import("../i18n").I18nKey) => string;
};

export function Header({ locale, onLocaleChange, t }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 bg-white backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="#" className="flex items-center gap-2.5 font-semibold text-ink-900">
          <TdbLogo />
          <span>TangoDB</span>
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          <a
            href="#demo"
            className="text-sm text-ink-600 hover:text-gold-700 transition-colors"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_DEMO, locale)}
          >
            {t("nav.demo")}
          </a>
          <LocaleSwitcher locale={locale} onChange={onLocaleChange} />
          <a
            href={CRM_LOGIN_URL}
            className="text-sm text-ink-600 hover:text-gold-700 transition-colors"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_LOGIN, locale)}
          >
            {t("nav.login")}
          </a>
          <a
            href={CRM_REGISTER_URL}
            className="btn-primary text-sm py-2 px-4"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_REGISTER, locale)}
          >
            {t("cta.startFree")}
          </a>
        </nav>

        <button
          type="button"
          className="md:hidden p-2 text-ink-600 cursor-pointer"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-ink-100 px-4 py-4 space-y-3 animate-fade-in">
          <a
            href={CRM_REGISTER_URL}
            className="btn-primary w-full"
            onClick={onLandingCtaClick(LANDING_EVENTS.CTA_REGISTER, locale)}
          >
            {t("cta.startFree")}
          </a>
          <a
            href={CRM_LOGIN_URL}
            className="block text-sm text-ink-700"
            onClick={() => {
              onLandingCtaClick(LANDING_EVENTS.CTA_LOGIN, locale)();
              setOpen(false);
            }}
          >
            {t("nav.login")}
          </a>
          <a
            href="#demo"
            className="block text-sm text-ink-700"
            onClick={() => {
              onLandingCtaClick(LANDING_EVENTS.CTA_DEMO, locale)();
              setOpen(false);
            }}
          >
            {t("nav.demo")}
          </a>
          <LocaleSwitcher locale={locale} onChange={onLocaleChange} />
        </div>
      )}
    </header>
  );
}
