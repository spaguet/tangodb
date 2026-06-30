import { Headphones, Monitor, Smartphone } from "lucide-react";

type Props = {
  t: (key: import("../i18n").I18nKey) => string;
};

const devices = [
  { key: "platform.desktop" as const, icon: Monitor },
  { key: "platform.mobile" as const, icon: Smartphone },
];

export function PlatformSection({ t }: Props) {
  return (
    <section id="platform" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">{t("platform.title")}</h2>
      <p className="mt-3 max-w-2xl text-slate-600 leading-relaxed">{t("platform.subtitle")}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {devices.map(({ key, icon: Icon }) => (
          <div key={key} className="demo-card p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Icon className="w-5 h-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-800">{t(key)}</p>
            <p className="mt-1.5 text-sm text-slate-500 leading-relaxed">
              {t(key === "platform.desktop" ? "platform.desktopDesc" : "platform.mobileDesc")}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 demo-card p-5 border-indigo-100 bg-indigo-50/40">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 border border-indigo-100">
            <Headphones className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{t("platform.supportTitle")}</p>
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{t("platform.supportDesc")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
