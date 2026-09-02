import { t, type Locale } from "../i18n/strings";

export type CabinetTab = "schedule" | "mine";

type TabBarProps = {
  locale: Locale;
  active: CabinetTab;
  onChange: (tab: CabinetTab) => void;
};

export default function TabBar({ locale, active, onChange }: TabBarProps) {
  const base =
    "flex-1 py-3 text-sm font-semibold transition-colors border-b-2 bg-white";
  return (
    <nav className="flex shrink-0 border-b border-slate-200 shadow-xs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === "schedule"}
        className={`${base} ${
          active === "schedule"
            ? "border-indigo-600 text-indigo-700"
            : "border-transparent text-slate-500 hover:text-slate-700"
        }`}
        onClick={() => onChange("schedule")}
      >
        {t(locale, "tabSchedule")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "mine"}
        className={`${base} ${
          active === "mine"
            ? "border-indigo-600 text-indigo-700"
            : "border-transparent text-slate-500 hover:text-slate-700"
        }`}
        onClick={() => onChange("mine")}
      >
        {t(locale, "tabMine")}
      </button>
    </nav>
  );
}
