import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useLocations } from "../../hooks/useLocations";
import { usePermissions } from "../../hooks/usePermissions";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import {
  useAcceptVenueCostRuleVersion,
  useSaveVenueCostRuleDraft,
  useVenueCostRuleStatus,
  useVenueCostRuleVersions,
} from "../../hooks/useVenueCosts";
import {
  validateVenueCostDraft,
  buildFixedLocationAmounts,
  isVenueCostFixedPerLocation,
  type VenueCostFixedRules,
  type VenueCostGroupRule,
  type VenueCostMode,
  type VenueCostPerLessonRules,
  type VenueCostPersonalRule,
  type VenueCostRuleDraft,
} from "../../lib/venueCostRules";
import { formatVenueCostDraftError, formatVenueCostDraftErrors } from "../../lib/venueCostDraftErrors";
import { useSettings } from "../SettingsProvider";
import AppSelect, { fieldCls, selectLabelCls } from "../../components/ui/AppSelect";
import { btnAddLinkCls, btnAddSoftCls, btnCancelCls, btnAddCls } from "../../components/ui/buttonStyles";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import VenueRuleExpiryNotice from "../../components/venue-costs/VenueRuleExpiryNotice";
import VenueCostGapResolutionPanel from "../../components/venue-costs/VenueCostGapResolutionPanel";
import VenueCostVersionHistoryRow from "../../components/venue-costs/VenueCostVersionHistoryRow";
import VenueCostGroupPreview from "../../components/venue-costs/VenueCostGroupPreview";
import VenueCostEstimatePanel from "../../components/venue-costs/VenueCostEstimatePanel";
import VenueCostBulkCopyPanel from "../../components/venue-costs/VenueCostBulkCopyPanel";
import { useToast } from "../../App";

const today = () => new Date().toISOString().slice(0, 10);

const defaultGroupRule = (): VenueCostGroupRule => ({
  teacherMemberId: null,
  disciplineId: null,
  locationId: null,
  attendanceTiers: [
    { minAttendees: 0, maxAttendees: 4, amount: 0 },
    { minAttendees: 5, maxAttendees: null, amount: 0 },
  ],
});

const defaultPersonalRule = (): VenueCostPersonalRule => ({
  teacherMemberId: null,
  disciplineId: null,
  locationId: null,
  amount: 0,
});

const emptyPerLessonRules = (currency: string): VenueCostPerLessonRules => ({
  currency,
  group: [],
  personal: [],
});

const emptyFixedRules = (currency: string): VenueCostFixedRules => ({
  currency,
  period: "month",
  amount: 0,
});

const newDraft = (): VenueCostRuleDraft => ({
  mode: "disabled",
  validFrom: today(),
  validTo: null,
  rules: {},
});

