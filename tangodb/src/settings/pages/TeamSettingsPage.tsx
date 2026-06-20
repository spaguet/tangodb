import { useState } from "react";
import { Mail, UserMinus, Users, ClipboardList, Copy, Check } from "lucide-react";
import AppSelect from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { useToast } from "../../App";
import {
  memberRoleLabel,
  useTeamMembers,
  type TeamMemberRow,
} from "../../hooks/useTeamMembers";
import { useTeamInvites, useTeamMutations } from "../../hooks/useTeamInvites";
import { auditTableLabel, useOrgAuditLog } from "../../hooks/useOrgAuditLog";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import type { MemberMeta, MemberRole } from "../../types/organization";

type MemberPreset = "admin" | "reception" | "teacher" | "accountant";

const INVITE_PRESETS: { value: MemberPreset; label: string }[] = [
  { value: "admin", label: "Администратор" },
  { value: "reception", label: "Кассир" },
  { value: "teacher", label: "Преподаватель" },
  { value: "accountant", label: "Бухгалтер" },
];

const EDITABLE_PRESETS: MemberPreset[] = ["admin", "reception", "teacher", "accountant"];

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

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatExpires(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

export default function TeamSettingsPage() {
  const { t } = useI18n();
  const showToast = useToast();
  const { role: currentRole, can } = usePermissions();
  const { data: members = [], isLoading, isError, error } = useTeamMembers();
  const { data: invites = [], isLoading: invitesLoading } = useTeamInvites();
  const { data: auditRows = [] } = useOrgAuditLog(20);
  const { invite, revokeInvite, updateMember } = useTeamMutations();

  const [email, setEmail] = useState("");
  const [invitePreset, setInvitePreset] = useState<MemberPreset>("teacher");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (isLoading) return <LoadingState label="Загрузка команды..." />;
  if (isError) return <QueryErrorState error={error} />;

  const activeMembers = members.filter((m) => m.is_active);
  const inactiveMembers = members.filter((m) => !m.is_active);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    const { role, meta } = presetToRoleMeta(invitePreset);
    try {
      const result = await invite.mutateAsync({
        email: email.trim(),
        role,
        meta,
      });
      setEmail("");
      setLastInviteUrl(result.invite_url ?? null);
      showToast(
        result.email_sent ? t("team.inviteEmailSent") : t("team.inviteManualHint"),
        result.email_sent ? "success" : "info"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("team.inviteError"), "error");
    }
  };

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

      {canInvite && (
      <form
        onSubmit={handleInvite}
        className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-3"
      >
        <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-indigo-500" />
          {t("team.invite")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {t("team.inviteEmail")}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400"
              placeholder="teacher@example.com"
            />
          </label>
          <AppSelect
            label={t("team.inviteRole")}
            value={invitePreset}
            onChange={(e) => setInvitePreset(e.target.value as MemberPreset)}
          >
            {INVITE_PRESETS.filter((p) => canAssignPreset(p.value)).map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </AppSelect>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] text-slate-500">{t("team.inviteLinkHint")}</p>
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
              aria-label="Copy"
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
                  <p className="text-sm font-medium text-slate-800 truncate">{inv.email}</p>
                  <p className="text-[11px] text-slate-400">
                    {memberRoleLabel(inv.role, inv.meta)} · до {formatExpires(inv.expires_at)}
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
                  {member.display_name ?? `Участник ${member.user_id.slice(0, 8)}…`}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {memberRoleLabel(member.role, member.meta)} · с {formatJoined(member.joined_at)}
                </p>
              </div>
              {canManageMember(member.role) && isEditableMemberPreset(preset) && (
                <div className="flex items-center gap-2 shrink-0">
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
                          {INVITE_PRESETS.find((item) => item.value === p)?.label ??
                            memberRoleLabel(presetToRoleMeta(p).role, presetToRoleMeta(p).meta)}
                        </option>
                      )
                    )}
                  </AppSelect>
                  <button
                    type="button"
                    onClick={() => updateMember.mutate({ memberId: member.id, isActive: false })}
                    disabled={updateMember.isPending}
                    className="flex items-center gap-1 text-[10px] font-semibold uppercase text-rose-600 hover:bg-rose-50 px-2 py-1.5 rounded cursor-pointer"
                    title={t("team.deactivate")}
                  >
                    <UserMinus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {canManageMember(member.role) && !isEditableMemberPreset(preset) && (
                <span className="text-xs font-semibold text-slate-600 px-2.5 py-1.5 bg-slate-100 rounded-lg shrink-0">
                  {memberRoleLabel(member.role, member.meta)}
                </span>
              )}
            </div>
          );
          })}
        </div>

        {inactiveMembers.length > 0 && (
          <div className="pt-2 border-t border-slate-100 space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
              {t("team.inactive")}
            </p>
            {inactiveMembers.map((member) => (
              <div key={member.id} className="text-xs text-slate-400 px-2 py-1">
                {member.display_name ?? member.user_id.slice(0, 8)} ·{" "}
                {memberRoleLabel(member.role, member.meta)}
              </div>
            ))}
          </div>
        )}
      </div>

      {canInvite && auditRows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-500" />
            {t("team.audit")}
          </h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {auditRows.map((row) => (
              <div
                key={row.id}
                className="flex justify-between gap-2 text-[11px] text-slate-500 py-1 border-b border-slate-50 last:border-0"
              >
                <span>
                  {auditTableLabel(row.table_name)} · {row.operation}
                </span>
                <span className="shrink-0 text-slate-400">
                  {new Date(row.changed_at).toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
