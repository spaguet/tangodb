import { useRef, useState } from "react";
import { Mail, UserMinus, Users, ClipboardList, Copy, Check, Edit, LifeBuoy, UserPlus } from "lucide-react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import MemberProfileModal from "../components/MemberProfileModal";
import { useToast } from "../../App";
import {
  memberListLabel,
  memberRoleLabel,
  useTeamMembers,
  type TeamMemberRow,
} from "../../hooks/useTeamMembers";
import { useTeamInvites, useTeamMutations } from "../../hooks/useTeamInvites";
import { auditTableLabel, useOrgAuditLog } from "../../hooks/useOrgAuditLog";
import { useI18n } from "../../hooks/useI18n";
import { getTeamRolePresets } from "../../lib/i18n";
import type { I18nKey } from "../../lib/i18n/keys";
import { usePermissions } from "../../hooks/usePermissions";
import type { MemberMeta, MemberRole, TeacherScope } from "../../types/organization";

type MemberPreset = "admin" | "reception" | "teacher" | "accountant";

const EDITABLE_PRESETS: MemberPreset[] = ["admin", "reception", "teacher", "accountant"];

const labelCls = "text-[10px] font-semibold uppercase tracking-wider text-slate-400 block";

const iconBtnCls =
  "p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer";

function presetToRoleMeta(preset: MemberPreset): { role: MemberRole; meta: MemberMeta } {
  if (preset === "reception") {
    return { role: "admin", meta: { restricted_admin: true } };
  }
  if (preset === "admin") {
    return { role: "admin", meta: { restricted_admin: false } };
  }
  return { role: preset, meta: {} };
}

function memberPreset(member: TeamMemberRow): MemberPreset {
  if (member.role === "admin" && member.meta?.restricted_admin) return "reception";
  if (member.role === "admin") return "admin";
  return member.role as MemberPreset;
}

function isEditableMemberPreset(preset: MemberPreset): boolean {
  return EDITABLE_PRESETS.includes(preset);
}

function formatJoined(
  iso: string | null,
  formatDate: (iso: string | Date, options?: Intl.DateTimeFormatOptions) => string
): string {
  if (!iso) return "—";
  return formatDate(iso, { day: "numeric", month: "short", year: "numeric" });
}

function formatExpires(iso: string, formatDate: (iso: string | Date, options?: Intl.DateTimeFormatOptions) => string): string {
  return formatDate(iso, { day: "numeric", month: "short" });
}

function inviteListLabel(inv: { first_name?: string | null; last_name?: string | null; email: string }): string {
  const parts = [inv.last_name, inv.first_name].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return inv.email;
}

const AUDIT_FIELD_LABEL_KEYS: Record<string, I18nKey> = {
  role: "team.auditField.role",
  scope: "team.auditField.scope",
  meta: "team.auditField.meta",
  display_name: "team.auditField.displayName",
  first_name: "common.firstName",
  last_name: "common.lastName",
  patronymic: "memberProfile.field.patronymic",
  contact_email: "team.auditField.contactEmail",
  phone: "team.auditField.phone",
  telegram: "team.auditField.telegram",
  profile_notes: "memberProfile.field.other",
  is_active: "team.auditField.isActive",
  email: "team.auditField.contactEmail",
  expires_at: "team.auditField.expiresAt",
  locale: "team.auditField.locale",
  currency_code: "team.auditField.currencyCode",
  currency_display: "team.auditField.currencyDisplay",
  modules: "team.auditField.modules",
  branding_name: "team.auditField.brandingName",
  pair_cycle_enabled: "team.auditField.pairCycleEnabled",
};

const AUDIT_MODULE_LABEL_KEYS: Record<string, I18nKey> = {
  group_subscriptions: "settings.org.module.groupSubscriptions",
  personal_lessons: "settings.org.module.personalLessons",
  finance_basic: "settings.org.module.financeBasic",
  pair_subscriptions: "settings.org.module.pairSubscriptions",
  trio_lessons: "settings.org.module.trioLessons",
  multi_discipline: "settings.org.module.multiDiscipline",
  locations: "settings.org.module.locations",
};

