import { useState } from "react";
import { Plus } from "lucide-react";
import type { ToastType } from "../../App";
import type { Discipline } from "../../types";
import AddDisciplineModal from "./AddDisciplineModal";

const fieldCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface DisciplineSelectProps {
  label?: string;
  disciplines: Discipline[];
  value: number | "";
  onChange: (id: number) => void;
  toast: (msg: string, type?: ToastType) => void;
  required?: boolean;
}

export default function DisciplineSelect({
  label = "Дисциплина",
  disciplines,
  value,
  onChange,
  toast,
  required = true,
}: DisciplineSelectProps) {
  const [addModalOpen, setAddModalOpen] = useState(false);

  return (
    <div className="field-stack">
      <label className={labelCls}>{label}</label>
      <select
        value={value}
        required={required}
        onChange={(e) => {
          const next = parseInt(e.target.value, 10);
          if (!Number.isNaN(next)) onChange(next);
        }}
        className={`${fieldCls} appearance-none cursor-pointer`}
      >
        <option value="" disabled>
          Выберите дисциплину...
        </option>
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setAddModalOpen(true)}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer mt-0.5"
      >
        <Plus className="w-3 h-3" />
        Добавить дисциплину
      </button>
      <AddDisciplineModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        toast={toast}
        onSuccess={(discipline) => onChange(discipline.id)}
      />
    </div>
  );
}
