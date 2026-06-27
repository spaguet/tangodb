/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { Search, UserPlus, FileText, Send, Edit, Trash2, X, Users, Archive, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  useAddClient,
  useArchiveClient,
  useClientDirectory,
  useClients,
  useRestoreClient,
  useUpdateClient,
} from "../hooks/useClients";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { resolveMutationError } from "../lib/resolveMutationError";
import { formatTelegramDisplay, normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useCan } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import ClientCardModal from "./ClientCardModal";
import ConfirmDialog from "./ui/ConfirmDialog";
import RequirePermission from "./RequirePermission";
import LoadingState from "./ui/LoadingState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import QueryErrorState from "./ui/QueryErrorState";
import { fieldCls as inputCls } from "./ui/AppSelect";
import type { ToastType } from "../App";
import type { Client } from "../types";

interface ClientsPanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

type ClientTab = "active" | "archive";

export default function ClientsPanel({ toast }: ClientsPanelProps) {
  const { t, formatDateTime } = useI18n();
  const { connectionState } = useOnlineStatus();

  const clientTabs = [
    { id: "active" as const, label: t("clients.tab.active"), icon: Users },
    { id: "archive" as const, label: t("clients.tab.archive"), icon: Archive },
  ];

  const formatArchivedAt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return formatDateTime(d, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const canOpenClientCard = useCan("client_notes.read");
  const [activeTab, setActiveTab] = useState<ClientTab>("active");
  const {
    data: clients = [],
    isLoading: activeLoading,
    isError: activeError,
    error: activeQueryError,
  } = useClients();
  const {
    data: directoryClients = [],
    isLoading: directoryLoading,
    isError: directoryError,
    error: directoryQueryError,
  } = useClientDirectory();
  const addClient = useAddClient();
  const updateClient = useUpdateClient();
  const archiveClient = useArchiveClient();
  const restoreClient = useRestoreClient();
  const [search, setSearch] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [telegram, setTelegram] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  // Editing state
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editTg, setEditTg] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<Client | null>(null);
  const [cardClient, setCardClient] = useState<Client | null>(null);

  useEffect(() => {
    if (!editingClient) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingClient(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingClient]);

  useEffect(() => {
    if (!cardClient) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardClient(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardClient]);

  const openClientCard = (client: Client) => {
    if (canOpenClientCard) setCardClient(client);
  };

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      toast(t("clients.error.nameRequired"), "error");
      return;
    }

    const res = await addClient.mutateAsync({ firstName, lastName, telegram, phone, email });
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.addFailed", t), "error");
    } else {
      toast(t("clients.success.added"), "success");
      setFirstName("");
      setLastName("");
      setTelegram("");
      setPhone("");
      setEmail("");
    }
  };

  const startEdit = (c: Client) => {
    setEditingClient(c);
    setEditFirst(c.firstName);
    setEditLast(c.lastName);
    setEditTg(c.telegram);
    setEditPhone(c.phone);
    setEditEmail(c.email);
  };

  const handleSaveEdit = async () => {
    if (!editingClient) return;
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
      clientId: editingClient.id,
      firstName: editFirst,
      lastName: editLast,
      telegram: editTg,
      phone: editPhone,
      email: editEmail,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.saveFailed", t), "error");
    } else {
      toast(t("clients.success.updated"), "success");
      setEditingClient(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!deleteTarget) return;
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    const res = await archiveClient.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.archiveFailed", t), "error");
    } else {
      toast(
        t("clients.success.archived", {
          lastName: deleteTarget.lastName,
          firstName: deleteTarget.firstName,
        }),
        "success"
      );
      setDeleteTarget(null);
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    if (connectionState !== "online") {
      const blocked = translateMutationBlockedMessage(connectionState, t);
      if (blocked) toast(blocked, "error");
      return;
    }
    const res = await restoreClient.mutateAsync(restoreTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "clients.error.restoreFailed", t), "error");
    } else {
      toast(
        t("clients.success.restored", {
          lastName: restoreTarget.lastName,
          firstName: restoreTarget.firstName,
        }),
        "success"
      );
      setRestoreTarget(null);
    }
  };

  const archivedClients = useMemo(
    () =>
      directoryClients
        .filter((c) => c.archivedAt)
        .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")),
    [directoryClients]
  );

  const isLoading = activeTab === "active" ? activeLoading : directoryLoading;
  const isError = activeTab === "active" ? activeError : directoryError;
  const error = activeTab === "active" ? activeQueryError : directoryQueryError;

  if (isLoading) return <LoadingState label={t("clients.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  const filteredClients = clients.filter(
    (c) =>
      c.firstName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastName.toLowerCase().includes(search.toLowerCase())
  );

  const filteredArchivedClients = archivedClients.filter(
    (c) =>
      c.firstName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div id="panel-newClient" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* Sidebar form: Add Guest */}
      <RequirePermission
        action="clients.write"
        fallback={
          <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs text-xs text-slate-500">
            {t("clients.readOnlyHint")}
          </div>
        }
      >
      <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
          <UserPlus className="w-4.5 h-4.5 text-indigo-500" />
          <h2 className="text-base font-semibold tracking-tight">{t("clients.form.addTitle")}</h2>
        </div>

        <form onSubmit={handleSubmitAdd} className="panel-form-stack font-sans">
          <div className="field-stack">
            <label className={labelCls}>{t("clients.form.firstName")}</label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t("clients.placeholder.firstName")}
              className={inputCls}
            />
          </div>

          <div className="field-stack">
            <label className={labelCls}>{t("clients.form.lastName")}</label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t("clients.placeholder.lastName")}
              className={inputCls}
            />
          </div>

          <div className="field-stack">
            <label className={labelCls}>{t("clients.form.phone")}</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("clients.placeholder.phone")}
              className={inputCls}
            />
          </div>

          <div className="field-stack">
            <label className={labelCls}>{t("clients.form.email")}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("clients.placeholder.email")}
              className={inputCls}
            />
          </div>

          <div className="field-stack">
            <label className={labelCls}>Telegram</label>
            <div className="relative">
              <span className="absolute left-3.5 top-3 text-xs text-slate-400 font-sans pointer-events-none">t.me/</span>
              <input
                type="text"
                value={telegram.replace(/https?:\/\/t\.me\//, "")}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (val === "") {
                    setTelegram("");
                  } else {
                    setTelegram(`https://t.me/${val.replace(/@/, "")}`);
                  }
                }}
                placeholder="username"
                className={`${inputCls} pl-12 font-sans`}
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-normal">
              {t("clients.form.telegramHint")}
            </p>
          </div>

          <button
            type="submit"
            disabled={connectionState !== "online" || addClient.isPending}
            title={translateConnectionBlockReason(connectionState, t)}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
          >
            {addClient.isPending ? t("clients.form.addPending") : t("clients.form.addSubmit")}
          </button>
        </form>
      </div>
      </RequirePermission>

      {/* Main Table details */}
      <div className="lg:col-span-8 flex flex-col">
        <PageTabs tabs={[...clientTabs]} activeTab={activeTab} onChange={(tab) => setActiveTab(tab as ClientTab)} />

        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "active")}`}
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5 text-slate-800">
              <FileText className="w-4.5 h-4.5 text-indigo-500" />
              <h2 className="text-base font-semibold tracking-tight">
                {activeTab === "active" ? t("clients.list.activeTitle") : t("clients.list.archiveTitle")}
              </h2>
              <span className="text-[10px] font-sans bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">
                {activeTab === "active" ? clients.length : archivedClients.length}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto font-sans">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t("clients.search.placeholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={`${inputCls} pl-10 text-xs`}
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto min-h-[300px]">
            {activeTab === "active" ? (
              filteredClients.length === 0 ? (
                <div className="text-center py-20 text-slate-400 space-y-1">
                  <p className="text-sm">
                    {search.trim()
                      ? t("clients.search.noResults", { query: search })
                      : t("clients.empty.active")}
                  </p>
                </div>
              ) : (
                <table className="w-full font-sans text-slate-700 text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-sans uppercase text-slate-400 tracking-wider">
                      <th className="pb-3 pl-2 pr-8 font-semibold w-12">#</th>
                      <th className="pb-3 font-semibold">{t("clients.table.clientName")}</th>
                      <th className="pb-3 font-semibold text-center">{t("clients.table.contact")}</th>
                      <th className="pb-3 text-right pr-2 font-semibold">{t("clients.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClients.map((c, i) => (
                      <tr
                        key={c.id}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors text-sm group"
                      >
                        <td className="py-3 pl-2 pr-8 font-sans text-xs text-slate-400">{i + 1}</td>
                        <td className="py-3 font-normal text-slate-800">
                          {canOpenClientCard ? (
                            <button
                              type="button"
                              onClick={() => openClientCard(c)}
                              className="text-left hover:text-indigo-600 transition-colors cursor-pointer"
                            >
                              {c.lastName} {c.firstName}
                            </button>
                          ) : (
                            <>
                              {c.lastName} {c.firstName}
                            </>
                          )}
                        </td>
                        <td className="py-3 text-center">
                          {c.telegram && normalizeTelegramContact(c.telegram) ? (
                            <a
                              href={normalizeTelegramContact(c.telegram)!}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                e.preventDefault();
                                openTelegramContact(c.telegram);
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans font-normal transition-colors"
                            >
                              <Send className="w-3 h-3" />
                              {formatTelegramDisplay(c.telegram)}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-300 italic font-sans">{t("clients.contact.notSet")}</span>
                          )}
                        </td>
                        <td className="py-3 text-right pr-2">
                          <RequirePermission action="clients.write">
                          <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(c)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                              title={t("clients.action.edit")}
                              aria-label={`${t("clients.action.edit")} ${c.lastName} ${c.firstName}`}
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(c)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              title={t("clients.action.archive")}
                              aria-label={`${t("clients.action.archive")} ${c.lastName} ${c.firstName}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          </RequirePermission>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : filteredArchivedClients.length === 0 ? (
              <div className="text-center py-20 text-slate-400 space-y-1">
                <p className="text-sm">
                  {search.trim()
                    ? t("clients.search.noResults", { query: search })
                    : t("clients.empty.archive")}
                </p>
              </div>
            ) : (
              <table className="w-full font-sans text-slate-700 text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-sans uppercase text-slate-400 tracking-wider">
                    <th className="pb-3 pl-2 pr-8 font-semibold w-12">#</th>
                    <th className="pb-3 font-semibold">{t("clients.table.lastName")}</th>
                    <th className="pb-3 font-semibold">{t("clients.table.firstName")}</th>
                    <th className="pb-3 font-semibold text-center">Telegram</th>
                    <th className="pb-3 font-semibold">{t("clients.table.archivedAt")}</th>
                    <th className="pb-3 text-right pr-2 font-semibold">{t("clients.table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArchivedClients.map((c, i) => (
                    <tr
                      key={c.id}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors text-sm group"
                    >
                      <td className="py-3 pl-2 pr-8 font-sans text-xs text-slate-400">{i + 1}</td>
                      <td className="py-3 font-normal text-slate-800">
                        {canOpenClientCard ? (
                          <button
                            type="button"
                            onClick={() => openClientCard(c)}
                            className="text-left hover:text-indigo-600 transition-colors cursor-pointer"
                          >
                            {c.lastName}
                          </button>
                        ) : (
                          c.lastName
                        )}
                      </td>
                      <td className="py-3 font-normal text-slate-800">
                        {canOpenClientCard ? (
                          <button
                            type="button"
                            onClick={() => openClientCard(c)}
                            className="text-left hover:text-indigo-600 transition-colors cursor-pointer"
                          >
                            {c.firstName}
                          </button>
                        ) : (
                          c.firstName
                        )}
                      </td>
                      <td className="py-3 text-center">
                        {c.telegram && normalizeTelegramContact(c.telegram) ? (
                          <a
                            href={normalizeTelegramContact(c.telegram)!}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c.telegram);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md text-xs font-sans font-normal transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {formatTelegramDisplay(c.telegram)}
                          </a>
                        ) : (
                          <span className="text-xs text-slate-300 italic font-sans">{t("clients.contact.notSet")}</span>
                        )}
                      </td>
                      <td className="py-3 text-slate-600 text-xs font-sans">
                        {c.archivedAt ? formatArchivedAt(c.archivedAt) : "—"}
                      </td>
                      <td className="py-3 text-right pr-2">
                        <RequirePermission action="clients.write">
                        <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setRestoreTarget(c)}
                            disabled={connectionState !== "online"}
                            title={translateConnectionBlockReason(connectionState, t) ?? t("clients.action.restore")}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label={`${t("clients.action.restore")} ${c.lastName} ${c.firstName}`}
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </div>
                        </RequirePermission>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editingClient && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingClient(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("clients.modal.editTitle")}</h3>
                <button
                  onClick={() => setEditingClient(null)}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

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
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  onClick={handleSaveEdit}
                  disabled={connectionState !== "online" || updateClient.isPending}
                  title={translateConnectionBlockReason(connectionState, t)}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {updateClient.isPending ? t("clients.modal.savePending") : t("clients.modal.save")}
                </button>
                <button
                  onClick={() => setEditingClient(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ClientCardModal client={cardClient} onClose={() => setCardClient(null)} toast={toast} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("clients.confirm.archiveTitle")}
        description={
          <>
            {t("clients.confirm.archiveBody")}{" "}
            <strong className="font-semibold text-slate-800">
              {deleteTarget?.lastName} {deleteTarget?.firstName}
            </strong>
          </>
        }
        confirmLabel={t("clients.confirm.archiveConfirm")}
        cancelLabel={t("clients.confirm.archiveCancel")}
        pending={archiveClient.isPending}
        onConfirm={handleConfirmArchive}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={restoreTarget !== null}
        title={t("clients.confirm.restoreTitle")}
        description={
          <>
            {t("clients.confirm.restoreBody")}{" "}
            <strong className="font-semibold text-slate-800">
              {restoreTarget?.lastName} {restoreTarget?.firstName}
            </strong>
          </>
        }
        confirmLabel={t("clients.confirm.restoreConfirm")}
        cancelLabel={t("common.cancel")}
        pending={restoreClient.isPending}
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
}
