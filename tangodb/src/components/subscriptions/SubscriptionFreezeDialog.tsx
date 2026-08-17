import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Snowflake, X } from "lucide-react";
import type { Subscription } from "../../types";
import type { FreezePolicy } from "../../lib/freezePolicy";
import {
  canApplyFreeze,
  inclusiveCalendarDays,
  resolveFreezePolicyForSubscription,
} from "../../lib/freezePolicy";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useApplySubscriptionFreezePeriod } from "../../hooks/useSubscriptionFreezePeriods";
import { useI18n } from "../../hooks/useI18n";
import { toISODateLocal } from "../../lib/scheduleWeek";
import DatePickerField from "../ui/DatePickerField";
import { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";

interface SubscriptionFreezeDialogProps {
  subscription: Subscription | null;
  orgFreezePolicy: FreezePolicy;
  priceFreezeOverride?: { freezeMaxCount?: number | null; freezeMinLessons?: number | null } | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function SubscriptionFreezeDialog({
  subscription,
  orgFreezePolicy,
  priceFreezeOverride,
  toast,
  onClose,
  onSuccess,
}: SubscriptionFreezeDialogProps) {
  const { t, formatDate } = useI18n();
  const applyFreeze = useApplySubscriptionFreezePeriod();

  const today = useMemo(() => toISODateLocal(new Date()), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");

  const policy = useMemo(
    () => resolveFreezePolicyForSubscription(orgFreezePolicy, priceFreezeOverride),
    [orgFreezePolicy, priceFreezeOverride]
  );

  useEffect(() => {
    if (!subscription) return;
    setStartDate(today);
    setEndDate(today);
    setReason("");
  }, [subscription, today]);

  useEffect(() => {
    if (!subscription) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !applyFreeze.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subscription, applyFreeze.isPending, onClose]);

  const calendarDays = useMemo(
    () => (startDate && endDate ? inclusiveCalendarDays(startDate, endDate) : 0),
    [startDate, endDate]
  );

  const preview = useMemo(() => {
    if (!subscription) return null;
    const isMonthly = subscription.billingModel === "monthly_unlimited";
    const expiresExtension =
      isMonthly || subscription.expiresAt
        ? calendarDays
        : 0;
    let nextExpires: string | null = subscription.expiresAt ?? null;
    if (nextExpires && expiresExtension > 0) {
      const d = new Date(`${nextExpires}T12:00:00`);
      d.setDate(d.getDate() + expiresExtension);
      nextExpires = toISODateLocal(d);
    }

    return {
      isMonthly,
      nextExpires,
      nextFreezeUsed: subscription.freezeUsed + (calendarDays > 0 ? 1 : 0),
      expiresExtension,
    };
  }, [subscription, calendarDays]);

  const canSubmit =
    subscription &&
    calendarDays > 0 &&
    canApplyFreeze(subscription.lessonsTotal, subscription.freezeUsed, policy, subscription.billingModel);

  const handleSubmit = async () => {
    if (!subscription || !canSubmit) return;

    const res = await applyFreeze.mutateAsync({
      subscriptionId: subscription.id,
      startDate,
      endDate,
      reason,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "freeze.error.applyFailed", t), "error");
      return;
    }

    toast(t("freeze.success.applied"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {subscription && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !applyFreeze.isPending && onClose()}
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-4 space-y-4"
          >
            <div className="flex items-start justify-between gap-3 border-b border-ink-100 pb-3">
              <div>
                <div className="flex items-center gap-2 text-gold-700">
                  <Snowflake className="w-4 h-4" />
                  <h2 className="text-base font-semibold text-ink-900">{t("freeze.dialog.title")}</h2>
                </div>
                <p className="text-xs text-ink-500 mt-1">{t("freeze.dialog.subtitle")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={applyFreeze.isPending}
                aria-label={t("common.close")}
                className="p-1 text-ink-400 hover:text-ink-700 rounded-full hover:bg-ink-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DatePickerField
                label={t("common.dateFrom")}
                value={startDate}
                onChange={setStartDate}
                min={today}
              />
              <DatePickerField
                label={t("common.dateTo")}
                value={endDate}
                onChange={setEndDate}
                min={startDate || today}
              />
            </div>

            <div>
              <label className={labelCls}>{t("freeze.dialog.reason")}</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className={`${fieldCls} mt-1 resize-y min-h-[4rem]`}
                placeholder={t("freeze.dialog.reasonPlaceholder")}
              />
            </div>

            <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2 text-xs text-ink-600">
              <div className="flex items-center gap-2 text-ink-700 font-semibold">
                <CalendarDays className="w-3.5 h-3.5" />
                {t("freeze.dialog.previewTitle")}
              </div>
              <p>{t("freeze.dialog.duration", { count: calendarDays })}</p>
              {!preview?.isMonthly ? (
                <p>{t("freeze.dialog.lessonsLeft", { count: subscription.lessonsLeft })}</p>
              ) : null}
              <p>
                {t("freeze.dialog.expiresAt", {
                  date: subscription.expiresAt ? formatDate(new Date(`${subscription.expiresAt}T12:00:00`)) : "—",
                })}
              </p>
              <p>
                {t("freeze.dialog.freezeQuota", {
                  used: subscription.freezeUsed,
                  max: policy.freezeMaxCount,
                })}
              </p>
              {calendarDays > 0 ? (
                <>
                  <p>
                    {t("freeze.dialog.afterFreezeUsed", {
                      count: preview?.nextFreezeUsed ?? subscription.freezeUsed,
                    })}
                  </p>
                  {preview?.expiresExtension ? (
                    <p>
                      {t("freeze.dialog.afterExpiresAt", {
                        date: preview.nextExpires
                          ? formatDate(new Date(`${preview.nextExpires}T12:00:00`))
                          : "—",
                      })}
                    </p>
                  ) : (
                    <p className="text-ink-400">{t("freeze.dialog.noExpiryExtension")}</p>
                  )}
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={applyFreeze.isPending}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 hover:text-ink-700 cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSubmit || applyFreeze.isPending}
                className={btnAddCls}
              >
                {applyFreeze.isPending ? t("common.saving") : t("freeze.dialog.submit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
