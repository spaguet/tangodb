import { useState } from "react";
import { AlertTriangle, Check, Edit, Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useLocations } from "../../hooks/useLocations";
import { usePermissions } from "../../hooks/usePermissions";
import {
  useAcceptVenueCostRuleVersion,
  useSaveVenueCostRuleDraft,
  useVenueCostRuleStatus,
  useVenueCostRuleVersions,
  type VenueCostRuleVersion,
} from "../../hooks/useVenueCosts";
import {
  previewGroupVenueCost,
  validateVenueCostDraft,
  type VenueCostFixedRules,
  type VenueCostMode,
  type VenueCostPerLessonRules,
  type VenueCostRuleDraft,
} from "../../lib/venueCostRules";
import { formatCurrency } from "../../lib/utils";
import AppSelect, { fieldCls, selectLabelCls } from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import VenueRuleExpiryNotice from "../../components/venue-costs/VenueRuleExpiryNotice";
import { useToast } from "../../App";

const today = () => new Date().toISOString().slice(0, 10);
const emptyPerLessonRules = (): VenueCostPerLessonRules => ({
  currency: "RUB",
  group: [
    {
      disciplineId: null,
      locationId: null,
      attendanceTiers: [
        { minAttendees: 0, maxAttendees: 4, amount: 0 },
        { minAttendees: 5, maxAttendees: null, amount: 0 },
      ],
    },
  ],
  personal: [{ disciplineId: null, locationId: null, amount: 0 }],
});
const newDraft = (): VenueCostRuleDraft => ({
  mode: "disabled",
  validFrom: today(),
  validTo: null,
  rules: {},
});

function versionToDraft(version: VenueCostRuleVersion): VenueCostRuleDraft {
  return {
    id: version.status === "draft" ? version.id : undefined,
    mode: version.mode,
    validFrom: version.validFrom,
    validTo: version.validTo,
    rules: structuredClone(version.rules),
  };
}

