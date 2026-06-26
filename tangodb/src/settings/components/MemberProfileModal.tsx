import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Save, X } from "lucide-react";
import { useToast } from "../../App";
import { memberDisplayName, type TeamMemberRow } from "../../hooks/useTeamMembers";
import { useTeamMutations } from "../../hooks/useTeamInvites";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";

interface MemberProfileModalProps {
  member: TeamMemberRow | null;
  canEdit: boolean;
  onClose: () => void;
}

interface ProfileForm {
  firstName: string;
  lastName: string;
  patronymic: string;
  contactEmail: string;
  phone: string;
  telegram: string;
  profileNotes: string;
}

const labelCls =
  "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const fieldCls =
  "w-full bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3 py-2 text-sm transition-all";

const readOnlyCls =
  "w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-sm text-slate-700";

function toForm(member: TeamMemberRow): ProfileForm {
  return {
    firstName: member.first_name ?? "",
    lastName: member.last_name ?? "",
    patronymic: member.patronymic ?? "",
    contactEmail: member.contact_email ?? "",
    phone: member.phone ?? "",
    telegram: member.telegram ?? "",
    profileNotes: member.profile_notes ?? "",
  };
}

function ProfileField({
  label,
  value,
  canEdit,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  canEdit: boolean;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel";
}) {
  return (
    <label className="block space-y-1">
      <span className={labelCls}>{label}</span>
      {canEdit ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fieldCls}
        />
      ) : (
        <p className={readOnlyCls}>{value || "—"}</p>
      )}
    </label>
  );
}

export default function MemberProfileModal({ member, canEdit, onClose }: MemberProfileModalProps) {
  const { t } = useI18n();
  const showToast = useToast();
  const { updateMember } = useTeamMutations();
  const [form, setForm] = useState<ProfileForm>({
    firstName: "",
    lastName: "",
    patronymic: "",
    contactEmail: "",
    phone: "",
    telegram: "",
    profileNotes: "",
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!member) return;
    setForm(toForm(member));
    setDirty(false);
  }, [member]);

  useEffect(() => {
    if (!member) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [member, onClose]);

  const patch = (key: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!member) return;
    try {
      await updateMember.mutateAsync({
        memberId: member.id,
        firstName: form.firstName,
        lastName: form.lastName,
        patronymic: form.patronymic,
        contactEmail: form.contactEmail,
        phone: form.phone,
        telegram: form.telegram,
        profileNotes: form.profileNotes,
      });
      showToast(t("memberProfile.success.saved"), "success");
      setDirty(false);
      onClose();
    } catch (err) {
      showToast(
        resolveMutationError(err instanceof Error ? err.message : undefined, "memberProfile.error.saveFailed", t),
        "error"
      );
    }
  };

  const subtitle = member ? memberDisplayName(member) : null;

  return (
    <AnimatePresence>
      {member && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="min-w-0 pr-2">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("memberProfile.editTitle")}</h3>
                {subtitle && (
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                  aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="panel-form-stack font-sans">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ProfileField
                  label={t("common.lastName")}
                  value={form.lastName}
                  canEdit={canEdit}
                  onChange={(v) => patch("lastName", v)}
                />
                <ProfileField
                  label={t("common.firstName")}
                  value={form.firstName}
                  canEdit={canEdit}
                  onChange={(v) => patch("firstName", v)}
                />
                <ProfileField
                  label={t("memberProfile.field.patronymic")}
                  value={form.patronymic}
                  canEdit={canEdit}
                  onChange={(v) => patch("patronymic", v)}
                />
                <ProfileField
                  label="Email"
                  value={form.contactEmail}
                  canEdit={canEdit}
                  onChange={(v) => patch("contactEmail", v)}
                  type="email"
                />
                <ProfileField
                  label={t("common.contact")}
                  value={form.phone}
                  canEdit={canEdit}
                  onChange={(v) => patch("phone", v)}
                  type="tel"
                />
                <ProfileField
                  label="Telegram"
                  value={form.telegram}
                  canEdit={canEdit}
                  onChange={(v) => patch("telegram", v)}
                />
              </div>

              <label className="block space-y-1">
                <span className={labelCls}>{t("memberProfile.field.other")}</span>
                {canEdit ? (
                  <textarea
                    value={form.profileNotes}
                    onChange={(e) => patch("profileNotes", e.target.value)}
                    rows={2}
                    className={`${fieldCls} resize-y min-h-[60px]`}
                  />
                ) : (
                  <p className={`${readOnlyCls} whitespace-pre-wrap`}>{form.profileNotes || "—"}</p>
                )}
              </label>
            </div>

            <div className="flex items-center gap-3 pt-1 text-xs">
              {canEdit ? (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || updateMember.isPending}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Save className="w-3.5 h-3.5" />
                  {updateMember.isPending ? t("common.saving") : t("common.save")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.close")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
