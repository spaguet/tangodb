import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Edit, Plus, X } from "lucide-react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { useLocations } from "../../hooks/useLocations";
import {
  useRentalTariffRules,
  useRentalTariffs,
  useUpsertRentalTariff,
  type UpsertRentalTariffInput,
} from "../../hooks/useRentalTariffs";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import type { RentalTariff, RentalTariffRule, RentalTariffType } from "../../types";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function emptyRule(): RentalTariffRule {
  return {
    priority: 0,
    daysOfWeek: [1, 2, 3, 4, 5],
    timeStart: "18:00",
    timeEnd: "22:00",
    priceOverride: 0,
  };
}

function TariffEditorModal({
  tariff,
  open,
  onClose,
  toast,
}: {
  tariff: RentalTariff | null;
  open: boolean;
  onClose: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const { t } = useI18n();
  const { data: locations = [] } = useLocations();
  const rulesQuery = useRentalTariffRules(tariff?.id ?? null, open && !!tariff?.id);
  const upsertMutation = useUpsertRentalTariff();

  const [name, setName] = useState("");
  const [tariffType, setTariffType] = useState<RentalTariffType>("hourly");
  const [locationId, setLocationId] = useState("");
  const [price, setPrice] = useState("");
  const [minDuration, setMinDuration] = useState("0");
  const [roundingStep, setRoundingStep] = useState("60");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [rules, setRules] = useState<RentalTariffRule[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(tariff?.name ?? "");
    setTariffType(tariff?.tariffType ?? "hourly");
    setLocationId(tariff?.locationId ?? "");
    setPrice(tariff?.price != null ? String(tariff.price) : "");
    setMinDuration(String(tariff?.minDurationMinutes ?? 0));
    setRoundingStep(String(tariff?.roundingStepMinutes ?? 60));
    setValidFrom(tariff?.validFrom ?? "");
    setValidTo(tariff?.validTo ?? "");
    setStatus(tariff?.status ?? "active");
    setRules([]);
  }, [open, tariff]);

  useEffect(() => {
    if (!open || !tariff?.id || !rulesQuery.data) return;
    setRules(rulesQuery.data.length ? rulesQuery.data : []);
  }, [open, tariff?.id, rulesQuery.data]);

  const dayLabel = (d: number) => t(`rentalSeries.days.${d}` as import("../../lib/i18n/keys").I18nKey);

  const toggleDay = (ruleIndex: number, day: number) => {
    setRules((prev) =>
      prev.map((rule, i) => {
        if (i !== ruleIndex) return rule;
        const days = rule.daysOfWeek.includes(day)
          ? rule.daysOfWeek.filter((d) => d !== day)
          : [...rule.daysOfWeek, day].sort((a, b) => a - b);
        return { ...rule, daysOfWeek: days };
      })
    );
  };

  const handleSave = async () => {
    const payload: UpsertRentalTariffInput = {
      tariffId: tariff?.id,
      name: name.trim(),
      tariffType,
      status,
      locationId: locationId || null,
      price: Number(price) || 0,
      minDurationMinutes: Number(minDuration) || 0,
      roundingStepMinutes: Math.max(Number(roundingStep) || 1, 1),
      validFrom: validFrom || null,
      validTo: validTo || null,
      rules: tariffType === "hourly" ? rules : [],
    };

    const res = await upsertMutation.mutateAsync(payload);
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalTariffs.error.saveFailed", t), "error");
      return;
    }
    toast(t("rentalTariffs.saveSuccess"), "success");
    onClose();
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40" onClick={() => !upsertMutation.isPending && onClose()} />
        <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-900">
              {tariff ? t("rentalTariffs.editTitle") : t("rentalTariffs.createTitle")}
            </h3>
            <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={t("common.close")}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div>
            <span className={labelCls}>{t("rentalTariffs.nameLabel")}</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <AppSelect label={t("rentalTariffs.typeLabel")} value={tariffType} onChange={(e) => setTariffType(e.target.value as RentalTariffType)}>
            <option value="hourly">{t("rentalTariffs.typeHourly")}</option>
            <option value="fixed">{t("rentalTariffs.typeFixed")}</option>
          </AppSelect>

          <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("rentalTariffs.allLocations")}</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </AppSelect>

          <div>
            <span className={labelCls}>{t("rentalTariffs.priceLabel")}</span>
            <input type="number" min={0} step="0.01" className={inputCls} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>

          {tariffType === "hourly" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={labelCls}>{t("rentalTariffs.minDurationLabel")}</span>
                <input type="number" min={0} className={inputCls} value={minDuration} onChange={(e) => setMinDuration(e.target.value)} />
              </div>
              <div>
                <span className={labelCls}>{t("rentalTariffs.roundingLabel")}</span>
                <input type="number" min={1} className={inputCls} value={roundingStep} onChange={(e) => setRoundingStep(e.target.value)} />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className={labelCls}>{t("rentalTariffs.validFromLabel")}</span>
              <input type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div>
              <span className={labelCls}>{t("rentalTariffs.validToLabel")}</span>
              <input type="date" className={inputCls} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>

          {tariffType === "hourly" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800">{t("rentalTariffs.rulesTitle")}</h4>
                <button type="button" onClick={() => setRules((prev) => [...prev, emptyRule()])} className="text-xs font-semibold text-indigo-600 cursor-pointer">
                  {t("rentalTariffs.addRule")}
                </button>
              </div>
              {rules.map((rule, idx) => (
                <div key={idx} className="rounded-lg border border-slate-100 p-3 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {WEEK_DAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(idx, day)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded cursor-pointer ${
                          rule.daysOfWeek.includes(day) ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {dayLabel(day)}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="time" className={inputCls} value={rule.timeStart} onChange={(e) => setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, timeStart: e.target.value } : r)))} />
                    <input type="time" className={inputCls} value={rule.timeEnd} onChange={(e) => setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, timeEnd: e.target.value } : r)))} />
                  </div>
                  <input type="number" min={0} step="0.01" className={inputCls} placeholder={t("rentalTariffs.priceOverrideLabel")} value={rule.priceOverride || ""} onChange={(e) => setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, priceOverride: Number(e.target.value) || 0 } : r)))} />
                  <button type="button" onClick={() => setRules((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-rose-600 font-semibold cursor-pointer">
                    {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={upsertMutation.isPending} className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-xs font-semibold uppercase rounded-lg cursor-pointer">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={upsertMutation.isPending} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-semibold uppercase rounded-lg cursor-pointer disabled:opacity-60">
              {upsertMutation.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function RentalTariffsSettingsPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const tariffsQuery = useRentalTariffs({ status: null });
  const { data: locations = [] } = useLocations();
  const locationMap = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RentalTariff | null>(null);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (tariff: RentalTariff) => {
    setEditing(tariff);
    setEditorOpen(true);
  };

  if (tariffsQuery.isLoading) return <LoadingState />;
  if (tariffsQuery.isError) return <QueryErrorState error={tariffsQuery.error} onRetry={() => void tariffsQuery.refetch()} />;

  const tariffs = tariffsQuery.data ?? [];

  return (
    <div className={embedded ? "space-y-3" : "panel-card-stack max-w-2xl"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {!embedded && (
            <>
              <h2 className="text-base font-semibold text-slate-900">{t("rentalTariffs.pageTitle")}</h2>
              <p className="text-xs text-slate-500 mt-1">{t("rentalTariffs.pageSubtitle")}</p>
            </>
          )}
        </div>
        <RequirePermission action="finance.read" mode="hide">
          <RequirePermission action="schedule.write" mode="hide">
            <button type="button" onClick={openCreate} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg cursor-pointer shrink-0">
              <Plus className="w-3.5 h-3.5" />
              {t("common.add")}
            </button>
          </RequirePermission>
        </RequirePermission>
      </div>

      {tariffs.length === 0 ? (
        <p className="text-sm text-slate-500">{t("rentalTariffs.empty")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tariffs.map((tariff) => (
            <li key={tariff.id} className="py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{tariff.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {tariff.tariffType === "hourly" ? t("rentalTariffs.typeHourly") : t("rentalTariffs.typeFixed")}
                  {tariff.locationId ? ` · ${locationMap.get(tariff.locationId)}` : ` · ${t("rentalTariffs.allLocations")}`}
                  {tariff.price != null ? ` · ${formatCurrency(tariff.price)} ${tariff.currency ?? "RUB"}` : ""}
                  {tariff.rulesCount > 0 ? ` · ${t("rentalTariffs.rulesCount", { count: tariff.rulesCount })}` : ""}
                </p>
              </div>
              <RequirePermission action="finance.read" mode="hide">
                <RequirePermission action="schedule.write" mode="hide">
                  <button type="button" onClick={() => openEdit(tariff)} className="p-1.5 text-slate-400 hover:text-indigo-600 cursor-pointer" aria-label={t("common.edit")}>
                    <Edit className="w-4 h-4" />
                  </button>
                </RequirePermission>
              </RequirePermission>
            </li>
          ))}
        </ul>
      )}

      <TariffEditorModal tariff={editing} open={editorOpen} onClose={() => setEditorOpen(false)} toast={toast} />
    </div>
  );
}
