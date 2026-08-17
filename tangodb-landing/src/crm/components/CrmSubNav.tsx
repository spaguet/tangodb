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
      <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
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
                  ? "bg-gold-50 text-gold-700 border border-gold-100"
                  : "text-ink-600 hover:bg-ink-50 border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
