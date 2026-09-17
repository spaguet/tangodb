import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquare, Send, TicketPlus, X, Edit } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Client } from "../types";
import type { ToastType } from "../App";
import { formatTelegramDisplay, normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useCan } from "../hooks/usePermissions";
import { useClientCard, useUpdateClient } from "../hooks/useClients";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  formatClientName,
  isClientNameRelationshipLabel,
} from "../lib/clientDisplay";
import { formatCurrency } from "../lib/utils";
import { useClientFieldPlaceholders } from "../hooks/useClientFieldPlaceholders";
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

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

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
  const fieldPlaceholders = useClientFieldPlaceholders();
  const { role } = useOrganization();
  const canReadNotes = useCan("client_notes.read");
  const canSellSubscription = useCan("subscriptions.sell");
  const debtorsQuery = useFinancialDebtors({ enabled: Boolean(client) });
  const { connectionState } = useOnlineStatus();
  const updateClient = useUpdateClient();
  const loadFullCard = role === "teacher";
  const cardQuery = useClientCard(client?.id ?? null, Boolean(client) && loadFullCard);
  const displayClient = loadFullCard ? (cardQuery.data ?? client) : client;
  const cardPending = Boolean(loadFullCard && cardQuery.isFetching && !cardQuery.data);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [detailTab, setDetailTab] = useState<"profile" | "notes">("profile");
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
    if (!displayClient) {
      setMode("view");
      return;
    }
    const fields = populateEditFields(displayClient);
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
    setDetailTab("profile");
  }, [displayClient]);

  const clientDebtTotal = useMemo(() => {
    if (!displayClient?.id) return 0;
    const rows = debtorsQuery.data ?? [];
    const id = displayClient.id;
    return rows
      .filter(
        (row) =>
          row.payerClientId === id ||
          row.clientId1 === id ||
          row.clientId2 === id ||
          row.clientId3 === id ||
          row.clientId4 === id
      )
      .reduce((sum, row) => sum + Math.max(0, row.amount), 0);
  }, [debtorsQuery.data, displayClient?.id]);

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
    if (!displayClient || cardPending) return;
    const fields = populateEditFields(displayClient);
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
    if (!displayClient) return;
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
      clientId: displayClient.id,
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
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => (mode === "edit" ? setMode("view") : onClose())}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs cursor-default"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight text-slate-900 truncate">
                  {mode === "edit"
                    ? t("clients.modal.editTitle")
                    : formatClientName((displayClient ?? client).lastName, (displayClient ?? client).firstName)}
                </h2>
                {mode === "view" && displayClient && isClientNameRelationshipLabel(displayClient) ? (
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 mt-0.5">
                    {t("clientCard.nameLabelBadge")}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {mode === "view" ? (
                  <RequirePermission action="clients.write">
                    <button
                      type="button"
                      onClick={startEdit}
                      disabled={connectionState !== "online" || cardPending}
                      title={translateConnectionBlockReason(connectionState, t) ?? t("common.change")}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
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
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {mode === "view" && displayClient ? (
              <>
                <div className="flex flex-wrap gap-2 pt-1">
                  {canSellSubscription ? (
                    <Link
                      to={`/subscriptions/sell?client=${displayClient.id}`}
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
                    >
                      <TicketPlus className="w-3.5 h-3.5" />
                      {t("clientCard.sellCta")}
                    </Link>
                  ) : null}
                  {displayClient.telegram && normalizeTelegramContact(displayClient.telegram) ? (
                    <button
                      type="button"
                      onClick={() => openTelegramContact(displayClient.telegram)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#229ED9]/30 bg-[#229ED9]/10 text-[#1C82B4] text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t("clientCard.writeCta")}
                    </button>
                  ) : displayClient.phone.trim() ? (
                    <a
                      href={`tel:${displayClient.phone.replace(/\s/g, "")}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 text-xs font-semibold"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {t("clientCard.writeCta")}
                    </a>
                  ) : null}
                </div>

                {canReadNotes ? (
                  <div className="flex gap-1 border-b border-slate-100 mt-3">
                    <button
                      type="button"
                      onClick={() => setDetailTab("profile")}
                      className={`px-3 py-2 text-xs font-semibold rounded-t-lg cursor-pointer ${
                        detailTab === "profile"
                          ? "text-indigo-700 bg-indigo-50 border border-b-white border-slate-200 -mb-px"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {t("clientCard.tab.profile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab("notes")}
                      className={`px-3 py-2 text-xs font-semibold rounded-t-lg cursor-pointer ${
                        detailTab === "notes"
                          ? "text-indigo-700 bg-indigo-50 border border-b-white border-slate-200 -mb-px"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {t("clientCard.tab.notes")}
                    </button>
                  </div>
                ) : null}

                {detailTab === "profile" || !canReadNotes ? (
                  <div className="space-y-3 font-sans pt-3">
                    {cardPending ? (
                      <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                        {t("clients.loading")}
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                          {t("clients.form.phone")}
                        </p>
                        <p className="text-slate-700 mt-0.5">
                          {displayClient.phone.trim() ? displayClient.phone : t("clientCard.phoneNotSet")}
                        </p>
                      </div>
                      {clientDebtTotal > 0 ? (
                        <div>
                          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                            {t("clientCard.debt")}
                          </p>
                          <p className="text-rose-700 font-semibold mt-0.5">{formatCurrency(clientDebtTotal)}</p>
                        </div>
                      ) : null}
                    </div>

                    <ProfileField label={t("clients.form.email")} value={displayClient.email} />

                    <div>
                      <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">Telegram</p>
                      {displayClient.telegram && normalizeTelegramContact(displayClient.telegram) ? (
                        <a
                          href={normalizeTelegramContact(displayClient.telegram)!}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => {
                            e.preventDefault();
                            openTelegramContact(displayClient.telegram);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-0.5 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans transition-colors"
                        >
                          <Send className="w-3 h-3" />
                          {formatTelegramDisplay(displayClient.telegram)}
                        </a>
                      ) : cardPending ? null : (
                        <span className="text-xs text-slate-400 italic">{t("clientCard.telegramNotSet")}</span>
                      )}
                    </div>

                    {displayClient.isMinor ? (
                      <div className="space-y-2 border-t border-slate-100 pt-3">
                        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                          {t("clients.form.isMinor")}
                        </p>
                        <GuardianBlock
                          title={t("clients.form.guardian1")}
                          name={displayClient.guardian1Name}
                          phone={displayClient.guardian1Phone}
                          telegram={displayClient.guardian1Telegram}
                          address={displayClient.guardian1Address}
                          t={t}
                        />
                        <GuardianBlock
                          title={t("clients.form.guardian2")}
                          name={displayClient.guardian2Name}
                          phone={displayClient.guardian2Phone}
                          telegram={displayClient.guardian2Telegram}
                          address={displayClient.guardian2Address}
                          t={t}
                        />
                      </div>
                    ) : null}

                    <ClientSubscriptionParticipationPanel clientId={displayClient.id} />
                  </div>
                ) : (
                  <div className="pt-3">
                    <ClientNotesPanel clientId={displayClient.id} toast={toast} />
                  </div>
                )}
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
                    placeholder={fieldPlaceholders.phone}
                    className={inputCls}
                  />
                </div>

                <div className="field-stack">
                  <label className={labelCls}>{t("clients.form.email")}</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder={fieldPlaceholders.email}
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

                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsMinor}
                    onChange={(e) => setEditIsMinor(e.target.checked)}
                    className={checkboxCls}
                  />
                  {t("clients.form.isMinor")}
                </label>

                {editIsMinor ? (
                  <div className="space-y-4 border border-slate-100 rounded-lg p-3">
                    <p className="text-xs font-semibold text-slate-600">{t("clients.form.guardian1")}</p>
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
                        <span className="absolute left-3.5 top-3 text-xs text-slate-400 font-sans pointer-events-none">t.me/</span>
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

                    <p className="text-xs font-semibold text-slate-600 pt-1">{t("clients.form.guardian2")}</p>
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
                        <span className="absolute left-3.5 top-3 text-xs text-slate-400 font-sans pointer-events-none">t.me/</span>
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
