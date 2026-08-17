import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  ClipboardCheck,
  CreditCard,
  Landmark,
  LayoutDashboard,
  Settings2,
  Tags,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import type { Locale } from "../i18n";
import { CtaBlock } from "./CtaBlock";

type Props = {
  locale: Locale;
  t: (key: import("../i18n").I18nKey) => string;
};

type CapabilityItem = {
  titleKey: import("../i18n").I18nKey;
  descKey: import("../i18n").I18nKey;
  icon: LucideIcon;
};

const capabilityItems: CapabilityItem[] = [
  { titleKey: "crmCaps.overview", descKey: "crmCaps.overviewDesc", icon: LayoutDashboard },
  { titleKey: "crmCaps.clients", descKey: "crmCaps.clientsDesc", icon: Users },
  { titleKey: "crmCaps.finance", descKey: "crmCaps.financeDesc", icon: Landmark },
  { titleKey: "crmCaps.schedule", descKey: "crmCaps.scheduleDesc", icon: Calendar },
  { titleKey: "crmCaps.team", descKey: "crmCaps.teamDesc", icon: UsersRound },
  { titleKey: "crmCaps.subscriptions", descKey: "crmCaps.subscriptionsDesc", icon: CreditCard },
  { titleKey: "crmCaps.attendance", descKey: "crmCaps.attendanceDesc", icon: ClipboardCheck },
  { titleKey: "crmCaps.personal", descKey: "crmCaps.personalDesc", icon: User },
  { titleKey: "crmCaps.prices", descKey: "crmCaps.pricesDesc", icon: Tags },
];

export function CrmCapabilities({ locale, t }: Props) {
  return (
    <section id="crm-sections" className="border-t border-slate-200/80 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-14">
        <h2 className="text-xl font-bold text-slate-900 sm:text-2xl">{t("crmCaps.title")}</h2>
        <p className="mt-2 text-sm text-slate-500">{t("crmCaps.subtitle")}</p>

        <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilityItems.map(({ titleKey, descKey, icon: Icon }) => (
            <div key={titleKey} className="flex gap-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-sm font-medium text-slate-800">{t(titleKey)}</dt>
                <dd className="text-xs text-slate-500 leading-snug">{t(descKey)}</dd>
              </div>
            </div>
          ))}
        </dl>

        <p className="mt-6 flex gap-2.5 border-t border-slate-100 pt-5 text-sm text-slate-600">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" strokeWidth={1.75} aria-hidden="true" />
          <span>
            <span className="font-medium text-slate-800">{t("crmCaps.customizeTitle")}</span>
            {" — "}
            {t("crmCaps.customizeDesc")}
          </span>
        </p>

        <CtaBlock locale={locale} t={t} className="mt-8" />
      </div>
    </section>
  );
}
