import { ChevronDown } from "lucide-react";

export const selectFieldCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all appearance-none cursor-pointer pr-10";

export const selectLabelCls =
  "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

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
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
}
