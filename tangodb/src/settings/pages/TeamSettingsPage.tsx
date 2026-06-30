import { useRef, useState } from "react";
import { Mail, UserMinus, Users, Copy, Check, Edit, LifeBuoy, UserPlus } from "lucide-react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import AuditLogSection from "../components/AuditLogSection";
import MemberProfileModal from "../components/MemberProfileModal";
import TeacherScopeFields from "../components/TeacherScopeFields";
import { useToast } from "../../App";
import {
  memberListLabel,
  memberRoleLabel,
  useTeamMembers,
  type TeamMemberRow,
} from "../../hooks/useTeamMembers";
import { useTeamInvites, useTeamMutations } from "../../hooks/useTeamInvites";
import { useI18n } from "../../hooks/useI18n";
import { getTeamRolePresets } from "../../lib/i18n";
import { usePermissions } from "../../hooks/usePermissions";
import { DEFAULT_TEACHER_INVITE_SCOPE, isTeacherScopeConfigured } from "../../lib/teacherScope";
import type { MemberMeta, MemberRole, TeacherScope } from "../../types/organization";

type MemberPreset = "director" | "admin" | "reception" | "teacher" | "accountant";

const EDITABLE_PRESETS: MemberPreset[] = ["director", "admin", "reception", "teacher", "accountant"];

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
  if (member.role === "director") return "director";
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

export default function TeamSettingsPage() {
  const { t, locale, formatDate } = useI18n();
  const invitePresets = getTeamRolePresets(t);
  const showToast = useToast();
  const { role: currentRole, can } = usePermissions();
  const { data: members = [], isLoading, isError, error } = useTeamMembers();
  const { data: invites = [], isLoading: invitesLoading } = useTeamInvites();
  const { invite, revokeInvite, updateMember } = useTeamMutations();

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [invitePreset, setInvitePreset] = useState<MemberPreset>("teacher");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileMember, setProfileMember] = useState<TeamMemberRow | null>(null);
  const [inviteScope, setInviteScope] = useState<TeacherScope | null>(DEFAULT_TEACHER_INVITE_SCOPE);
  const [inviteMetaOverride, setInviteMetaOverride] = useState<MemberMeta | null>(null);
  const [reinviteSourceId, setReinviteSourceId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamMemberRow | null>(null);
  const inviteFormRef = useRef<HTMLFormElement>(null);

  const activeMembers = members.filter((m) => m.is_active);
  const inactiveMembers = members.filter((m) => !m.is_active);

  const directorSlotTaken = (excludeMemberId?: string): boolean => {
    const hasActiveDirector = activeMembers.some(
      (m) => m.role === "director" && m.id !== excludeMemberId
    );
    const hasPendingDirectorInvite = invites.some((inv) => inv.role === "director");
    return hasActiveDirector || hasPendingDirectorInvite;
  };

  const showDirectorSlotError = (message: string) => {
    if (message.includes("director_slot_taken")) {
      showToast(t("team.directorSlotTaken"), "error");
      return true;
    }
    return false;
  };

  const clearReinvitePreset = () => {
    setInviteScope(DEFAULT_TEACHER_INVITE_SCOPE);
    setInviteMetaOverride(null);
    setReinviteSourceId(null);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || !lastName.trim()) return;
    const { role, meta } = presetToRoleMeta(invitePreset);
    const scope =
      role === "teacher"
        ? inviteScope ?? DEFAULT_TEACHER_INVITE_SCOPE
        : inviteScope ?? undefined;
    if (role === "teacher" && scope && !isTeacherScopeConfigured(scope)) {
      showToast(t("team.scope.required"), "error");
      return;
    }
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
      const message = err instanceof Error ? err.message : "";
      if (!showDirectorSlotError(message)) {
        showToast(message || t("team.inviteError"), "error");
      }
    }
  };

  const handleReinvite = (member: TeamMemberRow) => {
    const preset = memberPreset(member);
    const { role, meta } = presetToRoleMeta(preset);
    if (!can("team.manage")) return;
    if (currentRole !== "owner" && currentRole !== "director") return;
    if (role === "owner") return;
    if (role === "director" && currentRole !== "owner") return;
    setInvitePreset(preset);
    setFirstName(member.first_name ?? "");
    setLastName(member.last_name ?? "");
    setEmail("");
    setInviteScope(
      member.role === "teacher" && isTeacherScopeConfigured(member.scope)
        ? member.scope
        : DEFAULT_TEACHER_INVITE_SCOPE
    );
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

  const canShowRecoveryGuide = currentRole === "owner" || currentRole === "director";

  const copyInviteUrl = async () => {
    if (!lastInviteUrl) return;
    await navigator.clipboard.writeText(lastInviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canAssignPreset = (preset: MemberPreset, forMemberId?: string): boolean => {
    const { role } = presetToRoleMeta(preset);
    if (!can("team.manage")) return false;
    if (role === "director" && directorSlotTaken(forMemberId)) return false;
    if (currentRole === "owner") {
      return role !== "owner";
    }
    if (currentRole === "director") {
      return role !== "owner" && role !== "director";
    }
    return false;
  };

  const canInvite = can("team.manage");
  const canEditMemberProfile = currentRole === "owner" || currentRole === "director";

  const canManageMember = (memberRole: MemberRole): boolean => {
    if (memberRole === "owner") return currentRole === "owner";
    if (memberRole === "director") return currentRole === "owner";
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
              const nextPreset = e.target.value as MemberPreset;
              setInvitePreset(nextPreset);
              clearReinvitePreset();
              if (nextPreset === "teacher") {
                setInviteScope(DEFAULT_TEACHER_INVITE_SCOPE);
              }
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
        {invitePreset === "teacher" && inviteScope && (
          <TeacherScopeFields value={inviteScope} onChange={setInviteScope} />
        )}
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
                      onChange={async (e) => {
                        const next = presetToRoleMeta(e.target.value as MemberPreset);
                        try {
                          await updateMember.mutateAsync({
                            memberId: member.id,
                            role: next.role,
                            meta: next.meta,
                          });
                        } catch (err) {
                          const message = err instanceof Error ? err.message : "";
                          if (!showDirectorSlotError(message)) {
                            showToast(message || t("team.inviteError"), "error");
                          }
                        }
                      }}
                    >
                      {EDITABLE_PRESETS.filter((p) => canAssignPreset(p, member.id) || p === preset).map(
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

      <AuditLogSection />
    </div>
  );
}
