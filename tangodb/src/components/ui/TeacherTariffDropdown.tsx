import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

const checkboxCls = "rounded border-ink-300 text-gold-700 focus:ring-gold-500";
const MENU_MAX_HEIGHT = 224;
const MENU_GAP = 4;

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(
    null
  );
  const allTeachers = selectedTeacherIds.length === 0;

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
    const maxHeight = Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow);

    setMenuStyle({
      top: openUp ? rect.top - MENU_GAP - maxHeight : rect.bottom + MENU_GAP,
      left: rect.left,
      width: Math.max(rect.width, 192),
      maxHeight: Math.max(maxHeight, 120),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);

    return () => {
      window.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
    };
  }, [open, updateMenuPosition]);

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

  const menu =
    open && teachers.length > 0 && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            style={{
              top: menuStyle.top,
              left: menuStyle.left,
              width: menuStyle.width,
              maxHeight: menuStyle.maxHeight,
            }}
            className="fixed z-[100] rounded-lg border border-ink-200 bg-white shadow-lg overflow-y-auto overscroll-contain p-2 space-y-1"
          >
            <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-50 cursor-pointer text-sm text-ink-700 border-b border-ink-100 mb-1 pb-2">
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
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-50 cursor-pointer text-sm text-ink-700"
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
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`field-stack ${compact ? "min-w-0" : ""}`} ref={rootRef}>
      {label && <label className={selectLabelCls}>{label}</label>}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled || teachers.length === 0}
          onClick={() => setOpen((prev) => !prev)}
          className={`${selectFieldCls} text-left ${allTeachers && teachers.length > 0 ? "text-ink-400" : "text-ink-800"} disabled:opacity-60 disabled:cursor-not-allowed ${compact ? "text-xs py-1.5" : ""}`}
        >
          {teachers.length === 0 ? t("common.noTeachers") : summary}
        </button>
        <ChevronDown className="w-4 h-4 text-ink-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        {menu}
      </div>
    </div>
  );
}
