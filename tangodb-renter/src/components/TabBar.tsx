import { t, type Locale } from "../i18n/strings";

export type CabinetTab = "schedule" | "mine";

type TabBarProps = {
  locale: Locale;
  active: CabinetTab;
  onChange: (tab: CabinetTab) => void;
};

export default function TabBar({ locale, active, onChange }: TabBarProps) {
  return (
    <nav
      className="grid w-full shrink-0 grid-cols-2 items-end gap-0.5 border-b border-slate-200 bg-slate-50 px-2 pt-1"
      role="tablist"
    >
      <TabButton
        selected={active === "schedule"}
        onClick={() => onChange("schedule")}
      >
        {t(locale, "tabSchedule")}
      </TabButton>
      <TabButton selected={active === "mine"} onClick={() => onChange("mine")}>
        {t(locale, "tabMine")}
      </TabButton>
    </nav>
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center justify-center rounded-t-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
        selected
          ? "relative z-10 -mb-px border-slate-200 border-b-white bg-white text-indigo-700"
          : "mb-px border-transparent bg-slate-100/70 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}
