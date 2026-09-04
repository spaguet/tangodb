import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, CalendarRange, Smartphone, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";

export type RentalChannelChoice = "cashier-once" | "cashier-series" | "miniapp";

interface CreateRentalChannelDialogProps {
  open: boolean;
  contextLabel?: string;
  canCashier: boolean;
  canMiniApp: boolean;
  onSelect: (choice: RentalChannelChoice) => void;
  onClose: () => void;
}

export default function CreateRentalChannelDialog({
  open,
  contextLabel,
  canCashier,
  canMiniApp,
  onSelect,
  onClose,
}: CreateRentalChannelDialogProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[62] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                  {t("schedule.rental.channelMasterTitle")}
                </p>
                {contextLabel ? (
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 truncate">{contextLabel}</h3>
                ) : (
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">
                    {t("schedule.rental.channelMasterHeading")}
                  </h3>
                )}
                <p className="text-xs text-slate-500 mt-1">{t("schedule.rental.channelMasterHint")}</p>
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

            <div className="grid grid-cols-1 gap-2">
              {canCashier ? (
                <>
                  <button
                    type="button"
                    onClick={() => onSelect("cashier-once")}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors cursor-pointer text-left"
                  >
                    <Building2 className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t("schedule.rental.action")}</p>
                      <p className="text-xs text-slate-500">{t("schedule.rental.channelCashierOnceHint")}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelect("cashier-series")}
                    className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors cursor-pointer text-left"
                  >
                    <CalendarRange className="w-5 h-5 text-amber-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{t("rentalSeries.action")}</p>
                      <p className="text-xs text-slate-500">{t("schedule.rental.channelCashierSeriesHint")}</p>
                    </div>
                  </button>
                </>
              ) : null}

              {canMiniApp ? (
                <button
                  type="button"
                  onClick={() => onSelect("miniapp")}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors cursor-pointer text-left"
                >
                  <Smartphone className="w-5 h-5 text-indigo-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{t("schedule.miniapp.action")}</p>
                    <p className="text-xs text-slate-500">{t("schedule.rental.channelMiniappHint")}</p>
                  </div>
                </button>
              ) : null}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
