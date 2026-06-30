import { Menu, X } from "lucide-react";
import { useState } from "react";
import { CRM_LOGIN_URL } from "../config";
import type { Locale } from "../i18n";
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
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <a href="#" className="flex items-center gap-2.5 font-semibold text-slate-900">
          <TdbLogo />
          <span>TangoDB</span>
        </a>

        <nav className="hidden items-center gap-6 md:flex">
          <a href="#demo" className="text-sm text-slate-600 hover:text-indigo-600 transition-colors">
            {t("nav.demo")}
          </a>
          <LocaleSwitcher locale={locale} onChange={onLocaleChange} />
          <a href={CRM_LOGIN_URL} className="btn-primary text-sm py-2 px-4">
            {t("nav.login")}
          </a>
        </nav>

        <button
          type="button"
          className="md:hidden p-2 text-slate-600 cursor-pointer"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-slate-100 px-4 py-4 space-y-3 animate-fade-in">
          <a href="#demo" className="block text-sm text-slate-700" onClick={() => setOpen(false)}>
            {t("nav.demo")}
          </a>
          <LocaleSwitcher locale={locale} onChange={onLocaleChange} />
          <a href={CRM_LOGIN_URL} className="btn-primary w-full">
            {t("nav.login")}
          </a>
        </div>
      )}
    </header>
  );
}
