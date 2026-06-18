import { Users } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { memberRoleLabel, useTeamMembers } from "../../hooks/useTeamMembers";

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TeamSettingsPage() {
  const { data: members = [], isLoading, isError, error } = useTeamMembers();

  if (isLoading) return <LoadingState label="Загрузка команды..." />;
  if (isError) return <QueryErrorState error={error} />;

  const activeMembers = members.filter((m) => m.is_active);

  return (
    <div className="panel-card-stack max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Команда</h2>
        <p className="text-xs text-slate-500 mt-1">
          Участники организации. Приглашения и управление ролями — в следующей фазе.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-2">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-500" />
            Участники
          </h3>
          <span className="text-[10px] bg-slate-100 text-slate-500 font-sans px-2 py-0.5 rounded-full font-semibold">
            {activeMembers.length}
          </span>
        </div>

        <div className="space-y-1.5">
          {activeMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-3 p-2.5 bg-slate-50 rounded-lg border border-slate-100"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {member.display_name ?? `Участник ${member.user_id.slice(0, 8)}…`}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {memberRoleLabel(member.role)} · с {formatJoined(member.joined_at)}
                </p>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full shrink-0">
                {memberRoleLabel(member.role)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
