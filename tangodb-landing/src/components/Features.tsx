import { ClipboardCheck, TrendingUp, User, Users } from "lucide-react";

type Props = {
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
    key: "features.financeScreen" as const,
    icon: TrendingUp,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
  },
  {
    key: "features.autoPass" as const,
    icon: ClipboardCheck,
    iconBg: "bg-sky-50",
    iconColor: "text-sky-600",
  },
  {
    key: "features.separatePrivate" as const,
    icon: User,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-700",
  },
];

export function Features({ t }: Props) {
  return (
    <section id="features" className="bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("features.title")}</h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {items.map(({ key, icon: Icon, iconBg, iconColor }) => (
            <div
              key={key}
              className="demo-card p-5 transition-shadow hover:shadow-sm"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}>
                <Icon className="w-5 h-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700 leading-snug">{t(key)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
