import {
  Calendar,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  SlidersHorizontal,
  Tags,
  TrendingUp,
  User,
  UserCog,
  Users,
} from "lucide-react";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const items = [
  { titleKey: "crmCaps.overview" as const, descKey: "crmCaps.overviewDesc" as const, icon: LayoutDashboard },
  { titleKey: "crmCaps.clients" as const, descKey: "crmCaps.clientsDesc" as const, icon: Users },
  { titleKey: "crmCaps.subscriptions" as const, descKey: "crmCaps.subscriptionsDesc" as const, icon: CreditCard },
  { titleKey: "crmCaps.schedule" as const, descKey: "crmCaps.scheduleDesc" as const, icon: Calendar },
  { titleKey: "crmCaps.attendance" as const, descKey: "crmCaps.attendanceDesc" as const, icon: ClipboardCheck },
  { titleKey: "crmCaps.personal" as const, descKey: "crmCaps.personalDesc" as const, icon: User },
  { titleKey: "crmCaps.finance" as const, descKey: "crmCaps.financeDesc" as const, icon: TrendingUp },
  { titleKey: "crmCaps.prices" as const, descKey: "crmCaps.pricesDesc" as const, icon: Tags },
  { titleKey: "crmCaps.team" as const, descKey: "crmCaps.teamDesc" as const, icon: UserCog },
];

export function CrmCapabilities({ t }: Props) {
  return (
    <div className="mt-12 border-t border-slate-200/80 pt-12">
      <h3 className="text-xl font-bold text-slate-900 sm:text-2xl">{t("crmCaps.title")}</h3>
      <p className="mt-3 max-w-2xl text-slate-600 leading-relaxed">{t("crmCaps.subtitle")}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ titleKey, descKey, icon: Icon }) => (
          <div key={titleKey} className="demo-card p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon className="w-5 h-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-800">{t(titleKey)}</p>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">{t(descKey)}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 demo-card p-5 border-indigo-100 bg-indigo-50/40">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 border border-indigo-100">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{t("crmCaps.customizeTitle")}</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{t("crmCaps.customizeDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