export default function VenueCostsSettingsPage() {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const { role, can } = usePermissions();
  const canManage = role === "owner" || role === "director";
  const canRead = can("finance.read");
  const statusQuery = useVenueCostRuleStatus();
  const versionsQuery = useVenueCostRuleVersions();
  const disciplinesQuery = useDisciplines();
  const locationsQuery = useLocations();
  const saveDraft = useSaveVenueCostRuleDraft();
  const acceptVersion = useAcceptVenueCostRuleVersion();
  const [draft, setDraft] = useState<VenueCostRuleDraft | null>(null);

  const disciplines = disciplinesQuery.data ?? [];
  const locations = locationsQuery.data ?? [];

  if (!canRead) {
    return (
      <div className="panel-card-stack max-w-4xl">
        <p className="text-sm text-slate-500">{t("dashboard.noAccess")}</p>
      </div>
    );
  }

  const switchMode = (mode: VenueCostMode) => {
    setDraft((current) => {
      const base = current ?? newDraft();
      return {
        ...base,
        mode,
        validTo: mode === "fixed_period" ? base.validTo ?? base.validFrom : base.validTo,
        rules:
          mode === "per_lesson"
            ? base.mode === "per_lesson"
              ? base.rules
              : emptyPerLessonRules()
            : mode === "fixed_period"
              ? ({ currency: "RUB", period: "month", amount: 0 } satisfies VenueCostFixedRules)
              : {},
      };
    });
  };

  const handleSave = async () => {
    if (!draft || saveDraft.isPending) return;
    const errors = validateVenueCostDraft(draft);
    if (errors.length) {
      toast(t("venueCosts.error.invalid"), "error");
      return;
    }
    const result = await saveDraft.mutateAsync({ draft, idempotencyKey: crypto.randomUUID() });
    if (!result.success) {
      toast(t("venueCosts.error.save", { error: result.error }), "error");
      return;
    }
    toast(t("venueCosts.saved"), "success");
    setDraft((current) => (current ? { ...current, id: result.ruleVersionId } : current));
  };

  const handleAccept = async (versionId: string) => {
    if (acceptVersion.isPending) return;
    const result = await acceptVersion.mutateAsync({
      ruleVersionId: versionId,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!result.success) {
      toast(t("venueCosts.error.accept", { error: result.error }), "error");
      return;
    }
    toast(t("venueCosts.accepted"), result.alreadyApplied ? "info" : "success");
    setDraft(null);
  };

  if (
    statusQuery.isLoading ||
    versionsQuery.isLoading ||
    disciplinesQuery.isLoading ||
    locationsQuery.isLoading
  ) {
    return <LoadingState />;
  }
  const error = statusQuery.error ?? versionsQuery.error ?? disciplinesQuery.error ?? locationsQuery.error;
  if (error) return <QueryErrorState error={error} onRetry={() => void versionsQuery.refetch()} />;

  const versions = versionsQuery.data ?? [];

  return (
    <div className="panel-card-stack max-w-4xl">
      <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">{t("venueCosts.pageTitle")}</h2>
              <p className="text-xs text-slate-600 mt-1">{t("venueCosts.pageSubtitle")}</p>
            </div>
          </div>
          {canManage && !draft && (
            <button
              type="button"
              onClick={() => setDraft(newDraft())}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              {t("venueCosts.newDraft")}
            </button>
          )}
        </div>
        <p className="text-[11px] text-amber-800">{t("venueCosts.externalHint")}</p>
      </section>

      {statusQuery.data?.acknowledgementRequired && <VenueRuleExpiryNotice status={statusQuery.data} />}

      {draft && canManage && (
        <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900">{t("venueCosts.editorTitle")}</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <AppSelect label={t("venueCosts.mode")} value={draft.mode} onChange={(e) => switchMode(e.target.value as VenueCostMode)}>
              <option value="per_lesson">{t("venueCosts.mode.perLesson")}</option>
              <option value="fixed_period">{t("venueCosts.mode.fixedPeriod")}</option>
              <option value="disabled">{t("venueCosts.mode.disabled")}</option>
            </AppSelect>
            <label className="field-stack">
              <span className={selectLabelCls}>{t("venueCosts.validFrom")}</span>
              <input className={fieldCls} type="date" value={draft.validFrom} onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })} />
            </label>
            <label className="field-stack">
              <span className={selectLabelCls}>{t("venueCosts.validTo")}</span>
              <input className={fieldCls} type="date" value={draft.validTo ?? ""} onChange={(e) => setDraft({ ...draft, validTo: e.target.value || null })} />
            </label>
          </div>

          {draft.mode === "fixed_period" && (
            <FixedPeriodEditor draft={draft} setDraft={setDraft} t={t} />
          )}
          {draft.mode === "per_lesson" && (
            <PerLessonEditor
              draft={draft}
              setDraft={setDraft}
              disciplines={disciplines}
              locations={locations}
              t={t}
            />
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => setDraft(null)} disabled={saveDraft.isPending} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saveDraft.isPending} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider cursor-pointer disabled:opacity-60">
              {saveDraft.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">{t("venueCosts.history")}</h3>
        {versions.length === 0 ? (
          <p className="text-sm text-slate-500">{t("venueCosts.empty")}</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {versions.map((version) => (
              <div key={version.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {t("venueCosts.version", { version: version.versionNumber })} · {t(`venueCosts.mode.${version.mode === "per_lesson" ? "perLesson" : version.mode === "fixed_period" ? "fixedPeriod" : "disabled"}`)}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {formatDate(version.validFrom)} — {version.validTo ? formatDate(version.validTo) : "∞"} · {t(`venueCosts.status.${version.status}`)}
                  </p>
                  {version.mode === "per_lesson" && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      {t("venueCosts.preview", {
                        four: formatCurrency(previewGroupVenueCost(version.rules as VenueCostPerLessonRules, 4)),
                        five: formatCurrency(previewGroupVenueCost(version.rules as VenueCostPerLessonRules, 5)),
                      })}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0">
                    {version.status === "draft" && (
                      <>
                        <button type="button" onClick={() => setDraft(versionToDraft(version))} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer" aria-label={t("common.edit")}>
                          <Edit className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => void handleAccept(version.id)} disabled={acceptVersion.isPending} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold cursor-pointer disabled:opacity-60">
                          <Check className="w-3.5 h-3.5" />
                          {t("venueCosts.accept")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FixedPeriodEditor({
  draft,
  setDraft,
  t,
}: {
  draft: VenueCostRuleDraft;
  setDraft: (value: VenueCostRuleDraft) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const rules = draft.rules as VenueCostFixedRules;
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      <AppSelect label={t("venueCosts.period")} value={rules.period} onChange={(e) => setDraft({ ...draft, rules: { ...rules, period: e.target.value as VenueCostFixedRules["period"] } })}>
        <option value="week">{t("venueCosts.period.week")}</option>
        <option value="month">{t("venueCosts.period.month")}</option>
        <option value="custom">{t("venueCosts.period.custom")}</option>
      </AppSelect>
      <MoneyInput label={t("venueCosts.amount")} value={rules.amount} onChange={(amount) => setDraft({ ...draft, rules: { ...rules, amount } })} />
      <TextInput label={t("venueCosts.currency")} value={rules.currency} onChange={(currency) => setDraft({ ...draft, rules: { ...rules, currency } })} />
    </div>
  );
}

function PerLessonEditor({
  draft,
  setDraft,
  disciplines,
  locations,
  t,
}: {
  draft: VenueCostRuleDraft;
  setDraft: (value: VenueCostRuleDraft) => void;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const rules = draft.rules as VenueCostPerLessonRules;
  const updateRules = (next: VenueCostPerLessonRules) => setDraft({ ...draft, rules: next });
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <TextInput label={t("venueCosts.currency")} value={rules.currency} onChange={(currency) => updateRules({ ...rules, currency })} />
      </div>
      <RuleSection title={t("venueCosts.groupRules")} onAdd={() => updateRules({ ...rules, group: [...rules.group, { disciplineId: null, locationId: null, attendanceTiers: [{ minAttendees: 0, maxAttendees: null, amount: 0 }] }] })}>
        {rules.group.map((rule, ruleIndex) => (
          <div key={ruleIndex} className="rounded-xl border border-slate-200 p-3 space-y-3">
            <RuleScope disciplineId={rule.disciplineId} locationId={rule.locationId} disciplines={disciplines} locations={locations} t={t} onChange={(scope) => updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, ...scope } : item) })} />
            {rule.attendanceTiers.map((tier, tierIndex) => (
              <div key={tierIndex} className="grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 items-end">
                <MoneyInput label={t("venueCosts.tierMin")} value={tier.minAttendees} onChange={(value) => updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, attendanceTiers: item.attendanceTiers.map((part, idx) => idx === tierIndex ? { ...part, minAttendees: value } : part) } : item) })} />
                <label className="field-stack"><span className={selectLabelCls}>{t("venueCosts.tierMax")}</span><input className={fieldCls} type="number" min={0} value={tier.maxAttendees ?? ""} onChange={(e) => updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, attendanceTiers: item.attendanceTiers.map((part, idx) => idx === tierIndex ? { ...part, maxAttendees: e.target.value === "" ? null : Number(e.target.value) } : part) } : item) })} /></label>
                <MoneyInput label={t("venueCosts.amount")} value={tier.amount} onChange={(amount) => updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, attendanceTiers: item.attendanceTiers.map((part, idx) => idx === tierIndex ? { ...part, amount } : part) } : item) })} />
                <IconDelete onClick={() => updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, attendanceTiers: item.attendanceTiers.filter((_, idx) => idx !== tierIndex) } : item) })} />
              </div>
            ))}
            <div className="flex justify-between">
              <button type="button" onClick={() => { const last = rule.attendanceTiers.at(-1); const min = last?.maxAttendees == null ? 0 : last.maxAttendees + 1; updateRules({ ...rules, group: rules.group.map((item, index) => index === ruleIndex ? { ...item, attendanceTiers: [...item.attendanceTiers, { minAttendees: min, maxAttendees: null, amount: 0 }] } : item) }); }} className="text-xs font-semibold text-indigo-600 cursor-pointer">{t("venueCosts.addTier")}</button>
              <IconDelete onClick={() => updateRules({ ...rules, group: rules.group.filter((_, index) => index !== ruleIndex) })} />
            </div>
          </div>
        ))}
      </RuleSection>
      <RuleSection title={t("venueCosts.personalRules")} onAdd={() => updateRules({ ...rules, personal: [...rules.personal, { disciplineId: null, locationId: null, amount: 0 }] })}>
        {rules.personal.map((rule, index) => (
          <div key={index} className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
            <RuleScope compact disciplineId={rule.disciplineId} locationId={rule.locationId} disciplines={disciplines} locations={locations} t={t} onChange={(scope) => updateRules({ ...rules, personal: rules.personal.map((item, idx) => idx === index ? { ...item, ...scope } : item) })} />
            <MoneyInput label={t("venueCosts.amount")} value={rule.amount} onChange={(amount) => updateRules({ ...rules, personal: rules.personal.map((item, idx) => idx === index ? { ...item, amount } : item) })} />
            <IconDelete onClick={() => updateRules({ ...rules, personal: rules.personal.filter((_, idx) => idx !== index) })} />
          </div>
        ))}
      </RuleSection>
      <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600">
        {t("venueCosts.preview", { four: formatCurrency(previewGroupVenueCost(rules, 4)), five: formatCurrency(previewGroupVenueCost(rules, 5)) })}
      </div>
    </div>
  );
}

