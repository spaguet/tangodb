import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { selectFieldCls, selectLabelCls } from "./AppSelect";

export interface GroupCheckboxOption {
  key: string;
  label: string;
  hint?: string;
  disabled?: boolean;
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
  placeholder,
  emptyMessage,
  disabled = false,
}: GroupCheckboxDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const resolvedPlaceholder = placeholder ?? t("ui.groupSelect.placeholder");
  const resolvedEmptyMessage = emptyMessage ?? t("ui.groupSelect.empty");

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
      ? resolvedPlaceholder
      : selectedLabels.length <= 2
        ? selectedLabels.join(", ")
        : t("ui.groupSelect.selectedCount", { count: selectedLabels.length });

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
          className={`${selectFieldCls} text-left ${selectedLabels.length === 0 ? "text-ink-400" : "text-ink-800"} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {options.length === 0 ? resolvedEmptyMessage : summary}
        </button>
        <ChevronDown className="w-4 h-4 text-ink-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />

        {open && options.length > 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-ink-200 bg-white shadow-lg max-h-56 overflow-y-auto p-2 space-y-1">
            {options.map((option) => (
              <label
                key={option.key}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-ink-50 cursor-pointer text-sm text-ink-700 ${option.disabled ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(option.key)}
                  disabled={option.disabled}
                  onChange={() => !option.disabled && toggleKey(option.key)}
                  className="rounded border-ink-300 text-gold-700 focus:ring-gold-500 mt-0.5"
                />
                <span className="min-w-0">
                  <span className="truncate block">{option.label}</span>
                  {option.hint && (
                    <span className="block text-[10px] text-ink-500 mt-0.5">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
