import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Pencil, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import {
  useRenterCancelOccurrence,
  useRenterCancelPack,
  useRenterCancelPackFromDate,
  useRenterDeleteHold,
} from "../../hooks/useRenterMiniAppStaff";
import { canManageMiniAppRentals } from "../../lib/permissions";
import { formatCurrency } from "../../lib/utils";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { miniAppLifecycleI18nKey } from "../../lib/rentalMiniAppDisplay";
import { useRentalDetail } from "../../hooks/useRentals";
import type { RentalDisplayLesson } from "../../types";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { LocationOption } from "./CreateRentalDialog";
import EditRentalSlotModal from "./EditRentalSlotModal";

interface MiniAppRentalInfoPopupProps {
  lesson: RentalDisplayLesson | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function MiniAppRentalInfoPopup({
  lesson,
  locations,
  toast,
  onClose,
  onSuccess,
}: MiniAppRentalInfoPopupProps) {
  const { t, formatDate } = useI18n();
  const { role, options } = usePermissions();
  const { isReadOnly } = useOrganization();
  const deleteHold = useRenterDeleteHold();
  const cancelOccurrence = useRenterCancelOccurrence();
  const cancelPack = useRenterCancelPack();
  const cancelPackFromDate = useRenterCancelPackFromDate();
  const detailQuery = useRentalDetail(lesson?.rentalId ?? null, !!lesson);

  const [confirm, setConfirm] = useState<"hold" | "occurrence" | "pack" | "packFromDate" | null>(null);
  const [editSlotOpen, setEditSlotOpen] = useState(false);

  if (!lesson) return null;

  const locationName = locations.find((l) => l.id === lesson.locationId)?.name;
  const canManage = !isReadOnly && canManageMiniAppRentals(role, options);
  const lifecycle = lesson.lifecycle ?? null;
  const canDeleteHold = canManage && lesson.canDeleteHold === true;
  const canCancelSlot = canManage && lesson.canCancelOccurrence === true;
  const canCancelPack = canManage && lesson.canCancelPack === true;
  const canCancelPackFromDate = canManage && lesson.canCancelPackFromDate === true;
  const canEditSlot = canManage && lesson.bookingStatus === "confirmed";
  const pending =
    deleteHold.isPending ||
    cancelOccurrence.isPending ||
    cancelPack.isPending ||
    cancelPackFromDate.isPending;
  const displayTitle = lesson.purpose
    ? [lesson.purpose, lesson.renterName].filter(Boolean).join(" · ")
    : (lesson.renterName ?? t("schedule.miniapp.blockTitle"));

  const runAction = async () => {
    if (!confirm) return;
    const res =
      confirm === "hold"
        ? await deleteHold.mutateAsync(lesson.rentalId)
        : confirm === "pack"
          ? await cancelPack.mutateAsync(lesson.rentalSeriesId ?? "")
          : confirm === "packFromDate"
            ? await cancelPackFromDate.mutateAsync({
                seriesId: lesson.rentalSeriesId ?? "",
                fromDate: lesson.date,
              })
            : await cancelOccurrence.mutateAsync(lesson.rentalId);
    if (!res.success) {
      toast(resolveMutationError(res.error, "renter.cancel.failed", t), "error");
      return;
    }
    toast(
      t(
        confirm === "hold"
          ? "schedule.miniapp.holdDeleted"
          : confirm === "pack"
            ? "schedule.miniapp.packCancelled"
            : confirm === "packFromDate"
              ? "schedule.miniapp.packFromDateCancelled"
              : "schedule.miniapp.occurrenceCancelled"
      ),
      "success"
    );
    setConfirm(null);
    onSuccess();
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-slate-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{displayTitle}</h3>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-sm max-h-[70dvh] overflow-y-auto">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {t("schedule.miniapp.channelBadge")}
              </p>
              <div>
                <span className={labelCls}>{t("schedule.rental.whenLabel")}</span>
                <p className="text-slate-800">{formatDate(lesson.date)} · {lesson.timeStart}–{lesson.timeEnd}</p>
              </div>
              {locationName ? (
                <div>
                  <span className={labelCls}>{t("schedule.form.location")}</span>
                  <p className="text-slate-800">{locationName}</p>
                </div>
              ) : null}
              {lesson.purpose ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.purposeLabel")}</span>
                  <p className="text-slate-800">{lesson.purpose}</p>
                </div>
              ) : null}
              {lesson.renterName ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.renterLabel")}</span>
                  <p className="text-slate-800">{lesson.renterName}</p>
                </div>
              ) : null}
              <div>
                <span className={labelCls}>{t("schedule.miniapp.lifecycleLabel")}</span>
                <p className="text-slate-800">{t(miniAppLifecycleI18nKey(lifecycle))}</p>
              </div>
              {lesson.fixedAmount != null ? (
                <div>
                  <span className={labelCls}>{t("schedule.miniapp.costLabel")}</span>
                  <p className="text-slate-800">{formatCurrency(lesson.fixedAmount)} {lesson.currency ?? "RUB"}</p>
                </div>
              ) : null}
              {lifecycle === "debt" ? (
                <p className="text-xs font-semibold text-rose-600">{t("schedule.miniapp.debtHint")}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              {canEditSlot ? (
                <button
                  type="button"
                  onClick={() => setEditSlotOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t("schedule.rental.editSlotAction")}
                </button>
              ) : null}
              {canDeleteHold ? (
                <button
                  type="button"
                  onClick={() => setConfirm("hold")}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                >
                  {t("schedule.miniapp.deleteHold")}
                </button>
              ) : null}
              {canCancelSlot ? (
                <button
                  type="button"
                  onClick={() => setConfirm("occurrence")}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                >
                  {t("schedule.miniapp.cancelOccurrence")}
                </button>
              ) : null}
              {canCancelPackFromDate ? (
                <button
                  type="button"
                  onClick={() => setConfirm("packFromDate")}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                >
                  {t("schedule.miniapp.cancelPackFromDate", { date: formatDate(lesson.date) })}
                </button>
              ) : null}
              {canCancelPack ? (
                <button
                  type="button"
                  onClick={() => setConfirm("pack")}
                  className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer"
                >
                  {t("schedule.miniapp.cancelPack")}
                </button>
              ) : null}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      <EditRentalSlotModal
        lesson={lesson}
        locations={locations}
        open={editSlotOpen}
        toast={toast}
        onClose={() => setEditSlotOpen(false)}
        onSuccess={() => {
          onSuccess();
          void detailQuery.refetch();
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={
          confirm === "hold"
            ? t("schedule.miniapp.deleteHold")
            : confirm === "pack"
              ? t("schedule.miniapp.cancelPack")
              : confirm === "packFromDate"
                ? t("schedule.miniapp.cancelPackFromDate", { date: formatDate(lesson.date) })
                : t("schedule.miniapp.cancelOccurrence")
        }
        description={
          confirm === "hold"
            ? t("schedule.miniapp.deleteHoldConfirm")
            : confirm === "pack"
              ? t("schedule.miniapp.cancelPackConfirm")
              : confirm === "packFromDate"
                ? t("schedule.miniapp.cancelPackFromDateConfirm", { date: formatDate(lesson.date) })
                : t("schedule.miniapp.cancelOccurrenceConfirm")
        }
        pending={pending}
        onConfirm={() => void runAction()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