export default function VenueCostsSettingsPage({
  embedded = false,
  canManage: canManageProp,
}: {
  embedded?: boolean;
  canManage?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const { settings } = useSettings();
  const orgCurrency = settings?.currency_code || "RUB";
  const { role, can } = usePermissions();
  const canManage = canManageProp ?? (role === "owner" || role === "director");
  const canRead = can("finance.read");
  const statusQuery = useVenueCostRuleStatus();
  const versionsQuery = useVenueCostRuleVersions();
  const disciplinesQuery = useDisciplines();
  const locationsQuery = useLocations();
  const teamQuery = useTeamMembers();
  const saveDraft = useSaveVenueCostRuleDraft();
  const acceptVersion = useAcceptVenueCostRuleVersion();
  const [draft, setDraft] = useState<VenueCostRuleDraft | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const draftErrorRef = useRef<HTMLDivElement | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const editorPanelCls = embedded
    ? "space-y-4 border-t border-slate-100 pt-4"
    : "bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4";
  const historyPanelCls = embedded
    ? "space-y-3 border-t border-slate-100 pt-4"
    : "bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3";

  useEffect(() => {
    if (searchParams.get("new") !== "1" || !canManage || draft) return;
    setDraft(newDraft());
    setSearchParams({}, { replace: true });
  }, [searchParams, canManage, draft, setSearchParams]);

  const disciplines = disciplinesQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const teachers = useMemo(
    () =>
      (teamQuery.data ?? [])
        .filter(
          (member) =>
            member.is_active &&
            (member.role === "teacher" ||
              member.role === "owner" ||
              member.role === "director" ||
              member.role === "admin")
        )
        .map((member) => ({ id: member.id, label: memberListLabel(member) })),
    [teamQuery.data]
  );

  if (!canRead) {
    return (
      <div className={embedded ? "space-y-3" : "panel-card-stack max-w-4xl"}>
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
              ? { ...(base.rules as VenueCostPerLessonRules), currency: orgCurrency }
              : emptyPerLessonRules(orgCurrency)
            : mode === "fixed_period"
              ? base.mode === "fixed_period"
                ? { ...(base.rules as VenueCostFixedRules), currency: orgCurrency }
                : emptyFixedRules(orgCurrency)
              : {},
      };
    });
  };

  const handleSave = async () => {
    if (!draft || saveDraft.isPending) return;
    const draftToSave: VenueCostRuleDraft =
      draft.mode === "per_lesson"
        ? {
            ...draft,
            rules: { ...(draft.rules as VenueCostPerLessonRules), currency: orgCurrency },
          }
        : draft.mode === "fixed_period"
          ? {
              ...draft,
              rules: { ...(draft.rules as VenueCostFixedRules), currency: orgCurrency },
            }
          : draft;
    const errors = validateVenueCostDraft(draftToSave);
    if (errors.length) {
      setDraftErrors(errors);
      draftErrorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      toast(formatVenueCostDraftError(errors[0]!, t, "venueCosts.error.invalid"), "error");
      return;
    }
    setDraftErrors([]);
    const result = await saveDraft.mutateAsync({ draft: draftToSave, idempotencyKey: crypto.randomUUID() });
    if (!result.success) {
      const message = formatVenueCostDraftError(result.error, t, "venueCosts.error.saveFailed");
      toast(message, "error");
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
      toast(formatVenueCostDraftError(result.error, t, "venueCosts.error.acceptFailed"), "error");
      return;
    }
    toast(t("venueCosts.accepted"), result.alreadyApplied ? "info" : "success");
    setDraft(null);
  };

  if (
    statusQuery.isLoading ||
    versionsQuery.isLoading ||
    disciplinesQuery.isLoading ||
    locationsQuery.isLoading ||
    teamQuery.isLoading
  ) {
    return <LoadingState />;
  }
  const error =
    statusQuery.error ?? versionsQuery.error ?? disciplinesQuery.error ?? locationsQuery.error ?? teamQuery.error;
  if (error) return <QueryErrorState error={error} onRetry={() => void versionsQuery.refetch()} />;

  const versions = versionsQuery.data ?? [];
  const draftVersion = versions.find((item) => item.status === "draft") ?? null;
  const activeVersion =
    versions.find((item) => item.id === statusQuery.data?.currentRuleId && item.status === "accepted") ??
    versions.find((item) => item.status === "accepted") ??
    null;
  const teamMembers = teamQuery.data ?? [];
  const draftSnapshot = draft
    ? {
        mode: draft.mode,
        validFrom: draft.validFrom,
        validTo: draft.validTo,
        rules: draft.rules,
      }
    : null;

  return (
    <div className={embedded ? "space-y-4" : "panel-card-stack max-w-4xl"}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {!embedded && (
            <>
              <h2 className="text-base font-semibold text-slate-900">{t("venueCosts.pageTitle")}</h2>
              <p className="text-xs text-slate-500 mt-1">{t("venueCosts.pageSubtitle")}</p>
            </>
          )}
          {!embedded ? (
            <p className="text-xs text-slate-500 mt-1">{t("venueCosts.sectionHint")}</p>
          ) : null}
        </div>
        {canManage && !draft && (
          <button
            type="button"
            onClick={() => {
              setDraftErrors([]);
              setDraft(newDraft());
            }}
            className={btnAddSoftCls}
          >
            <Plus className="w-4 h-4" />
            {t("venueCosts.createRule")}
          </button>
        )}
      </div>

      {statusQuery.data?.acknowledgementRequired && canManage && statusQuery.data && (
        <VenueCostGapResolutionPanel
          status={statusQuery.data}
          canManage={canManage}
          draftVersionId={draftVersion?.id ?? null}
          onAcceptDraft={(versionId) => void handleAccept(versionId)}
          acceptPending={acceptVersion.isPending}
        />
      )}
      {statusQuery.data?.acknowledgementRequired && !canManage && (
        <VenueRuleExpiryNotice status={statusQuery.data} />
      )}

      {draft && canManage && (
        <section className={editorPanelCls}>
          <h3 className="text-sm font-semibold text-slate-900">{t("venueCosts.editorTitle")}</h3>
          {draftErrors.length > 0 ? (
            <div
              ref={draftErrorRef}
              className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 space-y-1"
              role="alert"
            >
              <p className="text-xs font-semibold text-rose-800">{t("venueCosts.error.validationTitle")}</p>
              <ul className="text-xs text-rose-700 list-disc pl-4 space-y-0.5">
                {formatVenueCostDraftErrors(draftErrors, t).map((message, index) => (
                  <li key={`${draftErrors[index]}-${index}`}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
            <FixedPeriodEditor draft={draft} setDraft={setDraft} locations={locations} t={t} />
          )}
          {draft.mode === "per_lesson" && (
            <PerLessonEditor
              draft={draft}
              setDraft={setDraft}
              disciplines={disciplines}
              locations={locations}
              teachers={teachers}
              t={t}
            />
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => {
                setDraftErrors([]);
                setDraft(null);
              }}
              disabled={saveDraft.isPending}
              className={btnCancelCls}
            >
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saveDraft.isPending} className={btnAddCls}>
              {saveDraft.isPending ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </section>
      )}

      <VenueCostEstimatePanel
        versions={versions}
        activeVersion={activeVersion}
        draftSnapshot={draftSnapshot}
        teachers={teachers}
        disciplines={disciplines}
        locations={locations}
        embedded={embedded}
      />

      <section className={historyPanelCls}>
        <h3 className="text-sm font-semibold text-slate-900">{t("venueCosts.history")}</h3>
        {versions.length === 0 ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-5 text-center space-y-3">
            <p className="text-sm text-slate-600">{t("venueCosts.empty")}</p>
            {canManage ? (
              <button
                type="button"
                onClick={() => {
                  setDraftErrors([]);
                  setDraft(newDraft());
                }}
                className={btnAddSoftCls}
              >
                <Plus className="w-4 h-4" />
                {t("venueCosts.emptyCta")}
              </button>
            ) : (
              <p className="text-xs text-slate-500">{t("venueCosts.emptyReadOnlyHint")}</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {versions.map((version) => (
              <VenueCostVersionHistoryRow
                key={version.id}
                version={version}
                activeVersion={activeVersion}
                canManage={canManage}
                hasOpenDraft={!!draft}
                teachers={teachers}
                disciplines={disciplines}
                locations={locations}
                teamMembers={teamMembers}
                onEditDraft={setDraft}
                onCopyToDraft={setDraft}
                onAccept={handleAccept}
                acceptPending={acceptVersion.isPending}
              />
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
  locations,
  t,
}: {
  draft: VenueCostRuleDraft;
  setDraft: (value: VenueCostRuleDraft) => void;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const rules = draft.rules as VenueCostFixedRules;
  const perLocation = isVenueCostFixedPerLocation(rules);

  const setScope = (nextPerLocation: boolean) => {
    if (nextPerLocation === perLocation) return;
    setDraft({
      ...draft,
      rules: nextPerLocation
        ? {
            ...rules,
            locations: buildFixedLocationAmounts(locations, rules.locations),
          }
        : { ...rules, locations: undefined },
    });
  };

  const updateLocationAmount = (locationId: string, amount: number) => {
    const rows = rules.locations ?? buildFixedLocationAmounts(locations, rules.locations);
    setDraft({
      ...draft,
      rules: {
        ...rules,
        locations: rows.map((row) => (row.locationId === locationId ? { ...row, amount } : row)),
      },
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className={selectLabelCls}>{t("venueCosts.fixedPeriod.scopeLabel")}</span>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="fixed-period-scope"
              checked={!perLocation}
              onChange={() => setScope(false)}
            />
            {t("venueCosts.fixedPeriod.orgWide")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="radio"
              name="fixed-period-scope"
              checked={perLocation}
              onChange={() => setScope(true)}
            />
            {t("venueCosts.fixedPeriod.perLocation")}
          </label>
        </div>
        <p className="text-[11px] text-slate-500">
          {perLocation ? t("venueCosts.fixedPeriod.perLocationHint") : t("venueCosts.fixedPeriod.orgWideHint")}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <AppSelect
          label={t("venueCosts.period")}
          value={rules.period}
          onChange={(e) =>
            setDraft({ ...draft, rules: { ...rules, period: e.target.value as VenueCostFixedRules["period"] } })
          }
        >
          <option value="week">{t("venueCosts.period.week")}</option>
          <option value="month">{t("venueCosts.period.month")}</option>
          <option value="custom">{t("venueCosts.period.custom")}</option>
        </AppSelect>
        {!perLocation ? (
          <MoneyInput
            label={t("venueCosts.amount")}
            value={rules.amount}
            onChange={(amount) => setDraft({ ...draft, rules: { ...rules, amount } })}
          />
        ) : null}
      </div>

      {perLocation ? (
        <div className="space-y-2 rounded-lg border border-slate-100 p-3">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
            {t("venueCosts.fixedPeriod.locationAmount")}
          </p>
          {locations.length === 0 ? (
            <p className="text-xs text-slate-500">{t("venueCosts.fixedPeriod.noLocations")}</p>
          ) : (
            <ul className="space-y-2">
              {buildFixedLocationAmounts(locations, rules.locations).map((row) => (
                <li key={row.locationId} className="flex items-center gap-3">
                  <span className="text-sm text-slate-700 min-w-0 flex-1 truncate">
                    {locations.find((loc) => loc.id === row.locationId)?.name}
                  </span>
                  <MoneyInput
                    label=""
                    value={row.amount}
                    onChange={(amount) => updateLocationAmount(row.locationId, amount)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PerLessonEditor({
  draft,
  setDraft,
  disciplines,
  locations,
  teachers,
  t,
}: {
  draft: VenueCostRuleDraft;
  setDraft: (value: VenueCostRuleDraft) => void;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  teachers: Array<{ id: string; label: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const rules = draft.rules as VenueCostPerLessonRules;
  const updateRules = (next: VenueCostPerLessonRules) => setDraft({ ...draft, rules: next });
  const groupEnabled = rules.group.length > 0;
  const personalEnabled = rules.personal.length > 0;

  const setGroupEnabled = (enabled: boolean) => {
    updateRules({
      ...rules,
      group: enabled ? (rules.group.length ? rules.group : [defaultGroupRule()]) : [],
    });
  };

  const setPersonalEnabled = (enabled: boolean) => {
    updateRules({
      ...rules,
      personal: enabled ? (rules.personal.length ? rules.personal : [defaultPersonalRule()]) : [],
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">{t("venueCosts.applyTypesHint")}</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={groupEnabled}
              onChange={(e) => setGroupEnabled(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            {t("venueCosts.groupRules")}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={personalEnabled}
              onChange={(e) => setPersonalEnabled(e.target.checked)}
              className="rounded border-slate-300 text-indigo-600"
            />
            {t("venueCosts.personalRules")}
          </label>
        </div>
      </div>

      {(groupEnabled || personalEnabled) && (
        <p className="text-[11px] text-slate-500">{t("venueCosts.teacherRequiredHint")}</p>
      )}

      {groupEnabled && (
        <RuleSection
          title={t("venueCosts.groupRules")}
          onAdd={() =>
            updateRules({
              ...rules,
              group: [...rules.group, defaultGroupRule()],
            })
          }
        >
          {rules.group.map((rule, ruleIndex) => (
            <div key={ruleIndex} className="rounded-xl border border-slate-200 p-3 space-y-3">
              <RuleScope
                teacherMemberId={rule.teacherMemberId}
                disciplineId={rule.disciplineId}
                locationId={rule.locationId}
                disciplines={disciplines}
                locations={locations}
                teachers={teachers}
                t={t}
                onChange={(scope) =>
                  updateRules({
                    ...rules,
                    group: rules.group.map((item, index) => (index === ruleIndex ? { ...item, ...scope } : item)),
                  })
                }
              />
              {rule.attendanceTiers.map((tier, tierIndex) => (
                <div key={tierIndex} className="grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 items-end">
                  <MoneyInput
                    label={t("venueCosts.tierMin")}
                    value={tier.minAttendees}
                    onChange={(value) =>
                      updateRules({
                        ...rules,
                        group: rules.group.map((item, index) =>
                          index === ruleIndex
                            ? {
                                ...item,
                                attendanceTiers: item.attendanceTiers.map((part, idx) =>
                                  idx === tierIndex ? { ...part, minAttendees: value } : part
                                ),
                              }
                            : item
                        ),
                      })
                    }
                  />
                  <label className="field-stack">
                    <span className={selectLabelCls}>{t("venueCosts.tierMax")}</span>
                    <input
                      className={fieldCls}
                      type="number"
                      min={0}
                      value={tier.maxAttendees ?? ""}
                      onChange={(e) =>
                        updateRules({
                          ...rules,
                          group: rules.group.map((item, index) =>
                            index === ruleIndex
                              ? {
                                  ...item,
                                  attendanceTiers: item.attendanceTiers.map((part, idx) =>
                                    idx === tierIndex
                                      ? { ...part, maxAttendees: e.target.value === "" ? null : Number(e.target.value) }
                                      : part
                                  ),
                                }
                              : item
                          ),
                        })
                      }
                    />
                  </label>
                  <MoneyInput
                    label={t("venueCosts.amount")}
                    value={tier.amount}
                    onChange={(amount) =>
                      updateRules({
                        ...rules,
                        group: rules.group.map((item, index) =>
                          index === ruleIndex
                            ? {
                                ...item,
                                attendanceTiers: item.attendanceTiers.map((part, idx) =>
                                  idx === tierIndex ? { ...part, amount } : part
                                ),
                              }
                            : item
                        ),
                      })
                    }
                  />
                  <IconDelete
                    onClick={() =>
                      updateRules({
                        ...rules,
                        group: rules.group.map((item, index) =>
                          index === ruleIndex
                            ? { ...item, attendanceTiers: item.attendanceTiers.filter((_, idx) => idx !== tierIndex) }
                            : item
                        ),
                      })
                    }
                  />
                </div>
              ))}
              <div className="flex justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const last = rule.attendanceTiers.at(-1);
                    const min = last?.maxAttendees == null ? 0 : last.maxAttendees + 1;
                    updateRules({
                      ...rules,
                      group: rules.group.map((item, index) =>
                        index === ruleIndex
                          ? {
                              ...item,
                              attendanceTiers: [...item.attendanceTiers, { minAttendees: min, maxAttendees: null, amount: 0 }],
                            }
                          : item
                      ),
                    });
                  }}
                  className={btnAddLinkCls}
                >
                  {t("venueCosts.addTier")}
                </button>
                <IconDelete
                  onClick={() => {
                    const nextGroup = rules.group.filter((_, index) => index !== ruleIndex);
                    updateRules({ ...rules, group: nextGroup });
                  }}
                />
              </div>
            </div>
          ))}
        </RuleSection>
      )}

      {personalEnabled && (
        <RuleSection
          title={t("venueCosts.personalRules")}
          onAdd={() =>
            updateRules({
              ...rules,
              personal: [...rules.personal, defaultPersonalRule()],
            })
          }
        >
          {rules.personal.map((rule, index) => (
            <div key={index} className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 space-y-2">
              <div className="grid sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end">
                <RuleScope
                  compact
                  teacherMemberId={rule.teacherMemberId}
                  disciplineId={rule.disciplineId}
                  locationId={rule.locationId}
                  disciplines={disciplines}
                  locations={locations}
                  teachers={teachers}
                  t={t}
                  onChange={(scope) =>
                    updateRules({
                      ...rules,
                      personal: rules.personal.map((item, idx) => (idx === index ? { ...item, ...scope } : item)),
                    })
                  }
                />
                <MoneyInput
                  label={t("venueCosts.amount")}
                  value={rule.amount}
                  onChange={(amount) =>
                    updateRules({
                      ...rules,
                      personal: rules.personal.map((item, idx) => (idx === index ? { ...item, amount } : item)),
                    })
                  }
                />
                <IconDelete
                  onClick={() => {
                    const nextPersonal = rules.personal.filter((_, idx) => idx !== index);
                    updateRules({ ...rules, personal: nextPersonal });
                  }}
                />
              </div>
            </div>
          ))}
        </RuleSection>
      )}

      {(groupEnabled || personalEnabled) && (
        <VenueCostBulkCopyPanel
          rules={rules}
          teachers={teachers}
          disciplines={disciplines}
          locations={locations}
          onApply={(next) => updateRules(next)}
        />
      )}

      {groupEnabled && (
        <VenueCostGroupPreview
          rules={rules}
          teachers={teachers}
          disciplines={disciplines}
          locations={locations}
        />
      )}
    </div>
  );
}

function RuleSection({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <button type="button" onClick={onAdd} className={btnAddLinkCls}>
          + {t("common.add")}
        </button>
      </div>
      {children}
    </section>
  );
}

function RuleScope({
  teacherMemberId,
  disciplineId,
  locationId,
  disciplines,
  locations,
  teachers,
  onChange,
  t,
  compact = false,
}: {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  teachers: Array<{ id: string; label: string }>;
  onChange: (scope: {
    teacherMemberId: string | null;
    disciplineId: string | null;
    locationId: string | null;
  }) => void;
  t: ReturnType<typeof useI18n>["t"];
  compact?: boolean;
}) {
  const fields = (
    <>
      <AppSelect
        label={t("venueCosts.teacher")}
        value={teacherMemberId ?? ""}
        onChange={(e) =>
          onChange({ teacherMemberId: e.target.value || null, disciplineId, locationId })
        }
      >
        <option value="">{t("venueCosts.selectTeacher")}</option>
        {teachers.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </AppSelect>
      <AppSelect
        label={t("venueCosts.discipline")}
        value={disciplineId ?? ""}
        onChange={(e) =>
          onChange({ teacherMemberId, disciplineId: e.target.value || null, locationId })
        }
      >
        <option value="">{t("venueCosts.allDisciplines")}</option>
        {disciplines.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </AppSelect>
      <AppSelect
        label={t("venueCosts.location")}
        value={locationId ?? ""}
        onChange={(e) =>
          onChange({ teacherMemberId, disciplineId, locationId: e.target.value || null })
        }
      >
        <option value="">{t("venueCosts.allLocations")}</option>
        {locations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </AppSelect>
    </>
  );
  return compact ? fields : <div className="grid sm:grid-cols-3 gap-2">{fields}</div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="field-stack">
      <span className={selectLabelCls}>{label}</span>
      <input className={fieldCls} type="number" min={0} step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}
function IconDelete({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onClick} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer" aria-label={t("common.delete")}>
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
