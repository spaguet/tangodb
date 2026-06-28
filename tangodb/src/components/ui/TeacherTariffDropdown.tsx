import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { selectFieldCls, selectLabelCls } from "./AppSelect";

export interface TeacherTariffOption {
  id: string;
  label: string;
}

interface TeacherTariffDropdownProps {
  label?: string;
  teachers: TeacherTariffOption[];
  selectedTeacherIds: string[];
  onChange: (teacherIds: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

export default function TeacherTariffDropdown({
  label,
  teachers,
  selectedTeacherIds,
  onChange,
  disabled = false,
  compact = false,
}: TeacherTariffDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const allTeachers = selectedTeacherIds.length === 0;

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

  const selectedLabels = teachers
    .filter((teacher) => selectedTeacherIds.includes(teacher.id))
    .map((teacher) => teacher.label);

  const summary = allTeachers
    ? t("common.allTeachers")
    : selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : t("ui.groupSelect.selectedCount", { count: selectedLabels.length });

  const toggleAllTeachers = () => {
    onChange([]);
  };

  const toggleTeacher = (teacherId: string) => {
    if (selectedTeacherIds.includes(teacherId)) {
      const next = selectedTeacherIds.filter((id) => id !== teacherId);
      onChange(next);
      return;
    }
    onChange([...selectedTeacherIds, teacherId]);
  };

  return (
    <div className={`field-stack ${compact ? "min-w-0" : ""}`} ref={rootRef}>
      {label && <label className={selectLabelCls}>{label}</label>}
      <div className="relative">
        <button
          type="button"
          disabled={disabled || teachers.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          className={`${selectFieldCls} text-left ${allTeachers && teachers.length > 0 ? "text-slate-400" : "text-slate-800"} disabled:opacity-60 disabled:cursor-not-allowed ${compact ? "text-xs py-1.5" : ""}`}
        >
          {teachers.length === 0 ? t("common.noTeachers") : summary}
        </button>
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />

        {open && teachers.length > 0 && (
          <div className="absolute z-30 mt-1 w-full min-w-[12rem] rounded-lg border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto p-2 space-y-1">
            <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm text-slate-700 border-b border-slate-100 mb-1 pb-2">
              <input
                type="checkbox"
                checked={allTeachers}
                onChange={toggleAllTeachers}
                className={checkboxCls}
              />
              <span className="font-medium">{t("common.allTeachers")}</span>
            </label>
            {teachers.map((teacher) => (
              <label
                key={teacher.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={selectedTeacherIds.includes(teacher.id)}
                  onChange={() => toggleTeacher(teacher.id)}
                  className={checkboxCls}
                />
                <span className="truncate">{teacher.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
