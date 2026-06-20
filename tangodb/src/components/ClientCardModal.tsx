import { Send, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Client } from "../types";
import type { ToastType } from "../App";
import { formatTelegramDisplay, normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useCan } from "../hooks/usePermissions";
import ClientNotesPanel from "./ClientNotesPanel";

interface ClientCardModalProps {
  client: Client | null;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
}

export default function ClientCardModal({ client, onClose, toast }: ClientCardModalProps) {
  const canReadNotes = useCan("client_notes.read");

  return (
    <AnimatePresence>
      {client && (
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
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                {client.lastName} {client.firstName}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-sm text-slate-600 font-sans space-y-1">
              {client.telegram && normalizeTelegramContact(client.telegram) ? (
                <a
                  href={normalizeTelegramContact(client.telegram)!}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    openTelegramContact(client.telegram);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans transition-colors"
                >
                  <Send className="w-3 h-3" />
                  {formatTelegramDisplay(client.telegram)}
                </a>
              ) : (
                <span className="text-xs text-slate-400 italic">Telegram не указан</span>
              )}
            </div>

            {canReadNotes && <ClientNotesPanel clientId={client.id} toast={toast} />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
