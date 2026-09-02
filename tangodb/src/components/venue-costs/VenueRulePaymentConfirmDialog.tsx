import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import type { VenueCostRuleStatus } from "../../hooks/useVenueCosts";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import VenueRuleExpiryNotice from "./VenueRuleExpiryNotice";

interface VenueRulePaymentConfirmDialogProps {
  status: VenueCostRuleStatus | null;
  pending?: boolean;
  /** When opened from another modal (e.g. personal lesson payment), render above z-[60] overlays. */
  stackLayer?: "default" | "above";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function VenueRulePaymentConfirmDialog({
  status,
  pending = false,
  stackLayer = "default",
  onConfirm,
  onCancel,
}: VenueRulePaymentConfirmDialogProps) {
  const { t } = useI18n();
  const zClass = stackLayer === "above" ? "z-[70]" : "z-50";
  return (
    <AnimatePresence>
      {status && (
        <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`} role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => !pending && onCancel()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl space-y-4"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-semibold text-slate-900">{t("venueCosts.paymentConfirm.title")}</h3>
            </div>
            <VenueRuleExpiryNotice status={status} compact />
            <p className="text-xs text-slate-600 leading-relaxed">{t("venueCosts.paymentConfirm.body")}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className={`flex-1 ${btnCancelCls}`}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={pending}
                className={`flex-1 ${btnAddCls}`}
              >
                {pending ? t("common.saving") : t("venueCosts.paymentConfirm.confirm")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
