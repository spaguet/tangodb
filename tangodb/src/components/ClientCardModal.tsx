import { useEffect, useState } from "react";
import { Send, X, Edit } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Client } from "../types";
import type { ToastType } from "../App";
import { formatTelegramDisplay, normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useCan } from "../hooks/usePermissions";
import { useUpdateClient } from "../hooks/useClients";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { resolveMutationError } from "../lib/resolveMutationError";
import { useI18n } from "../hooks/useI18n";
import ClientNotesPanel from "./ClientNotesPanel";
import ClientSubscriptionParticipationPanel from "./clients/ClientSubscriptionParticipationPanel";
import RequirePermission from "./RequirePermission";
import { fieldCls as inputCls } from "./ui/AppSelect";
import { btnAddCls, btnCancelCls } from "./ui/buttonStyles";

interface ClientCardModalProps {
  client: Client | null;
  onClose: () => void;
  toast: (msg: string, type?: ToastType) => void;
  stackLayer?: "default" | "above";
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-ink-300 text-gold-700 focus:ring-gold-500";

function ProfileField({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div>
      <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">{label}</p>
      <p className="text-sm text-ink-700 mt-0.5">{value}</p>
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
    <div className="border border-ink-100 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-ink-600">{title}</p>
      <ProfileField label={t("clients.form.guardianName")} value={name} />
      <ProfileField label={t("clients.form.phone")} value={phone} />
      {telegram && normalizeTelegramContact(telegram) ? (
        <div>
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">Telegram</p>
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

function populateEditFields(client: Client) {
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    telegram: client.telegram,
    phone: client.phone,
    email: client.email,
    isMinor: client.isMinor,
    guardian1Name: client.guardian1Name,
    guardian1Phone: client.guardian1Phone,
    guardian1Telegram: client.guardian1Telegram,
    guardian1Address: client.guardian1Address,
    guardian2Name: client.guardian2Name,
    guardian2Phone: client.guardian2Phone,
    guardian2Telegram: client.guardian2Telegram,
    guardian2Address: client.guardian2Address,
  };
}

export default function ClientCardModal({
  client,
  onClose,
  toast,
  stackLayer = "default",
}: ClientCardModalProps) {
  const { t } = useI18n();
  const canReadNotes = useCan("client_notes.read");
  const { connectionState } = useOnlineStatus();
  const updateClient = useUpdateClient();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editTg, setEditTg] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editIsMinor, setEditIsMinor] = useState(false);
  const [editGuardian1Name, setEditGuardian1Name] = useState("");
  const [editGuardian1Phone, setEditGuardian1Phone] = useState("");
  const [editGuardian1Telegram, setEditGuardian1Telegram] = useState("");
  const [editGuardian1Address, setEditGuardian1Address] = useState("");
  const [editGuardian2Name, setEditGuardian2Name] = useState("");
  const [editGuardian2Phone, setEditGuardian2Phone] = useState("");
  const [editGuardian2Telegram, setEditGuardian2Telegram] = useState("");
  const [editGuardian2Address, setEditGuardian2Address] = useState("");

  const zClass = stackLayer === "above" ? "z-[60]" : "z-50";

  useEffect(() => {
    if (!client) {
      setMode("view");
      return;
    }
    const fields = populateEditFields(client);
    setEditFirst(fields.firstName);
    setEditLast(fields.lastName);
    setEditTg(fields.telegram);
    setEditPhone(fields.phone);
    setEditEmail(fields.email);
    setEditIsMinor(fields.isMinor);
    setEditGuardian1Name(fields.guardian1Name);
    setEditGuardian1Phone(fields.guardian1Phone);
    setEditGuardian1Telegram(fields.guardian1Telegram);
    setEditGuardian1Address(fields.guardian1Address);
    setEditGuardian2Name(fields.guardian2Name);
    setEditGuardian2Phone(fields.guardian2Phone);
    setEditGuardian2Telegram(fields.guardian2Telegram);
    setEditGuardian2Address(fields.guardian2Address);
    setMode("view");
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "edit") {
          setMode("view");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [client, mode, onClose]);

  const startEdit = () => {
    if (!client) return;
    const fields = populateEditFields(client);
    setEditFirst(fields.firstName);
    setEditLast(fields.lastName);
    setEditTg(fields.telegram);
    setEditPhone(fields.phone);
    setEditEmail(fields.email);
    setEditIsMinor(fields.isMinor);
    setEditGuardian1Name(fields.guardian1Name);
    setEditGuardian1Phone(fields.guardian1Phone);
    setEditGuardian1Telegram(fields.guardian1Telegram);
    setEditGuardian1Address(fields.guardian1Address);
    setEditGuardian2Name(fields.guardian2Name);
    setEditGuardian2Phone(fields.guardian2Phone);
    setEditGuardian2Telegram(fields.guardian2Telegram);
    setEditGuardian2Address(fields.guardian2Address);
    setMode("edit");
  };

  const handleSaveEdit = async () => {
    if (!client) return;
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    if (!editFirst.trim() || !editLast.trim()) {
      toast(t("clients.error.emptyName"), "error");
      return;
    }

    const res = await updateClient.mutateAsync({
      clientId: client.id,
      firstName: editFirst,
      lastName: editLast,
      telegram: editTg,
      phone: editPhone,
      email: editEmail,
      isMinor: editIsMinor,
      guardian1Name: editGuardian1Name,
      guardian1Phone: editGuardian1Phone,
      guardian1Telegram: editGuardian1Telegram,
      guardian1Address: editGuardian1Address,
      guardian2Name: editGuardian2Name,
      guardian2Phone: editGuardian2Phone,
      guardian2Telegram: editGuardian2Telegram,
      guardian2Address: editGuardian2Address,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.saveFailed", t), "error");
    } else {
      toast(t("clients.success.updated"), "success");
      setMode("view");
    }
  };

  return (
    <AnimatePresence>
      {client && (
        <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`} role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => (mode === "edit" ? setMode("view") : onClose())}
            className="absolute inset-0 bg-ink-950/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-ink-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-ink-100 pb-3 gap-2">
              <h2 className="text-base font-semibold tracking-tight text-ink-900 min-w-0 truncate">
                {mode === "edit" ? t("clients.modal.editTitle") : `${client.lastName} ${client.firstName}`}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                {mode === "view" ? (
                  <RequirePermission action="clients.write">
                    <button
                      type="button"
                      onClick={startEdit}
                      disabled={connectionState !== "online"}
                      title={translateConnectionBlockReason(connectionState, t) ?? t("common.change")}
                      className="p-1.5 text-ink-400 hover:text-gold-800 hover:bg-gold-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                      aria-label={t("common.change")}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </RequirePermission>
                ) : null}
                <button
                  type="button"
                  onClick={() => (mode === "edit" ? setMode("view") : onClose())}
                  aria-label={t("common.close")}
                  className="p-1 text-ink-400 hover:text-ink-700 rounded-full hover:bg-ink-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {mode === "view" ? (
              <>
                <div className="space-y-3 font-sans">
                  <div className="grid grid-cols-1 gap-3">
                    <ProfileField label={t("clients.form.firstName")} value={client.firstName} />
                    <ProfileField label={t("clients.form.lastName")} value={client.lastName} />
                    <ProfileField label={t("clients.form.phone")} value={client.phone} />
                    <ProfileField label={t("clients.form.email")} value={client.email} />
                  </div>

                  <div>
                    <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">Telegram</p>
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
                      <span className="text-xs text-ink-500 italic">{t("clientCard.telegramNotSet")}</span>
                    )}
                  </div>

                  {client.isMinor ? (
                    <div className="space-y-2 border-t border-ink-100 pt-3">
                      <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">
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
              </>
            ) : (
              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.firstName")}</label>
                  <input type="text" value={editFirst} onChange={(e) => setEditFirst(e.target.value)} className={inputCls} />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.lastName")}</label>
                  <input type="text" value={editLast} onChange={(e) => setEditLast(e.target.value)} className={inputCls} />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.phone")}</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder={t("clients.placeholder.phone")}
                    className={inputCls}
                  />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.email")}</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder={t("clients.placeholder.email")}
                    className={inputCls}
                  />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.telegramLink")}</label>
                  <input
                    type="text"
                    value={editTg}
                    placeholder="https://t.me/username"
                    onChange={(e) => setEditTg(e.target.value)}
                    className={`${inputCls} font-sans text-xs`}
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsMinor}
                    onChange={(e) => setEditIsMinor(e.target.checked)}
                    className={checkboxCls}
                  />
                  {t("clients.form.isMinor")}
                </label>

                {editIsMinor ? (
                  <div className="space-y-4 border border-ink-100 rounded-lg p-3">
                    <p className="text-xs font-semibold text-ink-600">{t("clients.form.guardian1")}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="field-stack">
                        <label className={labelCls}>{t("clients.form.guardianName")}</label>
                        <input type="text" value={editGuardian1Name} onChange={(e) => setEditGuardian1Name(e.target.value)} className={inputCls} />
                      </div>
                      <div className="field-stack">
                        <label className={labelCls}>{t("clients.form.phone")}</label>
                        <input type="tel" value={editGuardian1Phone} onChange={(e) => setEditGuardian1Phone(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>Telegram</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-xs text-ink-500 font-sans pointer-events-none">t.me/</span>
                        <input
                          type="text"
                          value={editGuardian1Telegram.replace(/https?:\/\/t\.me\//, "")}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setEditGuardian1Telegram(val === "" ? "" : `https://t.me/${val.replace(/@/, "")}`);
                          }}
                          placeholder="username"
                          className={`${inputCls} pl-12 font-sans`}
                        />
                      </div>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardianAddress")}</label>
                      <input type="text" value={editGuardian1Address} onChange={(e) => setEditGuardian1Address(e.target.value)} className={inputCls} />
                    </div>

                    <p className="text-xs font-semibold text-ink-600 pt-1">{t("clients.form.guardian2")}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="field-stack">
                        <label className={labelCls}>{t("clients.form.guardianName")}</label>
                        <input type="text" value={editGuardian2Name} onChange={(e) => setEditGuardian2Name(e.target.value)} className={inputCls} />
                      </div>
                      <div className="field-stack">
                        <label className={labelCls}>{t("clients.form.phone")}</label>
                        <input type="tel" value={editGuardian2Phone} onChange={(e) => setEditGuardian2Phone(e.target.value)} className={inputCls} />
                      </div>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>Telegram</label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-3 text-xs text-ink-500 font-sans pointer-events-none">t.me/</span>
                        <input
                          type="text"
                          value={editGuardian2Telegram.replace(/https?:\/\/t\.me\//, "")}
                          onChange={(e) => {
                            const val = e.target.value.trim();
                            setEditGuardian2Telegram(val === "" ? "" : `https://t.me/${val.replace(/@/, "")}`);
                          }}
                          placeholder="username"
                          className={`${inputCls} pl-12 font-sans`}
                        />
                      </div>
                    </div>
                    <div className="field-stack">
                      <label className={labelCls}>{t("clients.form.guardianAddress")}</label>
                      <input type="text" value={editGuardian2Address} onChange={(e) => setEditGuardian2Address(e.target.value)} className={inputCls} />
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center gap-3 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => void handleSaveEdit()}
                    disabled={connectionState !== "online" || updateClient.isPending}
                    title={translateConnectionBlockReason(connectionState, t)}
                    className={`flex-1 ${btnAddCls}`}
                  >
                    {updateClient.isPending ? t("clients.modal.savePending") : t("clients.modal.save")}
                  </button>
                  <button type="button" onClick={() => setMode("view")} className={`flex-1 ${btnCancelCls}`}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