function RuleSection({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return <section className="space-y-2"><div className="flex justify-between items-center"><h4 className="text-sm font-semibold text-slate-800">{title}</h4><button type="button" onClick={onAdd} className="text-xs font-semibold text-indigo-600 cursor-pointer">+ {t("common.add")}</button></div>{children}</section>;
}

function RuleScope({ disciplineId, locationId, disciplines, locations, onChange, t, compact = false }: { disciplineId: string | null; locationId: string | null; disciplines: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }>; onChange: (scope: { disciplineId: string | null; locationId: string | null }) => void; t: ReturnType<typeof useI18n>["t"]; compact?: boolean }) {
  const fields = <><AppSelect label={t("venueCosts.discipline")} value={disciplineId ?? ""} onChange={(e) => onChange({ disciplineId: e.target.value || null, locationId })}><option value="">{t("venueCosts.allDisciplines")}</option>{disciplines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</AppSelect><AppSelect label={t("venueCosts.location")} value={locationId ?? ""} onChange={(e) => onChange({ disciplineId, locationId: e.target.value || null })}><option value="">{t("venueCosts.allLocations")}</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</AppSelect></>;
  return compact ? fields : <div className="grid sm:grid-cols-2 gap-2">{fields}</div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field-stack"><span className={selectLabelCls}>{label}</span><input className={fieldCls} type="number" min={0} step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} /></label>;
}
function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field-stack"><span className={selectLabelCls}>{label}</span><input className={fieldCls} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} /></label>;
}
function IconDelete({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return <button type="button" onClick={onClick} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" aria-label={t("common.delete")}><Trash2 className="w-4 h-4" /></button>;
}
