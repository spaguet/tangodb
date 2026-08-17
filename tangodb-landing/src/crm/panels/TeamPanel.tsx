import { Mail, Users } from "lucide-react";
import type { Locale } from "../../i18n";
import { pendingInvites, teamMembers } from "../data";
import { panelStrings } from "../panelStrings";
import { fieldCls, labelCls } from "../styles";

type Props = { locale: Locale };

export function TeamPanel({ locale }: Props) {
  const p = panelStrings(locale);

  return (
    <div className="panel-card-stack max-w-2xl demo-field-disabled">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{p.teamTitle}</h2>
        <p className="text-xs text-ink-500 mt-1">{p.teamSubtitle}</p>
      </div>

      <form className="bg-white rounded-xl border border-ink-200 shadow-xs p-3.5 space-y-3">
        <h3 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
          <Mail className="w-4 h-4 text-gold-500" />
          {p.teamInvite}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={labelCls}>{p.inviteEmail}</span>
            <input type="email" disabled className={fieldCls} placeholder="teacher@example.com" />
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>{p.inviteRole}</span>
            <div className={fieldCls + " bg-ink-50"}>{locale === "ru" ? "Преподаватель" : "Teacher"}</div>
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>{locale === "ru" ? "Фамилия" : "Last name"}</span>
            <input disabled className={fieldCls} />
          </label>
          <label className="block space-y-1">
            <span className={labelCls}>{locale === "ru" ? "Имя" : "First name"}</span>
            <input disabled className={fieldCls} />
          </label>
        </div>
        <button type="button" disabled className="px-4 py-2 bg-gold-600/40 text-white text-xs font-semibold rounded-lg cursor-not-allowed">
          {p.sendInvite}
        </button>
      </form>

      {pendingInvites.length > 0 && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-3.5 space-y-2">
          <h3 className="font-sans text-sm font-semibold text-ink-800">{p.teamPending}</h3>
          {pendingInvites.map((inv) => (
            <div
              key={inv.email}
              className="flex items-center justify-between gap-2 p-2.5 bg-amber-50 rounded-lg border border-amber-200"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{inv.name}</p>
                <p className="text-[11px] text-ink-500 truncate">
                  {inv.email} · {inv.role} · {locale === "ru" ? "до" : "until"} {inv.expires}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-ink-100 pb-2">
          <h3 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-gold-500" />
            {p.teamMembers}
          </h3>
          <span className="text-[10px] bg-ink-100 text-ink-500 px-2 py-0.5 rounded-full font-semibold">
            {teamMembers.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {teamMembers.map((m) => (
            <div
              key={m.name}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-ink-50 rounded-lg border border-ink-100"
            >
              <div>
                <p className="text-sm font-semibold text-ink-800">{m.name}</p>
                <p className="text-[11px] text-ink-500">
                  {m.role} · {locale === "ru" ? "с" : "since"} {m.since}
                </p>
              </div>
              <div className={fieldCls + " bg-white text-xs py-1.5 sm:w-36 text-center"}>{m.role}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
