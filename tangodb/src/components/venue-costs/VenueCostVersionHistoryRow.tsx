import { useState } from "react";
import { Check, ChevronDown, Copy, Edit } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import type { VenueCostRuleVersion } from "../../hooks/useVenueCosts";
import { memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import {
  diffVenueCostVersions,
  type VenueCostDiffEntry,
  type VenueCostFixedRules,
  type VenueCostGroupRule,
  type VenueCostPerLessonRules,
  type VenueCostPersonalRule,
  type VenueCostRuleDraft,
} from "../../lib/venueCostRules";
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
}

function versionSnapshot(version: VenueCostRuleVersion) {
  return {
    mode: version.mode,
    validFrom: version.validFrom,
    validTo: version.validTo,
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
    return t("venueCosts.diff.field.version");
  }
  if (entry.section === "fixed") return t("venueCosts.diff.field.fixedPeriod");
  return resolveScopeLabel(entry.key, teachers, disciplines, locations, t);
}

function ScopeReadOnly({
  teacherMemberId,
  disciplineId,
  locationId,
  teachers,
  disciplines,
  locations,
  t,
}: {
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  t: ReturnType<typeof useI18n>["t"];
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

  if (version.mode === "fixed_period") {
    const rules = version.rules as VenueCostFixedRules;
    return (
      <div className="text-xs text-slate-600 space-y-1">
        <p>
          {t(`venueCosts.period.${rules.period}`)} · {formatCurrency(rules.amount)} ({rules.currency})
        </p>
      </div>
    );
  }

  const rules = version.rules as VenueCostPerLessonRules;
  return (
    <div className="space-y-3">
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
}: VenueCostVersionHistoryRowProps) {
  const { t, formatDate, formatDateTime } = useI18n();
  const [expanded, setExpanded] = useState(false);

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
          </div>
        )}
      </div>

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
