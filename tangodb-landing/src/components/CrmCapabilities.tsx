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

type Props = {
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

function CapabilityIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex h-11 w-[52px] shrink-0 items-center justify-center rounded-md border border-slate-200 bg-indigo-50/80">
      <Icon className="h-4 w-4 text-indigo-600" strokeWidth={1.75} aria-hidden="true" />
    </div>
  );
}

export function CrmCapabilities({ t }: Props) {
  return (
    <section id="crm-sections" className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("crmCaps.title")}</h2>
          <p className="mt-3 text-slate-600 leading-relaxed">{t("crmCaps.subtitle")}</p>
        </div>

        <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="grid sm:grid-cols-2 sm:gap-px sm:bg-slate-100">
            {capabilityItems.map(({ titleKey, descKey, icon }) => (
              <div key={titleKey} className="flex gap-3 bg-white px-3 py-3 sm:px-4">
                <CapabilityIcon icon={icon} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{t(titleKey)}</p>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{t(descKey)}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 border-t border-slate-100 bg-slate-50/80 px-3 py-3 sm:px-4">
            <CapabilityIcon icon={Settings2} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">{t("crmCaps.customizeTitle")}</p>
              <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">{t("crmCaps.customizeDesc")}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