const HIDDEN_AUDIT_FIELDS = new Set([
  "id",
  "organization_id",
  "user_id",
  "created_at",
  "updated_at",
  "joined_at",
  "invited_at",
]);

function auditOperationLabel(operation: string, translate: ReturnType<typeof useI18n>["t"]): string {
  if (operation === "INSERT") return translate("team.auditOperation.insert");
  if (operation === "UPDATE") return translate("team.auditOperation.update");
  if (operation === "DELETE") return translate("team.auditOperation.delete");
  return operation;
}

function auditValueLabel(value: unknown, translate: ReturnType<typeof useI18n>["t"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? translate("common.yes") : translate("common.no");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function auditModuleLabel(key: string, translate: ReturnType<typeof useI18n>["t"]): string {
  const labelKey = AUDIT_MODULE_LABEL_KEYS[key];
  return labelKey ? translate(labelKey) : key;
}

function auditModulesInsertLabel(value: unknown, translate: ReturnType<typeof useI18n>["t"]): string {
  if (!isRecord(value)) return auditValueLabel(value, translate);

  const enabled = Object.entries(value)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => auditModuleLabel(key, translate));

  return enabled.length > 0 ? enabled.join(", ") : "—";
}

function auditChangedFields(row: {
  operation: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}, translate: ReturnType<typeof useI18n>["t"]): string[] {
  const oldData = row.old_data ?? {};
  const newData = row.new_data ?? {};
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const details: string[] = [];

  for (const key of keys) {
    if (HIDDEN_AUDIT_FIELDS.has(key)) continue;
    const oldValue = oldData[key];
    const newValue = newData[key];
    if (row.operation === "UPDATE" && JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    if (row.operation === "INSERT" && (newValue === null || newValue === undefined || newValue === "")) continue;

    const labelKey = AUDIT_FIELD_LABEL_KEYS[key];
    const label = labelKey ? translate(labelKey) : key;
    if (key === "modules") {
      if (row.operation === "INSERT") {
        details.push(`${label}: ${auditModulesInsertLabel(newValue, translate)}`);
      } else if (row.operation === "DELETE") {
        details.push(`${label}: ${auditModulesInsertLabel(oldValue, translate)}`);
      } else if (isRecord(oldValue) && isRecord(newValue)) {
        const moduleKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
        for (const moduleKey of moduleKeys) {
          if (JSON.stringify(oldValue[moduleKey]) === JSON.stringify(newValue[moduleKey])) continue;
          details.push(
            `${label}: ${auditModuleLabel(moduleKey, translate)}: ${auditValueLabel(
              oldValue[moduleKey],
              translate
            )} → ${auditValueLabel(newValue[moduleKey], translate)}`
          );
        }
      } else {
        details.push(`${label}: ${auditValueLabel(oldValue, translate)} → ${auditValueLabel(newValue, translate)}`);
      }
      continue;
    }
    if (row.operation === "INSERT") {
      details.push(`${label}: ${auditValueLabel(newValue, translate)}`);
    } else if (row.operation === "DELETE") {
      details.push(`${label}: ${auditValueLabel(oldValue, translate)}`);
    } else {
      details.push(`${label}: ${auditValueLabel(oldValue, translate)} → ${auditValueLabel(newValue, translate)}`);
    }
  }

  return details;
}

export default function TeamSettingsPage() {
  const { t, locale, formatDate, formatDateTime } = useI18n();
  const invitePresets = getTeamRolePresets(t);
  const showToast = useToast();
  const { role: currentRole, can } = usePermissions();
  const { data: members = [], isLoading, isError, error } = useTeamMembers();
  const { data: invites = [], isLoading: invitesLoading } = useTeamInvites();
  const { data: auditRows = [] } = useOrgAuditLog(20);
  const { invite, revokeInvite, updateMember } = useTeamMutations();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [invitePreset, setInvitePreset] = useState<MemberPreset>("teacher");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileMember, setProfileMember] = useState<TeamMemberRow | null>(null);
  const [inviteScope, setInviteScope] = useState<TeacherScope | null>(null);
  const [inviteMetaOverride, setInviteMetaOverride] = useState<MemberMeta | null>(null);
  const [reinviteSourceId, setReinviteSourceId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamMemberRow | null>(null);
  const inviteFormRef = useRef<HTMLFormElement>(null);

  const clearReinvitePreset = () => {
    setInviteScope(null);
    setInviteMetaOverride(null);
    setReinviteSourceId(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || !lastName.trim()) return;
    const { role, meta } = presetToRoleMeta(invitePreset);
    const scope = inviteScope ?? undefined;
    const mergedMeta = inviteMetaOverride ?? meta;
    try {
      const result = await invite.mutateAsync({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        meta: mergedMeta,
        scope,
      });
      setEmail("");
      setFirstName("");
      setLastName("");
      clearReinvitePreset();
      setLastInviteUrl(result.invite_url ?? null);
      showToast(
        result.email_sent ? t("team.inviteEmailSent") : t("team.inviteManualHint"),
        result.email_sent ? "success" : "info"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("team.inviteError"), "error");
    }
  };

  const handleReinvite = (member: TeamMemberRow) => {
    const preset = memberPreset(member);
    const { role, meta } = presetToRoleMeta(preset);
    if (!can("team.manage")) return;
    if (currentRole !== "owner" && currentRole !== "director") return;
    if (role === "owner" || role === "director") return;
    setInvitePreset(preset);
    setFirstName(member.first_name ?? "");
    setLastName(member.last_name ?? "");
    setEmail("");
    setInviteScope(member.scope);
    setInviteMetaOverride(meta);
    setReinviteSourceId(member.id);
    setLastInviteUrl(null);
    inviteFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDeactivateConfirm = async () => {
    if (!deactivateTarget) return;
    try {
      await updateMember.mutateAsync({ memberId: deactivateTarget.id, isActive: false });
      showToast(t("team.deactivateSuccess"), "info");
      setDeactivateTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("teacher_has_future_lessons")) {
        showToast(t("team.deactivateFutureLessons"), "error");
      } else {
        showToast(message || t("team.inviteError"), "error");
      }
    }
  };

  if (isLoading) return <LoadingState label={t("settings.team.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  const activeMembers = members.filter((m) => m.is_active);
  const inactiveMembers = members.filter((m) => !m.is_active);
  const canShowRecoveryGuide = currentRole === "owner" || currentRole === "director";
  const memberNameByUserId = new Map(
    members.map((member) => [member.user_id, memberListLabel(member, locale)])
  );

  const copyInviteUrl = async () => {
    if (!lastInviteUrl) return;
    await navigator.clipboard.writeText(lastInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canAssignPreset = (preset: MemberPreset): boolean => {
    const { role } = presetToRoleMeta(preset);
    if (!can("team.manage")) return false;
    if (currentRole === "owner" || currentRole === "director") {
      return role !== "owner" && role !== "director";
    }
    return false;
  };

  const canInvite = can("team.manage");
  const canEditMemberProfile = currentRole === "owner" || currentRole === "director";

  const canManageMember = (memberRole: MemberRole): boolean => {
    if (memberRole === "owner") return currentRole === "owner";
    if (memberRole === "director") return currentRole === "owner" || currentRole === "director";
    return canAssignPreset("admin") || currentRole === "owner" || currentRole === "director";
  };

  return (
    <div className="panel-card-stack max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("team.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("team.subtitle")}</p>
      </div>

      {canShowRecoveryGuide && (
        <div className="bg-sky-50/80 rounded-xl border border-sky-100 p-3.5 space-y-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-sky-600" />
            {t("team.recoveryTitle")}
          </h3>
          <ul className="text-[11px] text-slate-600 space-y-1.5 list-disc pl-4 leading-relaxed">
            <li>{t("team.recoveryForgotPassword")}</li>
            <li>{t("team.recoveryLostEmail")}</li>
            <li className="text-slate-500">{t("team.recoveryOwnerNote")}</li>
          </ul>
        </div>
      )}

      {canInvite && (
      <form
        ref={inviteFormRef}
        onSubmit={handleInvite}
        className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-3"
      >
        <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-indigo-500" />
          {t("team.invite")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelCls}>{t("team.inviteEmail")}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputCls}
              placeholder="teacher@example.com"
            />
          </label>
          <AppSelect
            label={t("team.inviteRole")}
            value={invitePreset}
            onChange={(e) => {
              setInvitePreset(e.target.value as MemberPreset);
              clearReinvitePreset();
            }}
          >
            {invitePresets.filter((p) => canAssignPreset(p.value)).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </AppSelect>
          <label className="block space-y-1">
            <span className={labelCls}>{t("common.lastName")}</span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className={inputCls}
              placeholder={t("settings.team.lastNamePlaceholder")}
            />
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>{t("common.firstName")}</span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className={inputCls}
              placeholder={t("settings.team.firstNamePlaceholder")}
            />
          </label>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-500">
            {reinviteSourceId ? t("team.reinviteHint") : t("team.inviteLinkHint")}
          </p>
          <button
            type="submit"
            disabled={invite.isPending}
            className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {invite.isPending ? "…" : t("team.sendInvite")}
          </button>
        </div>
        {lastInviteUrl && (
          <div className="flex items-center gap-2 p-2 bg-indigo-50 rounded-lg border border-indigo-100">
            <p className="text-[11px] text-indigo-800 truncate flex-1 font-mono">{lastInviteUrl}</p>
            <button
              type="button"
              onClick={copyInviteUrl}
              className="shrink-0 p-1.5 text-indigo-600 hover:bg-indigo-100 rounded cursor-pointer"
              aria-label={t("common.copy")}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        )}
      </form>
      )}

      {canInvite && !invitesLoading && invites.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800">{t("team.pendingInvites")}</h3>
          <div className="space-y-1.5">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-2 p-2.5 bg-amber-50/80 rounded-lg border border-amber-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{inviteListLabel(inv)}</p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {inv.email} · {memberRoleLabel(inv.role, inv.meta, locale)} ·{" "}
                    {t("settings.team.inviteExpires", { date: formatExpires(inv.expires_at, formatDate) })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => revokeInvite.mutate(inv.id)}
                  disabled={revokeInvite.isPending}
                  className="text-[10px] font-semibold uppercase text-rose-600 hover:bg-rose-50 px-2 py-1 rounded cursor-pointer"
                >
                  {t("team.revoke")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />
            {t("team.members")}
          </h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 font-sans px-2 py-0.5 rounded-full font-semibold">
            {activeMembers.length}
          </span>
        </div>

        <div className="space-y-1.5">
          {activeMembers.length === 0 && (
            <p className="text-sm text-slate-400 py-2">{t("team.noMembers")}</p>
          )}
          {activeMembers.map((member) => {
            const preset = memberPreset(member);
            return (
            <div
              key={member.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {memberListLabel(member, locale)}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {memberRoleLabel(member.role, member.meta, locale)} ·{" "}
                  {t("settings.team.memberSince", { date: formatJoined(member.joined_at, formatDate) })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {canInvite && (
                  <button
                    type="button"
                    onClick={() => setProfileMember(member)}
                    className={iconBtnCls}
                    title={t("settings.team.editMember")}
                    aria-label={t("settings.team.editMemberAria", { name: memberListLabel(member, locale) })}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                )}
                {canManageMember(member.role) && isEditableMemberPreset(preset) && (
                  <>
                    <AppSelect
                      value={preset}
                      onChange={(e) => {
                        const next = presetToRoleMeta(e.target.value as MemberPreset);
                        updateMember.mutate({
                          memberId: member.id,
                          role: next.role,
                          meta: next.meta,
                        });
                      }}
                    >
                      {EDITABLE_PRESETS.filter((p) => canAssignPreset(p) || p === preset).map(
                        (p) => (
                          <option key={p} value={p}>
                            {invitePresets.find((item) => item.value === p)?.label ??
                              memberRoleLabel(presetToRoleMeta(p).role, presetToRoleMeta(p).meta, locale)}
                          </option>
                        )
                      )}
                    </AppSelect>
                    <button
                      type="button"
                      onClick={() => setDeactivateTarget(member)}
                      disabled={updateMember.isPending}
                      className="flex items-center gap-1 text-[10px] font-semibold uppercase text-rose-600 hover:bg-rose-50 px-2 py-1.5 rounded cursor-pointer"
                      title={t("team.deactivate")}
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {canManageMember(member.role) && !isEditableMemberPreset(preset) && (
                  <span className="text-xs font-semibold text-slate-600 px-2.5 py-1.5 bg-slate-100 rounded-lg shrink-0">
                    {memberRoleLabel(member.role, member.meta, locale)}
                  </span>
                )}
              </div>
            </div>
          );
          })}
        </div>

        {inactiveMembers.length > 0 && (
          <div className="pt-2 border-t border-slate-100 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {t("team.inactive")}
            </p>
            {inactiveMembers.map((member) => {
              const preset = memberPreset(member);
              const canReinvite =
                canInvite && isEditableMemberPreset(preset) && canAssignPreset(preset);
              return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-2 text-xs text-slate-400 px-2 py-1"
              >
                <span>
                  {memberListLabel(member, locale)} · {memberRoleLabel(member.role, member.meta, locale)}
                </span>
                {canReinvite && (
                  <button
                    type="button"
                    onClick={() => handleReinvite(member)}
                    className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3" />
                    {t("team.reinvite")}
                  </button>
                )}
              </div>
            );
            })}
          </div>
        )}
      </div>

      <MemberProfileModal
        member={profileMember}
        canEdit={canEditMemberProfile}
        onClose={() => setProfileMember(null)}
      />

      <ConfirmDialog
        open={!!deactivateTarget}
        title={t("team.deactivateConfirmTitle")}
        description={t("team.deactivateConfirmBody")}
        confirmLabel={t("team.deactivate")}
        pending={updateMember.isPending}
        onConfirm={handleDeactivateConfirm}
        onCancel={() => setDeactivateTarget(null)}
      />

      {canInvite && auditRows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-500" />
            {t("team.audit")}
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {auditRows.map((row) => {
              const details = auditChangedFields(row, t);
              const actor = row.changed_by
                ? memberNameByUserId.has(row.changed_by)
                  ? t("team.auditActor", {
                      name: memberNameByUserId.get(row.changed_by)!,
                      id: row.changed_by,
                    })
                  : t("team.auditActorIdOnly", { id: row.changed_by })
                : t("team.auditSystem");
              return (
                <div
                  key={row.id}
                  className="text-[11px] text-slate-500 py-2 border-b border-slate-50 last:border-0 space-y-1"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-slate-700">
                      {auditTableLabel(row.table_name, locale)} · {auditOperationLabel(row.operation, t)}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {formatDateTime(row.changed_at, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-slate-400">{actor}</p>
                  {details.length > 0 && (
                    <ul className="space-y-0.5">
                      {details.slice(0, 6).map((detail) => (
                        <li key={detail} className="text-slate-600">
                          {detail}
                        </li>
                      ))}
                      {details.length > 6 && (
                        <li className="text-slate-400">{t("team.auditMore", { count: details.length - 6 })}</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
