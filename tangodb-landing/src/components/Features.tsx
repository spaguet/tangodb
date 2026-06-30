import {
  Calendar,
  ClipboardCheck,
  CreditCard,
  TrendingUp,
  User,
  Users,
} from "lucide-react";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const items = [
  { key: "features.clients" as const, icon: Users },
  { key: "features.schedule" as const, icon: Calendar },
  { key: "features.subscriptions" as const, icon: CreditCard },
  { key: "features.attendance" as const, icon: ClipboardCheck },
  { key: "features.finance" as const, icon: TrendingUp },
  { key: "features.personal" as const, icon: User },
];

export function Features({ t }: Props) {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8">
      <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("features.title")}</h2>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ key, icon: Icon }) => (
          <div
            key={key}
            className="demo-card p-5 transition-shadow hover:shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon className="w-5 h-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-700 leading-snug">{t(key)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
