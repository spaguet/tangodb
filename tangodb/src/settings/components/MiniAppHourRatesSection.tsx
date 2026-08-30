import { useState } from "react";
import { fieldCls as inputCls } from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import {
  useLocationRentalHourRates,
  useSetLocationMiniappEnabled,
  useUpsertLocationRentalHourRate,
  type HourRateKind,
} from "../../hooks/useLocationRentalHourRates";
import { canWriteRentalTariffs } from "../../lib/permissions";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const KINDS: HourRateKind[] = ["one_time", "recurring", "penalty"];

export default function MiniAppHourRatesSection() {
  const { t } = useI18n();
  const toast = useToast();
  const { role, options } = usePermissions();
  const query = useLocationRentalHourRates();
  const upsertRate = useUpsertLocationRentalHourRate();
  const setEnabled = useSetLocationMiniappEnabled();

  const canWrite = canWriteRentalTariffs(role, options) && (query.data?.canWrite ?? false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const kindLabel = (kind: HourRateKind) => {
    if (kind === "recurring") return t("hallRent.miniapp.kind.recurring");
    if (kind === "penalty") return t("hallRent.miniapp.kind.penalty");
    return t("hallRent.miniapp.kind.oneTime");
  };

  const locations = query.data?.locations ?? [];

  const saveRate = async (locationId: string, kind: HourRateKind) => {
    const key = `${locationId}:${kind}`;
    const price = Number(drafts[key]);
    if (!Number.isFinite(price) || price < 0) {
      toast(t("renter.rates.priceInvalid"), "error");
      return;
    }
    const res = await upsertRate.mutateAsync({ locationId, kind, price });
    if (!res.success) {
      toast(resolveMutationError(res.error, "hallRent.miniapp.error.saveRate", t), "error");
      return;
    }
    toast(t("hallRent.miniapp.rateSaved"), "success");
  };

  if (query.isLoading) return <LoadingState label={t("hallRent.miniapp.loading")} />;
  if (query.isError) return <QueryErrorState error={query.error} />;

  return (
    <div className="space-y-3">
      {query.data?.penaltyRateGap ? (
        <p className="text-xs font-medium text-amber-800 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          {t("hallRent.miniapp.penaltyRateGapBanner")}
        </p>
      ) : null}
      {locations.length === 0 ? (
        <p className="text-sm text-slate-400">{t("hallRent.miniapp.noLocations")}</p>
      ) : (
        <ul className="space-y-3">
          {locations.map((loc) => (
            <li key={loc.locationId} className="rounded-lg border border-slate-100 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{loc.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {loc.kindsComplete ? t("hallRent.miniapp.kindsComplete") : t("hallRent.miniapp.kindsIncomplete")}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={loc.miniappEnabled}
                    disabled={!canWrite || setEnabled.isPending}
                    onChange={(e) => {
                      void setEnabled.mutateAsync({
                        locationId: loc.locationId,
                        enabled: e.target.checked,
                      }).then((res) => {
                        if (!res.success) {
                          toast(resolveMutationError(res.error, "hallRent.miniapp.error.saveFlag", t), "error");
                        }
                      });
                    }}
                  />
                  {t("hallRent.miniapp.enabled")}
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {KINDS.map((kind) => {
                  const current = loc.rates.find((r) => r.kind === kind);
                  const key = `${loc.locationId}:${kind}`;
                  const shown = drafts[key] ?? (current?.price != null ? String(current.price) : "");
                  return (
                    <div key={kind} className="field-stack">
                      <span className={labelCls}>{kindLabel(kind)}</span>
                      {query.data?.showPrices ? (
                        <div className="flex gap-1">
                          <input
                            className={inputCls}
                            inputMode="decimal"
                            value={shown}
                            disabled={!canWrite}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                          {canWrite ? (
                            <button
                              type="button"
                              className="px-2 text-[10px] font-semibold text-indigo-600 cursor-pointer"
                              disabled={upsertRate.isPending}
                              onClick={() => {
                                void saveRate(loc.locationId, kind);
                              }}
                            >
                              {t("common.save")}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">{t("rentalTariffs.priceHidden")}</p>
                      )}
                      {query.data?.showPrices && current?.price != null ? (
                        <p className="text-[10px] text-slate-400">
                          {formatCurrency(current.price)} {current.currency ?? ""}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
