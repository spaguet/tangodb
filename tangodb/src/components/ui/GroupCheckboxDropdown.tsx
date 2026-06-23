import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { selectFieldCls, selectLabelCls } from "./AppSelect";

export interface GroupCheckboxOption {
  key: string;
  label: string;
}

interface GroupCheckboxDropdownProps {
  label?: string;
  options: GroupCheckboxOption[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

export default function GroupCheckboxDropdown({
  label,
  options,
  selectedKeys,
  onChange,
  placeholder = "Выберите группы...",
  emptyMessage = "Нет доступных групп",
  disabled = false,
}: GroupCheckboxDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selectedLabels = options
    .filter((option) => selectedKeys.includes(option.key))
    .map((option) => option.label);

  const summary =
    selectedLabels.length === 0
      ? placeholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : `${selectedLabels.length} групп`;

  const toggleKey = (key: string) => {
    if (selectedKeys.includes(key)) {
      onChange(selectedKeys.filter((item) => item !== key));
      return;
    }
    onChange([...selectedKeys, key]);
  };

  return (
    <div className="field-stack" ref={rootRef}>
      {label && <label className={selectLabelCls}>{label}</label>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled || options.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          className={`${selectFieldCls} text-left ${selectedLabels.length === 0 ? "text-slate-400" : "text-slate-800"} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {options.length === 0 ? emptyMessage : summary}
        </button>
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />

        {open && options.length > 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto p-2 space-y-1">
            {options.map((option) => (
              <label
                key={option.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(option.key)}
                  onChange={() => toggleKey(option.key)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
