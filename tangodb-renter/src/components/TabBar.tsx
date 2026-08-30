import { t, type Locale } from "../i18n/strings";

export type CabinetTab = "schedule" | "mine";

type TabBarProps = {
  locale: Locale;
  active: CabinetTab;
  onChange: (tab: CabinetTab) => void;
};

export default function TabBar({ locale, active, onChange }: TabBarProps) {
  const base =
    "flex-1 py-2.5 text-sm font-medium transition-colors border-b-2";
  return (
    <nav className="flex border-b border-white/10" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={active === "schedule"}
        className={`${base} ${active === "schedule" ? "border-[var(--tg-theme-button-color,#38bdf8)] text-[var(--tg-theme-button-color,#38bdf8)]" : "border-transparent opacity-70"}`}
        onClick={() => onChange("schedule")}
      >
        {t(locale, "tabSchedule")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === "mine"}
        className={`${base} ${active === "mine" ? "border-[var(--tg-theme-button-color,#38bdf8)] text-[var(--tg-theme-button-color,#38bdf8)]" : "border-transparent opacity-70"}`}
        onClick={() => onChange("mine")}
      >
        {t(locale, "tabMine")}
      </button>
    </nav>
  );
}
