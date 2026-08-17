import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Edit, Plus, X } from "lucide-react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import { btnAddCls, btnAddSoftCls, btnCancelCls } from "../../components/ui/buttonStyles";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
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
import {
  formatTariffRulePeriod,
  nextTariffRulePriority,
  sortTariffRulesByApplicationOrder,
  validateRentalTariffRules,
  type TariffRuleValidationIssue,
} from "../../lib/rentalTariffRules";
import {
  groupTariffsByLocation,
  resolveTariffStatusQueryFilter,
  type RentalTariffStatusFilter,
} from "../../lib/rentalTariffPricing";
import { formatCurrency } from "../../lib/utils";
import type { RentalTariff, RentalTariffRule, RentalTariffType } from "../../types";
import type { I18nKey } from "../../lib/i18n/keys";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function emptyRule(priority = 0): RentalTariffRule {
  return {
    priority,
    daysOfWeek: [1, 2, 3, 4, 5],
    timeStart: "18:00",
    timeEnd: "22:00",
    priceOverride: 0,
    validFrom: null,
    validTo: null,
  };
}

function validationIssueMessage(issue: TariffRuleValidationIssue, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  switch (issue.code) {
    case "daysRequired":
      return t("rentalTariffs.error.ruleDaysRequired");
    case "timeInvalid":
      return t("rentalTariffs.error.ruleTimeInvalid");
    case "dateRangeInvalid":
      return t("rentalTariffs.error.ruleDateRangeInvalid");
    case "ambiguousOverlap":
      return t("rentalTariffs.error.ruleAmbiguousOverlap", {
        a: (issue.conflict!.indexA + 1),
        b: (issue.conflict!.indexB + 1),
        priority: issue.conflict!.priority,
      });
    default:
      return t("rentalTariffs.error.saveFailed");
  }
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

  const dayLabel = (d: number) => t(`rentalSeries.days.${d}` as I18nKey);

  const ruleValidationIssues = useMemo(() => validateRentalTariffRules(rules), [rules]);

  const sortedRuleEntries = useMemo(
    () => sortTariffRulesByApplicationOrder(rules.map((rule, index) => ({ rule, index }))),
    [rules]
  );

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
    const issues = validateRentalTariffRules(rules);
    if (issues.length > 0) {
      toast(validationIssueMessage(issues[0]!, t), "error");
      return;
    }

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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink-950/40" onClick={() => !upsertMutation.isPending && onClose()} />
        <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative bg-white rounded-xl border border-ink-200 shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-ink-900">
              {tariff ? t("rentalTariffs.editTitle") : t("rentalTariffs.createTitle")}
            </h3>
            <button type="button" onClick={onClose} className="p-1 text-ink-400 hover:text-ink-700 cursor-pointer" aria-label={t("common.close")}>
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

          {tariff ? (
            <AppSelect
              label={t("rentalTariffs.statusLabel")}
              value={status}
              onChange={(e) => setStatus(e.target.value as "active" | "archived")}
            >
              <option value="active">{t("rentalTariffs.statusActive")}</option>
              <option value="archived">{t("rentalTariffs.statusArchived")}</option>
            </AppSelect>
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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">{t("rentalTariffs.rulesTitle")}</h4>
                  <p className="text-xs text-ink-500 mt-0.5">{t("rentalTariffs.rulesApplyOrderHint")}</p>
                  <p className="text-xs text-ink-500 mt-0.5">{t("rentalTariffs.rulePriorityHint")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setRules((prev) => [...prev, emptyRule(nextTariffRulePriority(prev))])}
                  className="text-xs font-semibold text-gold-700 cursor-pointer shrink-0"
                >
                  {t("rentalTariffs.addRule")}
                </button>
              </div>
              {ruleValidationIssues.length > 0 ? (
                <p className="text-xs text-garnet-600 rounded-lg border border-garnet-100 bg-garnet-50 px-3 py-2">
                  {validationIssueMessage(ruleValidationIssues[0]!, t)}
                </p>
              ) : null}
              {sortedRuleEntries.map(({ rule, index: idx }, order) => (
                <div key={idx} className="rounded-lg border border-ink-100 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gold-700 bg-gold-50 px-2 py-0.5 rounded">
                      {t("rentalTariffs.ruleApplicationOrder", { order: order + 1 })}
                    </span>
                    <span className="text-xs text-ink-500">{formatTariffRulePeriod(rule, t)}</span>
                  </div>
                  <div>
                    <span className={labelCls}>{t("rentalTariffs.rulePriorityLabel")}</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className={inputCls}
                      value={rule.priority}
                      onChange={(e) =>
                        setRules((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, priority: Math.max(0, Number(e.target.value) || 0) } : r))
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {WEEK_DAYS.map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleDay(idx, day)}
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded cursor-pointer ${
                          rule.daysOfWeek.includes(day) ? "bg-gold-100 text-gold-800" : "bg-ink-100 text-ink-500"
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className={labelCls}>{t("rentalTariffs.ruleValidFromLabel")}</span>
                      <input
                        type="date"
                        className={inputCls}
                        value={rule.validFrom ?? ""}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, validFrom: e.target.value || null } : r))
                          )
                        }
                      />
                    </div>
                    <div>
                      <span className={labelCls}>{t("rentalTariffs.ruleValidToLabel")}</span>
                      <input
                        type="date"
                        className={inputCls}
                        value={rule.validTo ?? ""}
                        onChange={(e) =>
                          setRules((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, validTo: e.target.value || null } : r))
                          )
                        }
                      />
                    </div>
                  </div>
                  <input type="number" min={0} step="0.01" className={inputCls} placeholder={t("rentalTariffs.priceOverrideLabel")} value={rule.priceOverride || ""} onChange={(e) => setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, priceOverride: Number(e.target.value) || 0 } : r)))} />
                  <button type="button" onClick={() => setRules((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-garnet-600 font-semibold cursor-pointer">
                    {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={upsertMutation.isPending} className={`flex-1 ${btnCancelCls}`}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={upsertMutation.isPending || ruleValidationIssues.length > 0} className={`flex-1 ${btnAddCls}`}>
              {upsertMutation.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default function RentalTariffsSettingsPage({
  embedded = false,
  canWrite = true,
}: {
  embedded?: boolean;
  canWrite?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<RentalTariffStatusFilter>("active");
  const [locationFilter, setLocationFilter] = useState("");
  const tariffsQuery = useRentalTariffs({
    status: resolveTariffStatusQueryFilter(statusFilter),
    locationId: locationFilter || null,
  });
  const { data: locations = [] } = useLocations();
  const locationMap = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RentalTariff | null>(null);

  const formatTariffPrice = (tariff: RentalTariff) => {
    if (tariff.price == null) return t("rentalTariffs.priceHidden");
    return `${formatCurrency(tariff.price)} ${tariff.currency ?? "RUB"}`;
  };

  const groupedTariffs = useMemo(
    () => groupTariffsByLocation(tariffsQuery.data ?? [], locationMap),
    [tariffsQuery.data, locationMap]
  );

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
  const isDefaultFilter = statusFilter === "active" && !locationFilter;

  const renderTariffRow = (tariff: RentalTariff) => (
    <li key={tariff.id} className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink-900">{tariff.name}</p>
          {tariff.status === "archived" ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-ink-100 text-ink-600 px-2 py-0.5">
              {t("rentalTariffs.statusArchivedBadge")}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-ink-500 mt-0.5">
          {tariff.tariffType === "hourly" ? t("rentalTariffs.typeHourly") : t("rentalTariffs.typeFixed")}
          {tariff.locationId ? ` · ${locationMap.get(tariff.locationId)}` : ` · ${t("rentalTariffs.allLocations")}`}
          {` · ${formatTariffPrice(tariff)}`}
          {tariff.rulesCount > 0 ? ` · ${t("rentalTariffs.rulesCount", { count: tariff.rulesCount })}` : ""}
        </p>
      </div>
      {canWrite ? (
        <button type="button" onClick={() => openEdit(tariff)} className="p-1.5 text-ink-400 hover:text-gold-800 cursor-pointer" aria-label={t("common.edit")}>
          <Edit className="w-4 h-4" />
        </button>
      ) : null}
    </li>
  );

  return (
    <div className={embedded ? "space-y-3" : "panel-card-stack max-w-2xl"}>
      {!canWrite && !embedded ? (
        <p className="text-xs text-ink-500 rounded-lg border border-ink-100 bg-ink-50/10 px-3 py-2">
          {t("rentalTariffs.lookupHint")}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          {!embedded && (
            <>
              <h2 className="text-base font-semibold text-ink-900">{t("rentalTariffs.pageTitle")}</h2>
              <p className="text-xs text-ink-500 mt-1">{t("rentalTariffs.pageSubtitle")}</p>
            </>
          )}
        </div>
        {canWrite ? (
          <button type="button" onClick={openCreate} className={btnAddSoftCls}>
            <Plus className="w-4 h-4" />
            {t("common.add")}
          </button>
        ) : null}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <AppSelect
          label={t("rentalTariffs.filterStatus")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RentalTariffStatusFilter)}
        >
          <option value="active">{t("rentalTariffs.filterStatusActive")}</option>
          <option value="archived">{t("rentalTariffs.filterStatusArchived")}</option>
          <option value="all">{t("rentalTariffs.filterStatusAll")}</option>
        </AppSelect>
        <AppSelect
          label={t("rentalTariffs.filterLocation")}
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
        >
          <option value="">{t("rentalTariffs.filterLocationAll")}</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </AppSelect>
      </div>

      {tariffs.length === 0 ? (
        <div className="rounded-lg border border-ink-100 bg-ink-50/10 px-4 py-5 text-center space-y-3">
          <p className="text-sm text-ink-600">
            {isDefaultFilter ? t("rentalTariffs.empty") : t("rentalTariffs.emptyFiltered")}
          </p>
          {canWrite && isDefaultFilter ? (
            <button type="button" onClick={openCreate} className={btnAddSoftCls}>
              <Plus className="w-4 h-4" />
              {t("rentalTariffs.emptyCta")}
            </button>
          ) : !canWrite ? (
            <p className="text-xs text-ink-500">{t("rentalTariffs.lookupHint")}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTariffs.map((group) => (
            <section key={group.locationKey ?? "all"}>
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-1">
                {group.locationKey
                  ? locationMap.get(group.locationKey) ?? group.locationKey
                  : t("rentalTariffs.groupAllLocations")}
              </h3>
              <ul className="divide-y divide-ink-100">{group.tariffs.map(renderTariffRow)}</ul>
            </section>
          ))}
        </div>
      )}

      <TariffEditorModal tariff={editing} open={editorOpen && canWrite} onClose={() => setEditorOpen(false)} toast={toast} />
    </div>
  );
}
