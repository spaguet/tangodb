import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { formatClientName } from "../../lib/utils";
import { sortWaitlistEntries } from "../../lib/groupCapacity";
import {
  useAddGroupWaitlistEntry,
  useGroupWaitlist,
  useUpdateGroupWaitlistStatus,
} from "../../hooks/useGroupWaitlist";
import { useClientDirectory } from "../../hooks/useClients";
import { resolveMutationError } from "../../lib/resolveMutationError";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import type { ToastType } from "../../App";
import type { GroupWaitlistStatus } from "../../types";

interface GroupWaitlistPanelProps {
  classId: string;
  canManage?: boolean;
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function GroupWaitlistPanel({ classId, canManage = false, toast }: GroupWaitlistPanelProps) {
  const { t } = useI18n();
  const { data: entries = [], isLoading } = useGroupWaitlist(classId);
  const { data: clients = [] } = useClientDirectory();
  const addEntry = useAddGroupWaitlistEntry();
  const updateStatus = useUpdateGroupWaitlistStatus();

  const [clientQuery, setClientQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [comment, setComment] = useState("");

  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);
  const sortedEntries = useMemo(() => sortWaitlistEntries(entries), [entries]);

  const handleAdd = async () => {
    if (!clientId) {
      toast(t("subscriptions.error.selectClient"), "error");
      return;
    }
    const res = await addEntry.mutateAsync({ classId, clientId, comment: comment.trim() || undefined });
    if (!res.success) {
      toast(resolveMutationError(res.error, "groupWaitlist.error.addFailed", t), "error");
      return;
    }
    toast(t("groupWaitlist.success.added"), "success");
    setClientQuery("");
    setClientId("");
    setComment("");
  };

  const handleStatus = async (entryId: string, status: GroupWaitlistStatus) => {
    const res = await updateStatus.mutateAsync({ entryId, status });
    if (!res.success) {
      if (res.error === "group_capacity_exceeded") {
        toast(t("subscriptions.error.groupCapacityExceeded"), "error");
        return;
      }
      toast(resolveMutationError(res.error, "groupWaitlist.error.updateFailed", t), "error");
      return;
    }
    toast(t("groupWaitlist.success.updated"), "success");
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-center gap-2 text-slate-800">
        <Users className="w-4 h-4 text-indigo-500" />
        <h4 className="text-sm font-semibold tracking-tight">{t("groupWaitlist.title")}</h4>
      </div>

      {canManage && (
        <div className="space-y-2 border-b border-slate-100 pb-3">
          <ClientAutocomplete
            label={t("groupWaitlist.addClient")}
            clients={clients}
            query={clientQuery}
            selectedId={clientId}
            toast={toast}
            onQueryChange={(q) => {
              setClientQuery(q);
              setClientId("");
            }}
            onSelect={(c) => {
              setClientId(c.id);
              setClientQuery(formatClientName(c.lastName, c.firstName));
            }}
          />
          <div className="field-stack">
            <label className={labelCls}>{t("groupWaitlist.commentOptional")}</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={addEntry.isPending}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-60"
          >
            {addEntry.isPending ? t("common.saving") : t("groupWaitlist.addToQueue")}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-slate-400">{t("common.loading.default")}</p>
      ) : sortedEntries.length === 0 ? (
        <p className="text-xs text-slate-400">{t("groupWaitlist.empty")}</p>
      ) : (
        <div className="space-y-2">
          {sortedEntries.map((entry, index) => {
            const client = clientMap[entry.clientId];
            const name = client
              ? formatClientName(client.lastName, client.firstName)
              : t("groupWaitlist.unknownClient");
            return (
              <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {index + 1}. {name}
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                      {t(`groupWaitlist.status.${entry.status}`)}
                    </p>
                    {entry.comment && <p className="text-xs text-slate-500 mt-1">{entry.comment}</p>}
                  </div>
                </div>
                {canManage && entry.status !== "enrolled" && entry.status !== "declined" && entry.status !== "cancelled" && (
                  <div className="flex flex-wrap gap-1.5">
                    {entry.status === "waiting" && (
                      <button
                        type="button"
                        onClick={() => void handleStatus(entry.id, "offered")}
                        disabled={updateStatus.isPending}
                        className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 cursor-pointer disabled:opacity-60"
                      >
                        {t("groupWaitlist.action.offer")}
                      </button>
                    )}
                    {entry.status === "offered" && (
                      <button
                        type="button"
                        onClick={() => void handleStatus(entry.id, "enrolled")}
                        disabled={updateStatus.isPending}
                        className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 cursor-pointer disabled:opacity-60"
                      >
                        {t("groupWaitlist.action.enrolled")}
                      </button>
                    )}
                    {(entry.status === "waiting" || entry.status === "offered") && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleStatus(entry.id, "declined")}
                          disabled={updateStatus.isPending}
                          className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer disabled:opacity-60"
                        >
                          {t("groupWaitlist.action.declined")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleStatus(entry.id, "cancelled")}
                          disabled={updateStatus.isPending}
                          className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 cursor-pointer disabled:opacity-60"
                        >
                          {t("groupWaitlist.action.cancelled")}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
