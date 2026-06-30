import { Mail, Send } from "lucide-react";
import { CONTACTS, CRM_LOGIN_URL } from "../config";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

export function Footer({ t }: Props) {
  return (
    <footer className="border-t border-slate-200 bg-white mt-8">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-slate-900">TangoDB</p>
            <p className="mt-2 text-sm text-slate-500 max-w-xs">{t("footer.tagline")}</p>
            <a href={CRM_LOGIN_URL} className="mt-4 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-700">
              {t("nav.login")} →
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("footer.support")}</p>
            <p className="mt-3 text-sm text-slate-500 max-w-xs leading-relaxed">{t("footer.supportHint")}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("footer.contact")}</p>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href={`mailto:${CONTACTS.email}`}
                  className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 transition-colors"
                >
                  <Mail className="w-4 h-4 text-indigo-500" />
                  {CONTACTS.email}
                </a>
              </li>
              <li>
                <a
                  href={CONTACTS.telegramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 transition-colors"
                >
                  <Send className="w-4 h-4 text-indigo-500" />
                  {CONTACTS.telegramHandle}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-10 text-xs text-slate-400">
          © {new Date().getFullYear()} TangoDB. {t("footer.rights")}
        </p>
      </div>
    </footer>
  );
}
