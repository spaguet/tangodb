import { ChevronDown } from "lucide-react";

/** Single-line control height — matches header Telegram/Email buttons (`DeveloperContacts`). */
export const controlHeightCls = "h-8";

/** Shared height/styles for text inputs, selects, and date pickers (not multiline description fields). */
export const fieldCls =
  `w-full ${controlHeightCls} box-border bg-ink-50 border border-ink-200 focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-100 outline-none rounded-lg px-3 text-xs transition-all`;

/** Multiline description fields — intentionally taller than single-line controls. */
export const descriptionFieldCls =
  "w-full bg-ink-50 border border-ink-200 focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-100 outline-none rounded-lg px-3.5 py-2.5 text-xs transition-all resize-none min-h-[4.5rem]";

export const selectFieldCls =
  `${fieldCls} appearance-none cursor-pointer pr-10`;

/** Search input with left icon at `left-3` (w-4 h-4). Same height as fieldCls. */
export const searchFieldCls = `${fieldCls} pl-9 pr-3`;

export const selectLabelCls =
  "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

interface AppSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export default function AppSelect({ label, className = "", children, ...props }: AppSelectProps) {
  return (
    <div className="field-stack">
      {label && <label className={selectLabelCls}>{label}</label>}
      <div className="relative">
        <select className={`${selectFieldCls} ${className}`.trim()} {...props}>
          {children}
        </select>
        <ChevronDown className="w-4 h-4 text-ink-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
