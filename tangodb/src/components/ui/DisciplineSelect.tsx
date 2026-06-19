import { useState } from "react";
import { Plus } from "lucide-react";
import type { ToastType } from "../../App";
import type { Discipline } from "../../types";
import AddDisciplineModal from "./AddDisciplineModal";
import AppSelect from "./AppSelect";

interface DisciplineSelectProps {
  label?: string;
  disciplines: Discipline[];
  value: string | "";
  onChange: (id: string) => void;
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
      <AppSelect
        label={label}
        value={value}
        required={required}
        onChange={(e) => {
          const next = e.target.value;
          if (next) onChange(next);
        }}
      >
        <option value="" disabled>
          Выберите дисциплину...
        </option>
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </AppSelect>
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
