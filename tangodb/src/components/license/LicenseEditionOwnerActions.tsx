import { useState } from "react";
import ConfirmDialog from "../ui/ConfirmDialog";
import type { OrgEditionSnapshot } from "../../lib/orgEdition";
import { hasCancellableMonthly } from "../../lib/licenseEditionUi";
import { useI18n } from "../../hooks/useI18n";
import { btnDestructiveOpenCls } from "../ui/buttonStyles";

interface LicenseEditionOwnerActionsProps {
  edition: OrgEditionSnapshot | null;
  onCancelMonthly: () => Promise<void>;
  cancelPending?: boolean;
}

export default function LicenseEditionOwnerActions({
  edition,
  onCancelMonthly,
  cancelPending = false,
}: LicenseEditionOwnerActionsProps) {
  const { t } = useI18n();
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!edition || !hasCancellableMonthly(edition)) return null;

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-2">
        <p className="text-xs font-semibold text-slate-800">{t("license.edition.ownerActionsTitle")}</p>
        <p className="text-xs text-slate-600 leading-relaxed">{t("license.edition.modeVsCancelHint")}</p>
        <button
          type="button"
          disabled={cancelPending}
          onClick={() => setConfirmCancel(true)}
          className={`${btnDestructiveOpenCls} w-full`}
        >
          {t("license.edition.cancelMonthlyCta")}
        </button>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title={t("license.edition.cancelMonthlyTitle")}
        description={
          <>
            <span>{t("license.edition.cancelMonthlyBody")}</span>
            <ul className="mt-2 list-disc pl-4 space-y-1">
              <li>{t("license.edition.cancelChecklist.dataKept")}</li>
              <li>{t("license.edition.cancelChecklist.monthEnds")}</li>
              <li>{t("license.edition.cancelChecklist.salesFreeze")}</li>
            </ul>
          </>
        }
        confirmLabel={t("license.edition.cancelMonthlyConfirm")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={async () => {
          await onCancelMonthly();
          setConfirmCancel(false);
        }}
      />
    </>
  );
}
