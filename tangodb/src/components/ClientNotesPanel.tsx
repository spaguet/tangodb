import { useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import {
  useAddClientNote,
  useClientNotes,
  useDeleteClientNote,
} from "../hooks/useClientNotes";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { useCan } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { resolveMutationError, isI18nKey } from "../lib/resolveMutationError";
import { useOrganization } from "../organization/OrganizationProvider";
import RequirePermission from "./RequirePermission";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";
import { btnAddCls } from "./ui/buttonStyles";

interface ClientNotesPanelProps {
  clientId: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

const inputCls =
  "w-full bg-ink-50 border border-ink-200 focus:border-gold-400 focus:bg-white focus:ring-2 focus:ring-gold-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all resize-y min-h-[4.5rem]";

function formatNoteDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClientNotesPanel({ clientId, toast }: ClientNotesPanelProps) {
  const { t, locale } = useI18n();
  const { connectionState } = useOnlineStatus();
  const { memberId, role } = useOrganization();
  const canWrite = useCan("client_notes.write");
  const canReadAll = role === "owner" || role === "director" || role === "admin";
  const { data: notes = [], isLoading, isError, error } = useClientNotes(clientId);
  const addNote = useAddClientNote();
  const deleteNote = useDeleteClientNote();
  const [body, setBody] = useState("");

  const handleAdd = async () => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const result = await addNote.mutateAsync({ clientId, body });
    if (result.success) {
      setBody("");
      toast(t("notes.success.added"), "success");
      return;
    }
    toast(resolveMutationError(result.error, "common.saveFailed", t), "error");
  };

  const handleDelete = async (noteId: string) => {
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const result = await deleteNote.mutateAsync({ noteId, clientId });
    if (result.success) {
      toast(t("notes.success.deleted"), "success");
      return;
    }
    toast(resolveMutationError(result.error, "common.deleteFailed", t), "error");
  };

  const canDeleteNote = (authorMemberId: string) =>
    canReadAll || (role === "teacher" && authorMemberId === memberId);

  return (
    <div className="panel-card-stack">
      <div className="flex items-center gap-2 text-ink-800 border-b border-ink-100 pb-3">
        <MessageSquare className="w-4 h-4 text-gold-500" />
        <h3 className="text-sm font-semibold tracking-tight">{t("notes.title")}</h3>
        <span className="text-[10px] font-sans bg-ink-100 text-ink-500 px-2 py-0.5 rounded-full font-semibold">
          {notes.length}
        </span>
      </div>

      {isLoading ? (
        <LoadingState label={t("notes.loading")} />
      ) : isError ? (
        <QueryErrorState error={error} />
      ) : notes.length === 0 ? (
        <p className="text-sm text-ink-500 py-4 text-center">{t("notes.empty")}</p>
      ) : (
        <ul className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-ink-100 bg-ink-50/10 px-3 py-2.5 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-ink-800 whitespace-pre-wrap break-words">{note.body}</p>
                  <p className="text-[10px] text-ink-500 mt-1.5 font-sans">
                    {isI18nKey(note.authorDisplayName) ? t(note.authorDisplayName) : note.authorDisplayName} ·{" "}
                    {formatNoteDate(note.createdAt, locale)}
                  </p>
                </div>
                {canDeleteNote(note.authorMemberId) && (
                  <RequirePermission action="client_notes.write">
                    <button
                      type="button"
                      onClick={() => void handleDelete(note.id)}
                      disabled={connectionState !== "online" || deleteNote.isPending}
                      title={translateConnectionBlockReason(connectionState, t) ?? t("common.delete")}
                      className="p-1 text-ink-400 hover:text-garnet-600 hover:bg-garnet-50 rounded-lg transition-all cursor-pointer shrink-0 disabled:opacity-40"
                      aria-label={t("notes.deleteAria")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </RequirePermission>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <RequirePermission action="client_notes.write">
          <div className="panel-form-stack pt-1 border-t border-ink-100">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("notes.placeholder")}
              className={inputCls}
              rows={3}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={connectionState !== "online" || addNote.isPending || !body.trim()}
              title={translateConnectionBlockReason(connectionState, t)}
              className={`w-full ${btnAddCls}`}
            >
              {addNote.isPending ? t("notes.addPending") : t("notes.addSubmit")}
            </button>
          </div>
        </RequirePermission>
      )}
    </div>
  );
}
