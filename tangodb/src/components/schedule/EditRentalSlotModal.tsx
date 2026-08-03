import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { minutesToTime, normalizeTime, timeToMinutes } from "../../lib/scheduleWeek";
import { useUpdateRental, useRentalDetail } from "../../hooks/useRentals";
import { useRenters } from "../../hooks/useRenters";
import { useI18n } from "../../hooks/useI18n";
import type { RentalDisplayLesson } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import DatePickerField from "../ui/DatePickerField";
import type { LocationOption } from "./CreateRentalDialog";

interface EditRentalSlotModalProps {
  lesson: RentalDisplayLesson | null;
  locations: LocationOption[];
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function defaultTimeEnd(timeStart: string): string {
  try {
    return minutesToTime(timeToMinutes(normalizeTime(timeStart)) + 240);
  } catch {
    return "16:00";
  }
}

export default function EditRentalSlotModal({
  lesson,
  locations,
  open,
  toast,
  onClose,
  onSuccess,
}: EditRentalSlotModalProps) {
  const { t } = useI18n();
  const updateMutation = useUpdateRental();
  const rentersQuery = useRenters({ enabled: open, activeOnly: true });
  const detailQuery = useRentalDetail(lesson?.rentalId ?? null, open && !!lesson);

  const [rentalDate, setRentalDate] = useState("");
  const [timeStart, setTimeStart] = useState("12:00");
  const [timeEnd, setTimeEnd] = useState("16:00");
  const [locationId, setLocationId] = useState("");
  const [renterId, setRenterId] = useState("");

  useEffect(() => {
    if (!open || !lesson) return;
    setRentalDate(lesson.date);
    setTimeStart(lesson.timeStart);
    setTimeEnd(lesson.timeEnd);
    setLocationId(lesson.locationId ?? locations[0]?.id ?? "");
    setRenterId(detailQuery.data?.renter.id ?? "");
  }, [open, lesson, locations, detailQuery.data?.renter.id]);

  const handleSubmit = async () => {
    if (!lesson) return;

    if (!rentalDate || !locationId || !renterId) {
      toast(t("schedule.rental.fieldsInvalid"), "error");
      return;
    }

    const res = await updateMutation.mutateAsync({
      rentalId: lesson.rentalId,
      rentalDate,
      timeStart,
      timeEnd,
      locationId,
      renterId,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.updateFailed", t), "error");
      return;
    }

    toast(t("schedule.rental.editSlotSuccess"), "success");
    onSuccess();
    onClose();
  };

  const title = lesson?.renterName ?? lesson?.purpose ?? t("schedule.rental.blockTitle");

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !updateMutation.isPending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarClock className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.rental.editSlotTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={updateMutation.isPending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-600">{title}</p>
              <DatePickerField label={t("schedule.rental.dateLabel")} value={rentalDate} onChange={setRentalDate} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>{t("common.timeStart")}</span>
                  <input
                    type="time"
                    className={fieldCls}
                    value={timeStart}
                    onChange={(e) => {
                      const next = e.target.value.slice(0, 5);
                      setTimeStart(next);
                      if (timeEnd <= next) setTimeEnd(defaultTimeEnd(next));
                    }}
                  />
                </div>
                <div>
                  <span className={labelCls}>{t("common.timeEnd")}</span>
                  <input type="time" className={fieldCls} value={timeEnd} onChange={(e) => setTimeEnd(e.target.value.slice(0, 5))} />
                </div>
              </div>
              <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </AppSelect>
              <AppSelect label={t("schedule.rental.renterLabel")} value={renterId} onChange={(e) => setRenterId(e.target.value)}>
                {(rentersQuery.data ?? []).map((renter) => (
                  <option key={renter.id} value={renter.id}>{renter.displayName}</option>
                ))}
              </AppSelect>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button
                type="button"
                onClick={onClose}
                disabled={updateMutation.isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={updateMutation.isPending}
                className={btnAddCls}
              >
                {updateMutation.isPending ? t("common.saving") : t("schedule.rental.editSlotSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
