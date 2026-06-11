/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Search, UserPlus, FileText, Send, Edit, Trash2, X, AlertOctagon } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useAddClient, useClients, useDeleteClient, useUpdateClient } from "../hooks/useClients";
import type { Client } from "../types";

interface ClientsPanelProps {
  toast: (msg: string) => void;
}

export default function ClientsPanel({ toast }: ClientsPanelProps) {
  const { data: clients = [], isLoading } = useClients();
  const addClient = useAddClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const [search, setSearch] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [telegram, setTelegram] = useState("");

  // Editing state
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editTg, setEditTg] = useState("");

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);

  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast("⚠️ Заполните Имя и Фамилию обязательными полями.");
      return;
    }

    toast("⏳ Добавление клиента...");
    const res = await addClient.mutateAsync({ firstName, lastName, telegram });
    if (!res.success) {
      toast(`⚠️ ${res.error || "Ошибка добавления"}`);
    } else {
      toast("✅ Карточка клиента добавлена в реестр");
      setFirstName("");
      setLastName("");
      setTelegram("");
    }
  };

  const startEdit = (c: Client) => {
    setEditingClient(c);
    setEditFirst(c.firstName);
    setEditLast(c.lastName);
    setEditTg(c.telegram);
  };

  const handleSaveEdit = async () => {
    if (!editingClient) return;
    if (!editFirst.trim() || !editLast.trim()) {
      toast("⚠️ Имя и фамилия не могут быть пустыми.");
      return;
    }

    toast("⏳ Сохранение...");
    const res = await updateClient.mutateAsync({
      clientId: editingClient.id,
      firstName: editFirst,
      lastName: editLast,
      telegram: editTg,
    });
    if (!res.success) {
      toast(`⚠️ ${res.error || "Ошибка сохранения изменения"}`);
    } else {
      toast("✅ Информация о клиенте успешно обновлена");
      setEditingClient(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    toast("⏳ Удаление...");
    const res = await deleteClient.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Не удалось удалить клиента"}`);
    } else {
      toast(`🗑 Клиент ${deleteTarget.lastName} ${deleteTarget.firstName} успешно удалён`);
      setDeleteTarget(null);
    }
  };

  if (isLoading) return null;

  const filteredClients = clients.filter(
    (c) =>
      c.firstName.toLowerCase().includes(search.toLowerCase()) ||
      c.lastName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div id="panel-newClient" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Sidebar form: Add Guest */}
      <div className="lg:col-span-4 bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-6">
        <div className="flex items-center gap-2.5 text-wine-800 border-b border-stone-50 pb-3">
          <UserPlus className="w-5 h-5 text-gold-500" />
          <h2 className="font-serif text-lg font-bold">Добавить Танцора</h2>
        </div>

        <form onSubmit={handleSubmitAdd} className="space-y-4 font-sans">
          <div className="space-y-1">
            <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Имя</label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Мария"
              className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Фамилия</label>
            <input
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Ньевес"
              className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Telegram ссылка</label>
            <div className="relative">
              <span className="absolute left-4 top-3.5 text-xs text-stone-300 font-mono pointer-events-none">t.me/</span>
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
                className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl pl-13 pr-4 py-3 text-sm transition-all font-mono"
              />
            </div>
            <p className="text-[10px] text-stone-400 leading-normal">Для связи при окончании абонементов прямо из карточек.</p>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-gold-400 hover:bg-gold-500 text-stone-900 font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all shadow-sm cursor-pointer"
          >
            Внести в базу
          </button>
        </form>
      </div>

      {/* Main Table details */}
      <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-stone-50 pb-5">
          <div className="flex items-center gap-2.5 text-stone-800">
            <FileText className="w-5 h-5 text-gold-500" />
            <h2 className="font-serif text-lg font-bold">Реестр Гостей Студии</h2>
          </div>

          {/* Elegant Search Bar */}
          <div className="relative w-full sm:w-72 font-sans">
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Поиск по имени или фамилии..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl text-xs transition-all"
            />
          </div>
        </div>

        {/* Directory grid/table */}
        <div className="overflow-x-auto min-h-[300px]">
          {filteredClients.length === 0 ? (
            <div className="text-center py-20 text-stone-400 space-y-2">
              <span className="text-2xl font-serif block">☕</span>
              <p className="text-sm">Танцоры с такими инициалами еще не внесены или отсутствуют.</p>
            </div>
          ) : (
            <table className="w-full font-sans text-stone-700 text-left">
              <thead>
                <tr className="border-b border-stone-100 text-[11px] font-mono uppercase text-stone-400 tracking-wider">
                  <th className="pb-3 pl-2">#</th>
                  <th className="pb-3">Танцор (Фамилия Имя)</th>
                  <th className="pb-3">Связь</th>
                  <th className="pb-3 text-right pr-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((c, i) => (
                  <tr
                    key={c.id}
                    className="border-b border-stone-50/50 hover:bg-stone-50/70 transition-colors text-sm group"
                  >
                    <td className="py-3.5 pl-2 font-mono text-xs text-stone-400">{i + 1}</td>
                    <td className="py-3.5 font-sans font-medium text-stone-800">
                      {c.lastName} {c.firstName}
                    </td>
                    <td className="py-3.5">
                      {c.telegram ? (
                        <a
                          href={c.telegram}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/15 text-[#229ED9] rounded-lg text-xs font-mono font-medium transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {c.telegram.replace("https://t.me/", "@")}
                        </a>
                      ) : (
                        <span className="text-xs text-stone-300 italic font-mono">не указан</span>
                      )}
                    </td>
                    <td className="py-3.5 text-right pr-2">
                      <div className="flex items-center justify-end gap-2.5">
                        <button
                          onClick={() => startEdit(c)}
                          className="p-1.5 text-stone-400 hover:text-gold-600 hover:bg-gold-50 rounded-lg transition-all cursor-pointer"
                          title="Редактировать"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                          title="Исключить из базы"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* --- RENDER EDIT MODAL DRAWER --- */}
      <AnimatePresence>
        {editingClient && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl border border-gold-200 shadow-2xl overflow-hidden max-w-sm w-full p-6 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <h3 className="font-serif text-lg font-bold text-wine-900">Редактировать Танцора</h3>
                <button
                  onClick={() => setEditingClient(null)}
                  className="p-1 text-stone-400 hover:text-stone-700 rounded-full hover:bg-stone-50 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 font-sans text-sm">
                <div className="space-y-1">
                  <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Имя</label>
                  <input
                    type="text"
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                    className="w-full bg-stone-55 border border-stone-200 outline-none rounded-xl px-4 py-2.5 text-sm focus:border-gold-400 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Фамилия</label>
                  <input
                    type="text"
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                    className="w-full bg-stone-55 border border-stone-200 outline-none rounded-xl px-4 py-2.5 text-sm focus:border-gold-400 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Telegram ссылка</label>
                  <input
                    type="text"
                    value={editTg}
                    placeholder="https://t.me/username"
                    onChange={(e) => setEditTg(e.target.value)}
                    className="w-full bg-stone-55 border border-stone-200 outline-none rounded-xl px-4 py-2.5 text-xs focus:border-gold-400 transition-all font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2 font-mono text-xs">
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 py-3 bg-gold-400 hover:bg-gold-500 text-stone-900 font-bold uppercase rounded-xl transition-colors cursor-pointer"
                >
                  Сохранить
                </button>
                <button
                  onClick={() => setEditingClient(null)}
                  className="flex-1 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold uppercase rounded-xl transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- DELETE CONFIRMATON FRAME --- */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-white rounded-2xl border border-rose-100 shadow-2xl p-6 max-w-sm w-full space-y-4 text-center"
            >
              <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center text-rose-600 mx-auto">
                <AlertOctagon className="w-6 h-6 animate-bounce" />
              </div>

              <div className="space-y-2">
                <h3 className="font-serif text-lg font-bold text-stone-900">Исключить Танцора?</h3>
                <p className="text-xs text-stone-500 font-sans leading-relaxed">
                  Вы действительно хотите полностью стереть карточку танцора{" "}
                  <strong className="font-bold text-stone-800">
                    {deleteTarget.lastName} {deleteTarget.firstName}
                  </strong>{" "}
                  и все сопряженные абонементы? Это действие необратимо удалит данные из базы.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2 font-mono text-xs">
                <button
                  onClick={handleConfirmDelete}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold uppercase rounded-xl transition-colors cursor-pointer"
                >
                  Да, Стереть
                </button>
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold uppercase rounded-xl transition-colors cursor-pointer"
                >
                  Оставить
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
