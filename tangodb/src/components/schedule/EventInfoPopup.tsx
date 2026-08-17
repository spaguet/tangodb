import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarPlus, Coins, Edit, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useCalendarEventSessions } from "../../hooks/useCalendarEvents";
import { formatCurrency } from "../../lib/utils";
import type { EventDisplayLesson } from "../../types";
import EditCalendarEventDialog from "./EditCalendarEventDialog";
import RecordCalendarEventPaymentModal from "./RecordCalendarEventPaymentModal";
import type { LocationOption } from "./CreateCalendarEventDialog";

interface EventInfoPopupProps {
  lesson: EventDisplayLesson | null;
  locations: LocationOption[];
  disciplineMap: Map<string, string>;
  teamMap: Map<string, string>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function EventInfoPopup({
  lesson,
  locations,
  disciplineMap,
  teamMap,
  toast,
  onClose,
  onSuccess,
}: EventInfoPopupProps) {
  const { t, formatDate } = useI18n();
  const { can, role } = usePermissions();
  const { isReadOnly } = useOrganization();
  const canSeeFinance = can("finance.read");
  const canManage =
    !isReadOnly &&
    can("schedule.write") &&
    (role === "owner" || role === "director" || role === "admin");

  const sessionsQuery = useCalendarEventSessions(lesson?.eventId ?? null, !!lesson);

  const [editOpen, setEditOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  if (!lesson) return null;

  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  const typeLabel =
    lesson.eventType === "open_lesson"
      ? t("schedule.event.typeOpenLesson")
      : t("schedule.event.typeMasterClass");

  const paymentLabel =
    lesson.paymentStatus === "paid"
      ? t("schedule.event.paymentPaid")
      : lesson.paymentStatus === "partial"
        ? t("schedule.event.paymentPartial")
        : t("schedule.event.paymentUnpaid");

  const canRecordPayment =
    canSeeFinance &&
    !isReadOnly &&
    lesson.paymentStatus !== "paid" &&
    ((lesson.incomeAmount ?? 0) <= 0 || (lesson.paidAmount ?? 0) < (lesson.incomeAmount ?? 0));

  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-950/40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-ink-200 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-100">
              <div className="flex items-center gap-2 min-w-0">
                <CalendarPlus className="w-4 h-4 text-lavender-600 shrink-0" />
                <h3 className="text-base font-semibold text-ink-900 truncate">{lesson.title}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-ink-400 hover:text-ink-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-sm max-h-[70dvh] overflow-y-auto">
              <div>
                <span className={labelCls}>{t("schedule.event.typeLabel")}</span>
                <p className="text-ink-800">{typeLabel}</p>
              </div>
              <div>
                <span className={labelCls}>{t("schedule.event.sessionsLabel")}</span>
                {sessionsQuery.isLoading ? (
                  <p className="text-ink-400">{t("common.loading.default")}</p>
                ) : (
                  <ul className="space-y-1.5 mt-1">
                    {(sessionsQuery.data ?? []).map((session) => {
                      const locName = locationNameById.get(session.locationId);
                      const isCurrent = session.sessionId === lesson.sessionId;
                      return (
                        <li
                          key={session.sessionId ?? `${session.date}-${session.timeStart}`}
                          className={`text-ink-800 ${isCurrent ? "font-semibold text-lavender-800" : ""}`}
                        >
                          {formatDate(session.date)} · {session.timeStart}–{session.timeEnd}
                          {locName ? ` · ${locName}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {lesson.guestTeacher ? (
                <div>
                  <span className={labelCls}>{t("schedule.event.guestTeacherLabel")}</span>
                  <p className="text-ink-800">{lesson.guestTeacher}</p>
                </div>
              ) : null}
              {lesson.organizer ? (
                <div>
                  <span className={labelCls}>{t("schedule.event.organizerLabel")}</span>
                  <p className="text-ink-800">{lesson.organizer}</p>
                </div>
              ) : null}
              {lesson.plannedGuestCount != null ? (
                <div>
                  <span className={labelCls}>{t("schedule.event.plannedGuestsLabel")}</span>
                  <p className="text-ink-800">{lesson.plannedGuestCount}</p>
                </div>
              ) : null}
              {lesson.actualGuestCount != null ? (
                <div>
                  <span className={labelCls}>{t("schedule.event.actualGuestsLabel")}</span>
                  <p className="text-ink-800">{lesson.actualGuestCount}</p>
                </div>
              ) : null}
              {lesson.comment ? (
                <div>
                  <span className={labelCls}>{t("schedule.event.commentLabel")}</span>
                  <p className="text-ink-800 whitespace-pre-wrap">{lesson.comment}</p>
                </div>
              ) : null}
              {canSeeFinance ? (
                <div className="pt-2 border-t border-ink-100 space-y-2">
                  <div>
                    <span className={labelCls}>{t("schedule.event.paymentStatusLabel")}</span>
                    <p className="text-ink-800">{paymentLabel}</p>
                  </div>
                  {lesson.incomeAmount != null && lesson.incomeAmount > 0 ? (
                    <>
                      <div>
                        <span className={labelCls}>{t("schedule.event.incomeLabel")}</span>
                        <p className="text-ink-800 font-semibold">
                          {formatCurrency(lesson.incomeAmount)} {lesson.currency ?? "RUB"}
                        </p>
                      </div>
                      <div>
                        <span className={labelCls}>{t("schedule.event.paidLabel")}</span>
                        <p className="text-ink-800">
                          {formatCurrency(lesson.paidAmount ?? 0)} {lesson.currency ?? "RUB"}
                        </p>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            {(canManage || canRecordPayment) && (
              <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-ink-100 bg-ink-50/10">
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-lavender-700 bg-lavender-50 hover:bg-lavender-100 border border-lavender-200 rounded-lg cursor-pointer"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    {t("common.edit")}
                  </button>
                ) : null}
                {canRecordPayment ? (
                  <button
                    type="button"
                    onClick={() => setPaymentOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-gold-700 bg-gold-50 hover:bg-gold-100 border border-gold-200 rounded-lg cursor-pointer"
                  >
                    <Coins className="w-3.5 h-3.5" />
                    {t("schedule.event.recordPaymentAction")}
                  </button>
                ) : null}
              </div>
            )}
          </motion.div>
        </div>
      </AnimatePresence>

      <EditCalendarEventDialog
        lesson={lesson}
        open={editOpen}
        locations={locations}
        disciplineMap={disciplineMap}
        teamMap={teamMap}
        toast={toast}
        onClose={() => setEditOpen(false)}
        onSuccess={handleSuccess}
      />

      <RecordCalendarEventPaymentModal
        lesson={lesson}
        open={paymentOpen}
        toast={toast}
        onClose={() => setPaymentOpen(false)}
        onSuccess={handleSuccess}
      />
    </>
  );
}
