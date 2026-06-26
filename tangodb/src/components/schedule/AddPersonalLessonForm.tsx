import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { type TeamMemberRow } from "../../hooks/useTeamMembers";
import type { PersonalLessonRef, ScheduleSlotRef } from "../../lib/scheduleConflicts";
import { useI18n } from "../../hooks/useI18n";
import PersonalLessonSaleForm from "../personal-lessons/PersonalLessonSaleForm";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";

interface AddPersonalLessonFormProps {
  prefill: ScheduleCellPrefill | null;
  teacherOptions: TeamMemberRow[];
  scheduleSlots: ScheduleSlotRef[];
  personalLessons: PersonalLessonRef[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddPersonalLessonForm({
  prefill,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: AddPersonalLessonFormProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!prefill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefill, onClose]);

  return (
    <AnimatePresence>
      {prefill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {t("common.personalLesson")}
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("schedule.popup.newBooking")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <PersonalLessonSaleForm
              mode="schedule-cell"
              prefill={prefill}
              teacherOptions={teacherOptions}
              scheduleSlots={scheduleSlots}
              personalLessons={personalLessons}
              toast={toast}
              onSuccess={onSuccess}
              onClose={onClose}
            />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
