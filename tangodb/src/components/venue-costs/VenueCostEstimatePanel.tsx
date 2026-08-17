import { useMemo, useState } from "react";
import { Calculator } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import {
  useVenueCostEstimate,
  type VenueCostEstimateSource,
} from "../../hooks/useVenueCostEstimate";
import type { VenueCostRuleVersion } from "../../hooks/useVenueCosts";
import {
  defaultVenueCostEstimatePeriod,
  type VenueCostMatchReason,
} from "../../lib/venueCostEstimate";
import type { VenueCostVersionSnapshot } from "../../lib/venueCostRules";
import { formatCurrency } from "../../lib/utils";
import AppSelect, { fieldCls, selectLabelCls } from "../ui/AppSelect";

interface VenueCostEstimatePanelProps {
  versions: VenueCostRuleVersion[];
  activeVersion: VenueCostRuleVersion | null;
  draftSnapshot: VenueCostVersionSnapshot | null;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  embedded?: boolean;
}

function versionToSnapshot(version: VenueCostRuleVersion): VenueCostVersionSnapshot {
  return {
    mode: version.mode,
    validFrom: version.validFrom,
    validTo: version.validTo,
    expenseCategory: version.expenseCategory,
    payee: version.payee,
    rules: version.rules,
  };
}

export default function VenueCostEstimatePanel({
  versions,
  activeVersion,
  draftSnapshot,
  teachers,
  disciplines,
  locations,
  embedded = false,
}: VenueCostEstimatePanelProps) {
  const { t, formatDate } = useI18n();
  const defaultPeriod = useMemo(() => defaultVenueCostEstimatePeriod(), []);

  const [rulesSource, setRulesSource] = useState<"active" | "draft">("active");
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);
  const [source, setSource] = useState<VenueCostEstimateSource>("schedule");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [disciplineId, setDisciplineId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [groupLessonCount, setGroupLessonCount] = useState(12);
  const [personalLessonCount, setPersonalLessonCount] = useState(4);
  const [groupAttendeeCount, setGroupAttendeeCount] = useState(4);
  const [defaultScheduleAttendees, setDefaultScheduleAttendees] = useState(4);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const snapshot = useMemo((): VenueCostVersionSnapshot | null => {
    if (rulesSource === "draft" && draftSnapshot) return draftSnapshot;
    if (activeVersion) return versionToSnapshot(activeVersion);
    const accepted = versions.find((item) => item.status === "accepted");
    return accepted ? versionToSnapshot(accepted) : null;
  }, [rulesSource, draftSnapshot, activeVersion, versions]);

  const filters = useMemo(
    () => ({
      teacherMemberId: teacherMemberId || null,
      disciplineId: disciplineId || null,
      locationId: locationId || null,
    }),
    [teacherMemberId, disciplineId, locationId]
  );

  const manual = useMemo(
    () => ({
      groupLessonCount: Math.max(0, groupLessonCount),
      personalLessonCount: Math.max(0, personalLessonCount),
      groupAttendeeCount: Math.max(0, groupAttendeeCount),
      teacherMemberId: teacherMemberId || null,
      disciplineId: disciplineId || null,
      locationId: locationId || null,
    }),
    [
      groupLessonCount,
      personalLessonCount,
      groupAttendeeCount,
      teacherMemberId,
      disciplineId,
      locationId,
    ]
  );

  const { result, lessonCount, isLoading } = useVenueCostEstimate({
    snapshot,
    periodStart,
    periodEnd,
    source,
    filters,
    manual: source === "manual" ? manual : undefined,
    defaultGroupAttendees: defaultScheduleAttendees,
    enabled: Boolean(snapshot),
  });

  const reasonLabel = (reason: VenueCostMatchReason): string => {
    switch (reason) {
      case "matched":
        return t("venueCosts.estimate.reason.matched");
      case "no_rule":
        return t("venueCosts.estimate.reason.noRule");
      case "no_tier":
        return t("venueCosts.estimate.reason.noTier");
      case "mode_disabled":
        return t("venueCosts.estimate.reason.disabled");
      case "mode_fixed_period":
        return t("venueCosts.estimate.reason.fixedPerLesson");
      default:
        return reason;
    }
  };

  const panelCls = embedded
    ? "space-y-4 border-t border-slate-100 pt-4"
    : "bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4";

  if (!versions.length && !draftSnapshot) return null;

  return (
    <section className={panelCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-slate-500" />
            {t("venueCosts.estimate.title")}
          </h3>
          <p className="text-xs text-slate-500 mt-1">{t("venueCosts.estimate.subtitle")}</p>
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 mt-2 inline-block">
            {t("venueCosts.estimate.forecastBadge")}
          </p>
        </div>
      </div>

      {!snapshot ? (
        <p className="text-sm text-slate-500">{t("venueCosts.estimate.noRules")}</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {draftSnapshot ? (
              <AppSelect
                label={t("venueCosts.estimate.rulesSource")}
                value={rulesSource}
                onChange={(e) => setRulesSource(e.target.value as "active" | "draft")}
              >
                <option value="active">{t("venueCosts.estimate.rulesActive")}</option>
                <option value="draft">{t("venueCosts.estimate.rulesDraft")}</option>
              </AppSelect>
            ) : null}
            <label className="field-stack">
              <span className={selectLabelCls}>{t("venueCosts.estimate.periodFrom")}</span>
              <input
                className={fieldCls}
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </label>
            <label className="field-stack">
              <span className={selectLabelCls}>{t("venueCosts.estimate.periodTo")}</span>
              <input
                className={fieldCls}
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </label>
            <AppSelect
              label={t("venueCosts.estimate.dataSource")}
              value={source}
              onChange={(e) => setSource(e.target.value as VenueCostEstimateSource)}
            >
              <option value="schedule">{t("venueCosts.estimate.sourceSchedule")}</option>
              <option value="manual">{t("venueCosts.estimate.sourceManual")}</option>
            </AppSelect>
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <AppSelect
              label={t("venueCosts.teacher")}
              value={teacherMemberId}
              onChange={(e) => setTeacherMemberId(e.target.value)}
            >
              <option value="">{t("venueCosts.allTeachers")}</option>
              {teachers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </AppSelect>
            <AppSelect
              label={t("venueCosts.discipline")}
              value={disciplineId}
              onChange={(e) => setDisciplineId(e.target.value)}
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
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t("venueCosts.allLocations")}</option>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </AppSelect>
          </div>

          {source === "manual" ? (
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="field-stack">
                <span className={selectLabelCls}>{t("venueCosts.estimate.groupLessons")}</span>
                <input
                  className={fieldCls}
                  type="number"
                  min={0}
                  value={groupLessonCount}
                  onChange={(e) => setGroupLessonCount(Number(e.target.value) || 0)}
                />
              </label>
              <label className="field-stack">
                <span className={selectLabelCls}>{t("venueCosts.estimate.personalLessons")}</span>
                <input
                  className={fieldCls}
                  type="number"
                  min={0}
                  value={personalLessonCount}
                  onChange={(e) => setPersonalLessonCount(Number(e.target.value) || 0)}
                />
              </label>
              <label className="field-stack">
                <span className={selectLabelCls}>{t("venueCosts.estimate.groupAttendees")}</span>
                <input
                  className={fieldCls}
                  type="number"
                  min={0}
                  value={groupAttendeeCount}
                  onChange={(e) => setGroupAttendeeCount(Number(e.target.value) || 0)}
                />
              </label>
            </div>
          ) : (
            <label className="field-stack max-w-xs">
              <span className={selectLabelCls}>{t("venueCosts.estimate.defaultAttendees")}</span>
              <input
                className={fieldCls}
                type="number"
                min={0}
                value={defaultScheduleAttendees}
                onChange={(e) => setDefaultScheduleAttendees(Number(e.target.value) || 0)}
              />
              <span className="text-[11px] text-slate-400">{t("venueCosts.estimate.defaultAttendeesHint")}</span>
            </label>
          )}

          <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">{t("venueCosts.estimate.totalLabel")}</p>
              <p className="text-xl font-semibold text-slate-900">
                {isLoading
                  ? t("common.loading.data")
                  : result
                    ? formatCurrency(result.total)
                    : "—"}
              </p>
            </div>
            <div className="text-xs text-slate-500 space-y-0.5 text-right">
              {result?.mode === "per_lesson" ? (
                <p>{t("venueCosts.estimate.lessonCount", { count: lessonCount })}</p>
              ) : null}
              {result?.mode === "fixed_period" ? (
                <p>
                  {t("venueCosts.estimate.fixedPeriodCount", {
                    count: result.fixedPeriodLines.length,
                  })}
                </p>
              ) : null}
            </div>
          </div>

          {result && (result.lessonLines.length > 0 || result.fixedPeriodLines.length > 0) ? (
            <div>
              <button
                type="button"
                onClick={() => setShowBreakdown((value) => !value)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                {showBreakdown
                  ? t("venueCosts.estimate.hideBreakdown")
                  : t("venueCosts.estimate.showBreakdown")}
              </button>
              {showBreakdown ? (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">{t("venueCosts.estimate.colDate")}</th>
                        <th className="px-3 py-2 text-left font-semibold">{t("venueCosts.estimate.colKind")}</th>
                        <th className="px-3 py-2 text-left font-semibold">{t("venueCosts.estimate.colLabel")}</th>
                        <th className="px-3 py-2 text-right font-semibold">{t("venueCosts.amount")}</th>
                        <th className="px-3 py-2 text-left font-semibold">{t("venueCosts.estimate.colReason")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.fixedPeriodLines.map((line) => (
                        <tr key={`fixed-${line.periodFrom}-${line.periodTo}-${line.locationId ?? "org"}`}>
                          <td className="px-3 py-2 text-slate-700">
                            {formatDate(line.periodFrom)} — {formatDate(line.periodTo)}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{t("venueCosts.mode.fixedPeriod")}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {line.locationId
                              ? locations.find((loc) => loc.id === line.locationId)?.name ?? line.locationId
                              : t("venueCosts.fixedPeriod.orgWide")}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatCurrency(line.amount)}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{t("venueCosts.estimate.reason.matched")}</td>
                        </tr>
                      ))}
                      {result.lessonLines.map((line) => (
                        <tr key={line.lessonId}>
                          <td className="px-3 py-2 text-slate-700">{formatDate(line.date)}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {line.kind === "group"
                              ? t("venueCosts.estimate.kindGroup")
                              : t("venueCosts.estimate.kindPersonal")}
                          </td>
                          <td className="px-3 py-2 text-slate-600 truncate max-w-[12rem]">
                            {line.label ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {formatCurrency(line.amount)}
                          </td>
                          <td className="px-3 py-2 text-slate-500">
                            {reasonLabel(line.reason)}
                            {line.ruleScope ? (
                              <span className="block text-[10px] text-slate-400">{line.ruleScope}</span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
