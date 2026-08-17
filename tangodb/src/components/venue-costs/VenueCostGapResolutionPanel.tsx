import { useEffect, useState } from "react";
import { Check, AlertTriangle } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import {
  useConfirmVenueCostRuleGap,
  useVenueCostGapPreview,
  type VenueCostRuleStatus,
} from "../../hooks/useVenueCosts";
import { btnAddCls } from "../ui/buttonStyles";
import { fieldCls, selectLabelCls } from "../ui/AppSelect";
import { useToast } from "../../App";

interface VenueCostGapResolutionPanelProps {
  status: VenueCostRuleStatus;
  canManage: boolean;
  draftVersionId: string | null;
  onAcceptDraft: (versionId: string) => void;
  acceptPending: boolean;
}

export default function VenueCostGapResolutionPanel({
  status,
  canManage,
  draftVersionId,
  onAcceptDraft,
  acceptPending,
}: VenueCostGapResolutionPanelProps) {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const previewQuery = useVenueCostGapPreview(canManage && status.acknowledgementRequired);
  const confirmGap = useConfirmVenueCostRuleGap();
  const [gapFrom, setGapFrom] = useState("");
  const [gapTo, setGapTo] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const preview = previewQuery.data;
  const effectiveDraftId = draftVersionId ?? preview?.draftVersionId ?? null;

  useEffect(() => {
    if (!preview) return;
    setGapFrom(preview.suggestedGapFrom);
    setGapTo(preview.suggestedGapTo ?? "");
  }, [preview?.suggestedGapFrom, preview?.suggestedGapTo]);

  if (!status.acknowledgementRequired || !canManage) return null;

  const handleConfirmGap = async () => {
    if (confirmGap.isPending) return;
    setError(null);
    if (!gapFrom.trim()) {
      setError(t("venueCosts.gap.error.periodRequired"));
      return;
    }
    if (reason.trim().length < 3) {
      setError(t("venueCosts.gap.error.reasonRequired"));
      return;
    }
    const result = await confirmGap.mutateAsync({
      gapFrom,
      gapTo: gapTo.trim() || null,
      reason: reason.trim(),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      setError(t("venueCosts.gap.error.confirm", { error: result.error }));
      return;
    }
    toast(t("venueCosts.gap.confirmed"), result.alreadyApplied ? "info" : "success");
    setReason("");
  };

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-amber-950">{t("venueCosts.gap.title")}</h3>
          <p className="text-xs text-amber-700 leading-relaxed">
            {t("venueCosts.gap.intro", {
              date: status.latestValidTo ? formatDate(status.latestValidTo) : "—",
              count: status.pendingUnpricedCount,
            })}
          </p>
        </div>
      </div>

      {previewQuery.isLoading && (
        <p className="text-xs text-amber-700">{t("common.loading.data")}</p>
      )}

      {preview && (
        <div className="rounded-lg border border-amber-200 bg-white p-3 space-y-2 text-xs text-ink-700">
          <p className="font-semibold text-ink-800">{t("venueCosts.gap.impactTitle")}</p>
          <ul className="space-y-1 list-disc pl-4">
            <li>
              {t("venueCosts.gap.impact.closedPending", { count: preview.closedPendingUnpricedInGap })}
            </li>
            <li>
              {t("venueCosts.gap.impact.closedPriced", { count: preview.closedPricedInGap })}
            </li>
            {preview.nextRuleValidFrom && (
              <li>
                {t("venueCosts.gap.impact.nextRule", { date: formatDate(preview.nextRuleValidFrom) })}
              </li>
            )}
            {preview.pastWillNotRecalculate && (
              <li>{t("venueCosts.gap.impact.noRecalc")}</li>
            )}
          </ul>
        </div>
      )}

      {effectiveDraftId && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onAcceptDraft(effectiveDraftId)}
            disabled={acceptPending || confirmGap.isPending}
            className={`inline-flex items-center gap-1.5 ${btnAddCls}`}
          >
            <Check className="w-4 h-4" />
            {acceptPending ? t("common.saving") : t("venueCosts.gap.acceptDraft")}
          </button>
          <span className="text-xs text-amber-700">{t("venueCosts.gap.orConfirmGap")}</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="field-stack">
          <span className={selectLabelCls}>{t("venueCosts.gap.periodFrom")}</span>
          <input
            className={fieldCls}
            type="date"
            value={gapFrom}
            onChange={(e) => setGapFrom(e.target.value)}
          />
        </label>
        <label className="field-stack">
          <span className={selectLabelCls}>{t("venueCosts.gap.periodTo")}</span>
          <input
            className={fieldCls}
            type="date"
            value={gapTo}
            onChange={(e) => setGapTo(e.target.value)}
          />
        </label>
      </div>

      <label className="field-stack">
        <span className={selectLabelCls}>{t("venueCosts.gap.reason")}</span>
        <textarea
          className={`${fieldCls} min-h-[72px] resize-y`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("venueCosts.gap.reasonPlaceholder")}
        />
      </label>

      {error && <p className="text-xs text-garnet-700">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleConfirmGap()}
          disabled={confirmGap.isPending || acceptPending}
          className={btnAddCls}
        >
          {confirmGap.isPending ? t("common.saving") : t("venueCosts.gap.confirm")}
        </button>
      </div>
    </section>
  );
}
