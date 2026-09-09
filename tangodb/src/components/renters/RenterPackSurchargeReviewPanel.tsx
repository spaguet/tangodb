import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { ToastType } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import {
  useApplyRenterPackSurcharge,
  useRenterPackSurchargeReviews,
  useWaiveRenterPackSurcharge,
  type PackSurchargeReviewItem,
} from "../../hooks/useRenterPackSurchargeReviews";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import { btnDestructiveOpenCls, btnOpenCls } from "../ui/buttonStyles";
import { fieldCls } from "../ui/AppSelect";

type Props = {
  renterId: string;
  locationMap: Map<string, string>;
  enabled: boolean;
  toast: (msg: string, type?: ToastType) => void;
  onChanged?: () => void;
};

export default function RenterPackSurchargeReviewPanel({
  renterId,
  locationMap,
  enabled,
  toast,
  onChanged,
}: Props) {
  const { t, formatDate } = useI18n();
  const reviewsQuery = useRenterPackSurchargeReviews(renterId, enabled);
  const applyMutation = useApplyRenterPackSurcharge();
  const waiveMutation = useWaiveRenterPackSurcharge();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = useMemo(
    () => (reviewsQuery.data ?? []).filter((r) => r.status === "pending"),
    [reviewsQuery.data]
  );

  if (!enabled) {
    return null;
  }

  if (reviewsQuery.isError) {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
        {t("renter.surchargeReview.loadFailed")}
      </p>
    );
  }

  if (reviewsQuery.isLoading || pending.length === 0) {
    return null;
  }

  const handleApply = async (review: PackSurchargeReviewItem) => {
    const res = await applyMutation.mutateAsync({
      seriesId: review.rentalSeriesId,
      notes: notes[review.id],
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renter.surchargeReview.applyFailed", t), "error");
      return;
    }
    toast(t("renter.surchargeReview.applySuccess", { amount: formatCurrency(res.appliedAmount) }), "success");
    onChanged?.();
  };

  const handleWaive = async (review: PackSurchargeReviewItem) => {
    const res = await waiveMutation.mutateAsync({
      seriesId: review.rentalSeriesId,
      notes: notes[review.id],
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "renter.surchargeReview.waiveFailed", t), "error");
      return;
    }
    toast(t("renter.surchargeReview.waiveSuccess"), "success");
    onChanged?.();
  };

  const busy = applyMutation.isPending || waiveMutation.isPending;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <h4 className="text-sm font-semibold text-amber-900">{t("renter.surchargeReview.title")}</h4>
          <p className="text-xs text-amber-800 mt-0.5">{t("renter.surchargeReview.subtitle")}</p>
        </div>
      </div>

      <ul className="space-y-3">
        {pending.map((review) => {
          const locationName = locationMap.get(review.locationId) ?? review.locationId;
          return (
            <li key={review.id} className="rounded-lg border border-amber-100 bg-white p-3 space-y-2">
              <p className="text-sm font-semibold text-slate-800">
                {locationName} · {formatDate(review.seriesValidFrom)} – {formatDate(review.seriesValidTo)}
              </p>
              <p className="text-xs text-slate-600">
                {t("renter.surchargeReview.suggested", {
                  amount: formatCurrency(review.suggestedAmount),
                  currency: review.currency,
                })}
              </p>
              <p className="text-xs text-slate-500">{t("renter.surchargeReview.reasonWeek1Bulk")}</p>
              <textarea
                className={`${fieldCls} min-h-[56px] text-xs`}
                placeholder={t("renter.surchargeReview.notesPlaceholder")}
                value={notes[review.id] ?? ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [review.id]: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className={btnDestructiveOpenCls}
                  onClick={() => void handleApply(review)}
                >
                  {t("renter.surchargeReview.applyAction")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className={btnOpenCls}
                  onClick={() => void handleWaive(review)}
                >
                  {t("renter.surchargeReview.waiveAction")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
