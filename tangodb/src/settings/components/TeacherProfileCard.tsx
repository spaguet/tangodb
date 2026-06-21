import { useEffect, useState } from "react";
import { GraduationCap, Save } from "lucide-react";
import { useToast } from "../../App";
import { memberDisplayName, type TeamMemberRow } from "../../hooks/useTeamMembers";
import { useTeamMutations } from "../../hooks/useTeamInvites";

interface TeacherProfileCardProps {
  member: TeamMemberRow;
  canEdit: boolean;
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

export default function TeacherProfileCard({ member, canEdit }: TeacherProfileCardProps) {
  const showToast = useToast();
  const { updateMember } = useTeamMutations();
  const [form, setForm] = useState<ProfileForm>(() => toForm(member));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm(toForm(member));
    setDirty(false);
  }, [member]);

  const title = memberDisplayName(member) ?? `Преподаватель ${member.user_id.slice(0, 8)}…`;

  const patch = (key: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
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
      showToast("Профиль преподавателя сохранён", "success");
      setDirty(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Не удалось сохранить профиль", "error");
    }
  };

  return (
    <div className="bg-slate-50 rounded-xl border border-slate-100 p-3.5 space-y-3">
      <div className="flex items-center gap-2 border-b border-slate-200/60 pb-2">
        <GraduationCap className="w-4 h-4 text-indigo-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-800 truncate">{title}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ProfileField
          label="Фамилия"
          value={form.lastName}
          canEdit={canEdit}
          onChange={(v) => patch("lastName", v)}
        />
        <ProfileField
          label="Имя"
          value={form.firstName}
          canEdit={canEdit}
          onChange={(v) => patch("firstName", v)}
        />
        <ProfileField
          label="Отчество"
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
          label="Телефон"
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
        <span className={labelCls}>Прочее</span>
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

      {canEdit && (
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || updateMember.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {updateMember.isPending ? "Сохранение…" : "Сохранить профиль"}
        </button>
      )}
    </div>
  );
}
