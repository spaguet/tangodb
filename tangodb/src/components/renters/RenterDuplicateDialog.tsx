import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { RenterDuplicateMatch } from "../../types";
import type { I18nKey } from "../../lib/i18n/keys";
import { useI18n } from "../../hooks/useI18n";
import { fieldCls } from "../ui/AppSelect";

interface RenterDuplicateDialogProps {
  open: boolean;
  duplicates: RenterDuplicateMatch[];
  onOpenExisting: (renterId: string) => void;
  onCreateAnyway: (reason: string) => void;
  onClose: () => void;
}

const matchKey: Record<string, I18nKey> = {
  phone: "renters.duplicate.matchPhone",
  email: "renters.duplicate.matchEmail",
  tax_id: "renters.duplicate.matchTaxId",
};

export default function RenterDuplicateDialog({
  open,
  duplicates,
  onOpenExisting,
  onCreateAnyway,
  onClose,
}: RenterDuplicateDialogProps) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  if (!open) return null;

  const handleCreateAnyway = () => {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    if (!reason.trim()) return;
    onCreateAnyway(reason.trim());
    setReason("");
    setShowReason(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="text-base font-semibold text-slate-900">{t("renters.duplicate.title")}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded-full cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600">{t("renters.duplicate.message")}</p>

        <ul className="space-y-2 max-h-48 overflow-y-auto">
          {duplicates.map((dup) => (
            <li key={dup.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{dup.displayName}</p>
                <p className="text-xs text-slate-500">
                  {dup.matchFields.map((f) => t(matchKey[f] ?? "renters.duplicate.matchPhone")).join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenExisting(dup.id)}
                className="shrink-0 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                {t("renters.duplicate.openExisting")}
              </button>
            </li>
          ))}
        </ul>

        {showReason ? (
          <div className="field-stack">
            <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
              {t("renters.duplicate.reason")}
            </label>
            <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        ) : null}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold uppercase rounded-lg cursor-pointer">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleCreateAnyway}
            disabled={showReason && !reason.trim()}
            className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase rounded-lg cursor-pointer disabled:opacity-50"
          >
            {t("renters.duplicate.createAnyway")}
          </button>
        </div>
      </div>
    </div>
  );
}
