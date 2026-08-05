import { useState } from "react";
import { Check, ChevronDown, Copy, Edit, StopCircle, Trash2 } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useEndVenueCostRuleEarly, type VenueCostRuleVersion } from "../../hooks/useVenueCosts";
import ConfirmDialog from "../ui/ConfirmDialog";
import { memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import {
  diffVenueCostVersions,
  isVenueCostFixedPerLocation,
  type VenueCostDiffEntry,
  type VenueCostFixedRules,
  type VenueCostGroupRule,
  type VenueCostPerLessonRules,
  type VenueCostPersonalRule,
  type VenueCostRuleDraft,
} from "../../lib/venueCostRules";
import { expenseCategoryKey } from "../../lib/expenseCategories";
import { formatCurrency } from "../../lib/utils";

interface VenueCostVersionHistoryRowProps {
  version: VenueCostRuleVersion;
  activeVersion: VenueCostRuleVersion | null;
  canManage: boolean;
  hasOpenDraft: boolean;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  teamMembers: TeamMemberRow[];
  onEditDraft: (draft: VenueCostRuleDraft) => void;
  onCopyToDraft: (draft: VenueCostRuleDraft) => void;
  onAccept: (versionId: string) => void;
  acceptPending: boolean;
  onDeleteDraft?: (versionId: string) => void;
  deleteDraftPending?: boolean;
  endEarlyPending?: boolean;
  onEndEarly?: (versionId: string) => void;
}

function versionSnapshot(version: VenueCostRuleVersion) {
  return {
    mode: version.mode,
    validFrom: version.validFrom,
    validTo: version.validTo,
    expenseCategory: version.expenseCategory,
    payee: version.payee,
    rules: version.rules,
  };
}

function resolveScopeLabel(
  key: string,
  teachers: Array<{ id: string; label: string }>,
  disciplines: Array<{ id: string; name: string }>,
  locations: Array<{ id: string; name: string }>,
  t: ReturnType<typeof useI18n>["t"]
): string {
  const [section, teacherId, disciplineId, locationId] = key.split(":");
  const teacher =
    teacherId === "*" ? t("venueCosts.allTeachers") : teachers.find((item) => item.id === teacherId)?.label ?? teacherId;
  const discipline =
    disciplineId === "*"
      ? t("venueCosts.allDisciplines")
      : disciplines.find((item) => item.id === disciplineId)?.name ?? disciplineId;
  const location =
    locationId === "*"
      ? t("venueCosts.allLocations")
      : locations.find((item) => item.id === locationId)?.name ?? locationId;
  const sectionLabel =
    section === "group" ? t("venueCosts.groupRules") : section === "personal" ? t("venueCosts.personalRules") : key;
  return `${sectionLabel}: ${teacher} · ${discipline} · ${location}`;
}

function diffEntryLabel(
  entry: VenueCostDiffEntry,
  teachers: Array<{ id: string; label: string }>,
  disciplines: Array<{ id: string; name: string }>,
  locations: Array<{ id: string; name: string }>,
  t: ReturnType<typeof useI18n>["t"]
): string {
  if (entry.section === "meta") {
    if (entry.key === "mode") return t("venueCosts.diff.field.mode");
    if (entry.key === "validFrom") return t("venueCosts.diff.field.validFrom");
    if (entry.key === "validTo") return t("venueCosts.diff.field.validTo");
    if (entry.key === "expenseCategory") return t("venueCosts.diff.field.expenseCategory");
    if (entry.key === "payee") return t("venueCosts.diff.field.payee");
    return t("venueCosts.diff.field.version");
  }
  if (entry.section === "fixed") return t("venueCosts.diff.field.fixedPeriod");
  return resolveScopeLabel(entry.key, teachers, disciplines, locations, t);
}

function VersionSummary({
  version,
  teachers,
  disciplines,
  locations,
  t,
}: {
  version: VenueCostRuleVersion;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (version.mode === "disabled") {
    return <p className="text-xs text-slate-500 mt-1.5 ml-6">{t("venueCosts.mode.disabled")}</p>;
  }

  const accountingLine = (
    <li className="text-slate-500">
      {t("venueCosts.expenseCategory")}: {t(expenseCategoryKey(version.expenseCategory))}
      {version.payee ? ` · ${t("venueCosts.payee")}: ${version.payee}` : null}
    </li>
  );

  if (version.mode === "fixed_period") {
    const rules = version.rules as VenueCostFixedRules;
    if (isVenueCostFixedPerLocation(rules)) {
      return (
        <ul className="text-xs text-slate-600 mt-1.5 ml-6 space-y-0.5">
          {accountingLine}
          <li className="text-slate-500">
            {t(`venueCosts.period.${rules.period}`)} · {t("venueCosts.fixedPeriod.perLocation")}
          </li>
          {(rules.locations ?? []).map((row) => (
            <li key={row.locationId}>
              {locations.find((loc) => loc.id === row.locationId)?.name ?? row.locationId}:{" "}
              {formatCurrency(row.amount)}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <ul className="text-xs text-slate-600 mt-1.5 ml-6 space-y-0.5">
        {accountingLine}
        <li>
          {t(`venueCosts.period.${rules.period}`)} · {formatCurrency(rules.amount)} ·{" "}
          {t("venueCosts.fixedPeriod.orgWide")}
        </li>
      </ul>
    );
  }

  const rules = version.rules as VenueCostPerLessonRules;
  if (!rules.group.length && !rules.personal.length) {
    return (
      <ul className="text-xs text-slate-600 mt-1.5 ml-6 space-y-0.5">
        {accountingLine}
        <li className="text-amber-700">{t("venueCosts.summary.emptyPerLesson")}</li>
      </ul>
    );
  }

  return (
    <ul className="text-xs text-slate-600 mt-1.5 ml-6 space-y-1">
      {accountingLine}
      {rules.group.map((rule, index) => (
        <li key={`g-${index}`}>
          <span className="font-medium text-slate-700">{t("venueCosts.groupRules")}:</span>{" "}
          <ScopeReadOnly
            inline
            teacherMemberId={rule.teacherMemberId}
            disciplineId={rule.disciplineId}
            locationId={rule.locationId}
            teachers={teachers}
            disciplines={disciplines}
            locations={locations}
            t={t}
          />
          <span className="text-slate-500">
            {" "}
            ·{" "}
            {rule.attendanceTiers
              .map((tier) => `${tier.minAttendees}–${tier.maxAttendees ?? "∞"}: ${formatCurrency(tier.amount)}`)
              .join("; ")}
          </span>
        </li>
      ))}
      {rules.personal.map((rule, index) => (
        <li key={`p-${index}`}>
          <span className="font-medium text-slate-700">{t("venueCosts.personalRules")}:</span>{" "}
          <ScopeReadOnly
            inline
            teacherMemberId={rule.teacherMemberId}
            disciplineId={rule.disciplineId}
            locationId={rule.locationId}
            teachers={teachers}
            disciplines={disciplines}
            locations={locations}
            t={t}
          />
          <span className="text-slate-500"> · {formatCurrency(rule.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function ScopeReadOnly({
  teacherMemberId,
  disciplineId,
  locationId,
  teachers,
  disciplines,
  locations,
  t,
  inline = false,
}: {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
  inline?: boolean;
}) {
  const teacherLabel = teacherMemberId
    ? teachers.find((item) => item.id === teacherMemberId)?.label ?? teacherMemberId
    : t("venueCosts.allTeachers");
  const disciplineLabel = disciplineId
    ? disciplines.find((item) => item.id === disciplineId)?.name ?? disciplineId
    : t("venueCosts.allDisciplines");
  const locationLabel = locationId
    ? locations.find((item) => item.id === locationId)?.name ?? locationId
    : t("venueCosts.allLocations");
  const text = `${disciplineLabel} · ${locationLabel}`;
  if (inline) {
    return <span>{text}</span>;
  }
  return (
    <p className="text-xs text-slate-600">
      {teacherLabel} · {disciplineLabel} · {locationLabel}
    </p>
  );
}

function GroupRuleReadOnly({
  rule,
  teachers,
  disciplines,
  locations,
  t,
}: {
  rule: VenueCostGroupRule;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 space-y-1.5">
      <ScopeReadOnly
        teacherMemberId={rule.teacherMemberId}
        disciplineId={rule.disciplineId}
        locationId={rule.locationId}
        teachers={teachers}
        disciplines={disciplines}
        locations={locations}
        t={t}
      />
      <ul className="space-y-0.5">
        {rule.attendanceTiers.map((tier, index) => (
          <li key={index} className="text-[11px] text-slate-500 font-mono">
            {tier.minAttendees}–{tier.maxAttendees ?? "∞"} → {formatCurrency(tier.amount)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonalRuleReadOnly({
  rule,
  teachers,
  disciplines,
  locations,
  t,
}: {
  rule: VenueCostPersonalRule;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-2.5 space-y-1">
      <ScopeReadOnly
        teacherMemberId={rule.teacherMemberId}
        disciplineId={rule.disciplineId}
        locationId={rule.locationId}
        teachers={teachers}
        disciplines={disciplines}
        locations={locations}
        t={t}
      />
      <p className="text-xs text-slate-700">{formatCurrency(rule.amount)}</p>
    </div>
  );
}

function VersionDetails({
  version,
  teachers,
  disciplines,
  locations,
  t,
}: {
  version: VenueCostRuleVersion;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
}) {
  if (version.mode === "disabled") {
    return <p className="text-xs text-slate-500">{t("venueCosts.mode.disabled")}</p>;
  }

  const accountingBlock = (
    <p className="text-xs text-slate-600">
      {t("venueCosts.expenseCategory")}: {t(expenseCategoryKey(version.expenseCategory))}
      {version.payee ? ` · ${t("venueCosts.payee")}: ${version.payee}` : null}
    </p>
  );

  if (version.mode === "fixed_period") {
    const rules = version.rules as VenueCostFixedRules;
    if (isVenueCostFixedPerLocation(rules)) {
      return (
        <div className="text-xs text-slate-600 space-y-1">
          {accountingBlock}
          <p>
            {t(`venueCosts.period.${rules.period}`)} · {t("venueCosts.fixedPeriod.perLocation")} ({rules.currency})
          </p>
          <ul className="space-y-0.5">
            {(rules.locations ?? []).map((row) => (
              <li key={row.locationId}>
                {locations.find((loc) => loc.id === row.locationId)?.name ?? row.locationId}:{" "}
                {formatCurrency(row.amount)}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="text-xs text-slate-600 space-y-1">
        {accountingBlock}
        <p>
          {t(`venueCosts.period.${rules.period}`)} · {formatCurrency(rules.amount)} ({rules.currency})
        </p>
        <p className="text-slate-500">{t("venueCosts.fixedPeriod.orgWide")}</p>
      </div>
    );
  }

  const rules = version.rules as VenueCostPerLessonRules;
  return (
    <div className="space-y-3">
      {accountingBlock}
      {rules.group.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">{t("venueCosts.groupRules")}</h4>
          {rules.group.map((rule, index) => (
            <GroupRuleReadOnly
              key={index}
              rule={rule}
              teachers={teachers}
              disciplines={disciplines}
              locations={locations}
              t={t}
            />
          ))}
        </div>
      )}
      {rules.personal.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-700">{t("venueCosts.personalRules")}</h4>
          {rules.personal.map((rule, index) => (
            <PersonalRuleReadOnly
              key={index}
              rule={rule}
              teachers={teachers}
              disciplines={disciplines}
              locations={locations}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function VenueCostVersionHistoryRow({
  version,
  activeVersion,
  canManage,
  hasOpenDraft,
  teachers,
  disciplines,
  locations,
  teamMembers,
  onEditDraft,
  onCopyToDraft,
  onAccept,
  acceptPending,
  onDeleteDraft,
  deleteDraftPending = false,
  endEarlyPending = false,
  onEndEarly,
}: VenueCostVersionHistoryRowProps) {
  const { t, formatDate, formatDateTime } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
  const [deleteDraftOpen, setDeleteDraftOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const isCurrentlyActive =
    version.status === "accepted" &&
    activeVersion?.id === version.id &&
    version.validFrom <= today &&
    (version.validTo == null || version.validTo >= today);
  const canEndEarly =
    canManage && isCurrentlyActive && version.validTo !== today && Boolean(onEndEarly);

  const acceptedByMember = version.acceptedBy
    ? teamMembers.find((member) => member.id === version.acceptedBy)
    : null;
  const acceptedByLabel = acceptedByMember ? memberListLabel(acceptedByMember) : null;

  const modeLabel = t(
    `venueCosts.mode.${version.mode === "per_lesson" ? "perLesson" : version.mode === "fixed_period" ? "fixedPeriod" : "disabled"}`
  );

  const draftFromVersion: VenueCostRuleDraft = {
    id: version.status === "draft" ? version.id : undefined,
    mode: version.mode,
    validFrom: version.validFrom,
    validTo: version.validTo,
    expenseCategory: version.expenseCategory,
    payee: version.payee === "—" ? "" : version.payee,
    rules: structuredClone(version.rules),
  };

  const diffEntries =
    version.status === "draft" && activeVersion
      ? diffVenueCostVersions(versionSnapshot(version), versionSnapshot(activeVersion))
      : [];

  const diffKindClass = (kind: VenueCostDiffEntry["kind"]) => {
    if (kind === "added") return "text-emerald-700 bg-emerald-50";
    if (kind === "removed") return "text-rose-700 bg-rose-50";
    return "text-amber-700 bg-amber-50";
  };

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="min-w-0 flex-1 text-left cursor-pointer group"
          aria-expanded={expanded}
        >
          <div className="flex items-start gap-2">
            <ChevronDown
              className={`w-4 h-4 mt-0.5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-700">
                {t("venueCosts.version", { version: version.versionNumber })} · {modeLabel}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {formatDate(version.validFrom)} — {version.validTo ? formatDate(version.validTo) : "∞"} ·{" "}
                {t(`venueCosts.status.${version.status}`)}
              </p>
              {version.status === "accepted" && version.acceptedAt && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("venueCosts.acceptedBy", {
                    name: acceptedByLabel ?? t("venueCosts.unknownMember"),
                    date: formatDateTime(version.acceptedAt),
                  })}
                </p>
              )}
            </div>
          </div>
        </button>

        {canManage && (
          <div className="flex gap-1 shrink-0">
            {version.status === "draft" && (
              <>
                <button
                  type="button"
                  onClick={() => onEditDraft(draftFromVersion)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer"
                  aria-label={t("common.edit")}
                >
                  <Edit className="w-4 h-4" />
                </button>
                {onDeleteDraft && (
                  <button
                    type="button"
                    onClick={() => setDeleteDraftOpen(true)}
                    disabled={deleteDraftPending}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer disabled:opacity-60"
                    aria-label={t("venueCosts.deleteDraft")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onAccept(version.id)}
                  disabled={acceptPending}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  <Check className="w-3.5 h-3.5" />
                  {t("venueCosts.accept")}
                </button>
              </>
            )}
            {version.status === "accepted" && !hasOpenDraft && (
              <button
                type="button"
                onClick={() => onCopyToDraft(draftFromVersion)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                {t("venueCosts.copyToDraft")}
              </button>
            )}
            {canEndEarly && (
              <button
                type="button"
                onClick={() => setEndEarlyOpen(true)}
                disabled={endEarlyPending}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-50 cursor-pointer disabled:opacity-60"
              >
                <StopCircle className="w-3.5 h-3.5" />
                {t("venueCosts.endEarly")}
              </button>
            )}
          </div>
        )}
      </div>

      <VersionSummary
        version={version}
        teachers={teachers}
        disciplines={disciplines}
        locations={locations}
        t={t}
      />

      <ConfirmDialog
        open={deleteDraftOpen}
        title={t("venueCosts.deleteDraftConfirm.title")}
        description={t("venueCosts.deleteDraftConfirm.body")}
        confirmLabel={t("venueCosts.deleteDraftConfirm.confirm")}
        pending={deleteDraftPending}
        onCancel={() => setDeleteDraftOpen(false)}
        onConfirm={() => {
          if (!onDeleteDraft) return;
          onDeleteDraft(version.id);
          setDeleteDraftOpen(false);
        }}
      />

      <ConfirmDialog
        open={endEarlyOpen}
        title={t("venueCosts.endEarlyConfirm.title")}
        description={t("venueCosts.endEarlyConfirm.body", {
          date: formatDate(today),
        })}
        confirmLabel={t("venueCosts.endEarlyConfirm.confirm")}
        pending={endEarlyPending}
        onCancel={() => setEndEarlyOpen(false)}
        onConfirm={() => {
          if (!onEndEarly) return;
          onEndEarly(version.id);
          setEndEarlyOpen(false);
        }}
      />

      {expanded && (
        <div className="mt-3 ml-6 space-y-3 border-l border-slate-100 pl-3">
          <VersionDetails
            version={version}
            teachers={teachers}
            disciplines={disciplines}
            locations={locations}
            t={t}
          />

          {version.status === "draft" && diffEntries.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-slate-700">{t("venueCosts.diff.title")}</h4>
              <ul className="space-y-1">
                {diffEntries.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.section}-${entry.key}-${index}`}
                    className={`text-[11px] rounded-md px-2 py-1 ${diffKindClass(entry.kind)}`}
                  >
                    {t(`venueCosts.diff.${entry.kind}`)}: {diffEntryLabel(entry, teachers, disciplines, locations, t)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
