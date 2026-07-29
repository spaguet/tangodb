import { Send, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Client } from "../types";
import type { ToastType } from "../App";
import { formatTelegramDisplay, normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useCan } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import ClientNotesPanel from "./ClientNotesPanel";
import ClientSubscriptionParticipationPanel from "./clients/ClientSubscriptionParticipationPanel";

interface ClientCardModalProps {
  client: Client | null;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
}

function ProfileField({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div>
      <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-sm text-slate-700 mt-0.5">{value}</p>
    </div>
  );
}

function GuardianBlock({
  title,
  name,
  phone,
  telegram,
  address,
  t,
}: {
  title: string;
  name: string;
  phone: string;
  telegram: string;
  address: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const hasData = [name, phone, telegram, address].some((v) => v.trim());
  if (!hasData) return null;

  return (
    <div className="border border-slate-100 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-600">{title}</p>
      <ProfileField label={t("clients.form.guardianName")} value={name} />
      <ProfileField label={t("clients.form.phone")} value={phone} />
      {telegram && normalizeTelegramContact(telegram) ? (
        <div>
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">Telegram</p>
          <a
            href={normalizeTelegramContact(telegram)!}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault();
              openTelegramContact(telegram);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-0.5 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans transition-colors"
          >
            <Send className="w-3 h-3" />
            {formatTelegramDisplay(telegram)}
          </a>
        </div>
      ) : null}
      <ProfileField label={t("clients.form.guardianAddress")} value={address} />
    </div>
  );
}

export default function ClientCardModal({ client, onClose, toast }: ClientCardModalProps) {
  const { t } = useI18n();
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
                aria-label={t("common.close")}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 font-sans">
              <div className="grid grid-cols-1 gap-3">
                <ProfileField label={t("clients.form.firstName")} value={client.firstName} />
                <ProfileField label={t("clients.form.lastName")} value={client.lastName} />
                <ProfileField label={t("clients.form.phone")} value={client.phone} />
                <ProfileField label={t("clients.form.email")} value={client.email} />
              </div>

              <div>
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">Telegram</p>
                {client.telegram && normalizeTelegramContact(client.telegram) ? (
                  <a
                    href={normalizeTelegramContact(client.telegram)!}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      openTelegramContact(client.telegram);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-0.5 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans transition-colors"
                  >
                    <Send className="w-3 h-3" />
                    {formatTelegramDisplay(client.telegram)}
                  </a>
                ) : (
                  <span className="text-xs text-slate-400 italic">{t("clientCard.telegramNotSet")}</span>
                )}
              </div>

              {client.isMinor ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                    {t("clients.form.isMinor")}
                  </p>
                  <GuardianBlock
                    title={t("clients.form.guardian1")}
                    name={client.guardian1Name}
                    phone={client.guardian1Phone}
                    telegram={client.guardian1Telegram}
                    address={client.guardian1Address}
                    t={t}
                  />
                  <GuardianBlock
                    title={t("clients.form.guardian2")}
                    name={client.guardian2Name}
                    phone={client.guardian2Phone}
                    telegram={client.guardian2Telegram}
                    address={client.guardian2Address}
                    t={t}
                  />
                </div>
              ) : null}
            </div>

            <ClientSubscriptionParticipationPanel clientId={client.id} />

            {canReadNotes && <ClientNotesPanel clientId={client.id} toast={toast} />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
