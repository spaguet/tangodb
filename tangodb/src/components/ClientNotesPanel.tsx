import { useState } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import {
  useAddClientNote,
  useClientNotes,
  useDeleteClientNote,
} from "../hooks/useClientNotes";
import {
  getConnectionBlockReason,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { useCan } from "../hooks/usePermissions";
import { useOrganization } from "../organization/OrganizationProvider";
import RequirePermission from "./RequirePermission";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";

interface ClientNotesPanelProps {
  clientId: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

const inputCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all resize-y min-h-[4.5rem]";

function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClientNotesPanel({ clientId, toast }: ClientNotesPanelProps) {
  const { connectionState } = useOnlineStatus();
  const { memberId, role } = useOrganization();
  const canWrite = useCan("client_notes.write");
  const canReadAll = role === "owner" || role === "director" || role === "admin";
  const { data: notes = [], isLoading, isError, error } = useClientNotes(clientId);
  const addNote = useAddClientNote();
  const deleteNote = useDeleteClientNote();
  const [body, setBody] = useState("");

  const handleAdd = async () => {
    const result = await addNote.mutateAsync({ clientId, body });
    if (result.success) {
      setBody("");
      toast("Заметка добавлена", "success");
      return;
    }
    toast(result.error, "error");
  };

  const handleDelete = async (noteId: string) => {
    const result = await deleteNote.mutateAsync({ noteId, clientId });
    if (result.success) {
      toast("Заметка удалена", "success");
      return;
    }
    toast(result.error, "error");
  };

  const canDeleteNote = (authorMemberId: string) =>
    canReadAll || (role === "teacher" && authorMemberId === memberId);

  return (
    <div className="panel-card-stack">
      <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-3">
        <MessageSquare className="w-4 h-4 text-indigo-500" />
        <h3 className="text-sm font-semibold tracking-tight">Заметки</h3>
        <span className="text-[10px] font-sans bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">
          {notes.length}
        </span>
      </div>

      {isLoading ? (
        <LoadingState label="Загрузка заметок..." />
      ) : isError ? (
        <QueryErrorState error={error} />
      ) : notes.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">Заметок пока нет</p>
      ) : (
        <ul className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-slate-800 whitespace-pre-wrap break-words">{note.body}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5 font-sans">
                    {note.authorDisplayName} · {formatNoteDate(note.createdAt)}
                  </p>
                </div>
                {canDeleteNote(note.authorMemberId) && (
                  <RequirePermission action="client_notes.write">
                    <button
                      type="button"
                      onClick={() => void handleDelete(note.id)}
                      disabled={connectionState !== "online" || deleteNote.isPending}
                      title={getConnectionBlockReason(connectionState) ?? "Удалить"}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0 disabled:opacity-40"
                      aria-label="Удалить заметку"
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
          <div className="panel-form-stack pt-1 border-t border-slate-100">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Новая заметка по ученику..."
              className={inputCls}
              rows={3}
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={connectionState !== "online" || addNote.isPending || !body.trim()}
              title={getConnectionBlockReason(connectionState)}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {addNote.isPending ? "Сохранение..." : "Добавить заметку"}
            </button>
          </div>
        </RequirePermission>
      )}
    </div>
  );
}
