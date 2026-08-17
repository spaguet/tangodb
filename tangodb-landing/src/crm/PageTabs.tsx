import type { LucideIcon } from "lucide-react";

export interface PageTabItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

export function pageTabPanelCls(activeTab: string, firstTabId: string) {
  return activeTab === firstTabId
    ? "rounded-b-xl rounded-tr-xl border-t-0"
    : "rounded-b-xl rounded-t-xl border-t border-ink-200";
}

export default function PageTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: PageTabItem[];
  activeTab: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div
      className="grid w-full items-end gap-0.5 border-b border-ink-200"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      role="tablist"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeTab;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id as T)}
            className={`flex w-full items-center justify-center gap-2 px-3 sm:px-5 py-1.5 text-xs sm:text-sm font-semibold transition-all outline-none cursor-pointer rounded-t-lg border ${
              selected
                ? "bg-white border-ink-200 border-b-white text-gold-700 relative z-10 -mb-px"
                : "bg-ink-100/10 border-transparent text-ink-400 hover:bg-ink-100 hover:text-ink-600 mb-px"
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="text-center leading-tight">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
