import type { LucideIcon } from "lucide-react";

export interface SectionPillNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

interface SectionPillNavProps<T extends string> {
  items: SectionPillNavItem[];
  activeId: T;
  onChange: (id: T) => void;
  title?: string;
}

export default function SectionPillNav<T extends string>({
  items,
  activeId,
  onChange,
  title,
}: SectionPillNavProps<T>) {
  return (
    <nav className="shrink-0 min-w-0" role="tablist">
      {title ? (
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          {title}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = item.id === activeId;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.id as T)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                selected
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                  : "text-slate-600 hover:bg-slate-50 border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
              {item.badge != null && item.badge > 0 ? (
                <span className="inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
                  {item.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
