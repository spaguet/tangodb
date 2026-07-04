import { ClipboardCheck, TrendingUp, User, Users } from "lucide-react";
import type { Locale } from "../i18n";
import { CtaBlock } from "./CtaBlock";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

const items = [
  {
    key: "features.visibility" as const,
    icon: Users,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
  },
  {
    key: "features.autoPass" as const,
    icon: ClipboardCheck,
    iconBg: "bg-sky-50",
    iconColor: "text-sky-600",
  },
  {
    key: "features.financeScreen" as const,
    icon: TrendingUp,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
  },
  {
    key: "features.separatePrivate" as const,
    icon: User,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-700",
  },
];

export function Features({ locale, t }: Props) {
  return (
    <section id="features" className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("features.title")}</h2>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {items.map(({ key, icon: Icon, iconBg, iconColor }) => (
            <li
              key={key}
              className="flex items-start gap-3 rounded-lg border border-slate-200/90 bg-white px-4 py-3.5"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <p className="pt-1.5 text-sm font-medium leading-snug text-slate-700">{t(key)}</p>
            </li>
          ))}
        </ul>

        <CtaBlock locale={locale} t={t} className="mt-10" />
      </div>
    </section>
  );
}
