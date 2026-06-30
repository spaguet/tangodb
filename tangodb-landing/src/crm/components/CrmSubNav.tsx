import type { LucideIcon } from "lucide-react";

type Item = { id: string; label: string; icon: LucideIcon };

type Props = {
  title: string;
  items: Item[];
  active: string;
  onChange: (id: string) => void;
};

export function CrmSubNav({ title, items, active, onChange }: Props) {
  return (
    <nav className="shrink-0">
      <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
        {title}
      </p>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-100"
                  : "text-slate-600 hover:bg-slate-50 border border-transparent"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
